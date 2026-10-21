import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  constants as fsConstants,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "./write-opchain-config.ts";

const OP_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/op");
const SECURITY_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/security");

export const RELAY_OP_FIXTURE_PATH = OP_FIXTURE_PATH;
export const RELAY_SECURITY_FIXTURE_PATH = SECURITY_FIXTURE_PATH;

/** How descriptor 3 is wired for the spawned opchain CLI. */
export type RelayStdio3 =
  | { readonly kind: "pipe" }
  | { readonly kind: "closed" }
  | { readonly kind: "duplicate-of"; readonly fd: 1 | 2 }
  | { readonly kind: "file-path"; readonly path: string }
  | { readonly kind: "raw-fd"; readonly fd: number }
  | {
      /** Helper-owned FIFO whose peer reads one chunk, then stalls or closes. */
      readonly kind: "fifo";
      readonly peer: FifoPeerMode;
    };

/** Peer behavior on the helper-owned FIFO's read end after one chunk. */
export type FifoPeerMode =
  | "stall-after-first-chunk"
  | "destroy-after-first-chunk";

export type RelayRunResult = {
  readonly homePath: string;
  readonly opLogPath: string;
  readonly result: { code: number | null; signal: string | null };
  readonly securityLogPath: string;
  readonly stderrText: string;
  readonly stdoutText: string;
  readonly valueBytes: Buffer;
};

/**
 * Bun's demonstrated stdio-creation flake: an ENOENT from the connect
 * inside child-process stdio creation (`#getBunSpawnIo`), documented as
 * oven-sh/bun#13543, delivered either as a synchronous throw from
 * spawn() or asynchronously as a stream `error` event. A missing binary
 * reports syscall "spawn" instead and must not be retried.
 */
function isBunStdioCreationFlake(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; syscall?: unknown };
  if (e.code !== "ENOENT") {
    return false;
  }

  return (
    e.syscall === "connect" || String(e.message).includes("Failed to connect")
  );
}

/** Window in which the flake's asynchronous stream-error form arrives. */
const STDIO_FLAKE_SETTLE_MS = 25;

/** Bounded wait for a killed spawn attempt to close before retrying. */
const FAILED_EXIT_SETTLE_MS = 1_000;

/** Poll interval while waiting for the FIFO's first chunk. */
const FIFO_PEER_POLL_MS = 10;

/** Upper bound for the FIFO peer's first-chunk wait before failing. */
const FIFO_FIRST_CHUNK_TIMEOUT_MS = 20_000;

type GuardedSpawnOptions = {
  readonly detached?: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: readonly ("pipe" | "ignore" | number)[];
};

/** How a spawned child settled. */
export type ChildCompletion = {
  readonly code: number | null;
  readonly signal: string | null;
};

/** The readable surface of a captured child stream. */
type CapturedStream =
  | {
      on(event: "data", listener: (chunk: Buffer) => void): unknown;
      once(event: "close" | "end" | "error", listener: () => void): unknown;
    }
  | null
  | undefined;

/**
 * Collects a child stream's chunks until the stream ends, closes, or
 * errors.
 *
 * @param stream - The stream to drain, if the slot is a pipe.
 * @param chunks - Receives every chunk in order.
 * @returns {Promise<void>} Resolved once no more data can arrive.
 */
function captureStream(
  stream: CapturedStream,
  chunks: Buffer[],
): Promise<void> {
  if (stream === null || stream === undefined) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    stream.once("end", resolve);
    stream.once("close", resolve);
    stream.once("error", resolve);
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  });
}

/** A spawned child plus its completion, watched from the spawn onward. */
export type GuardedChild = {
  readonly child: ChildProcess;
  readonly completion: Promise<ChildCompletion>;
  /**
   * Settles on the child's reap (`exit`), without waiting for any stdio
   * stream; for runs whose output is captured in files, not pipes.
   */
  readonly exited: Promise<ChildCompletion>;
  /** Chunks from stdout, stderr, and a piped descriptor 3, from spawn on. */
  readonly output: {
    readonly stderr: Buffer[];
    readonly stdout: Buffer[];
    readonly value: Buffer[];
  };
  /** Settles once stdout and stderr have each ended, closed, or errored. */
  readonly outputEnded: Promise<void>;
};

/**
 * Starts capturing one child's output. Like `watchCompletion`, it runs
 * synchronously after spawn(), so no chunk can arrive before a listener:
 * with listeners attached only after the settle window, exit-1 runs with
 * empty stderr were observed under parallel load on Linux.
 *
 * Descriptor 3 is drained but its end is not awaited: under load Bun can
 * drop the end and close of this extra slot after the child has closed
 * and no process holds the write end, which would hang the run.
 * Byte-exact value assertions still catch any value byte lost this way.
 *
 * @param child - The freshly spawned child.
 * @returns {Pick<GuardedChild, "output" | "outputEnded">} The output buffers and the stdout/stderr end promise.
 */
function captureOutput(
  child: ChildProcess,
): Pick<GuardedChild, "output" | "outputEnded"> {
  const output = {
    stderr: [],
    stdout: [],
    value: [],
  } as GuardedChild["output"];
  // For stdio slots past index 2, "pipe" hands the parent the read end;
  // the spawn types model it as Writable, so it is narrowed here.
  void captureStream(child.stdio[3] as unknown as CapturedStream, output.value);
  const outputEnded = Promise.all([
    captureStream(child.stdout, output.stdout),
    captureStream(child.stderr, output.stderr),
  ]).then(() => undefined);
  return { output, outputEnded };
}

/**
 * Watches one child for completion. It must be called synchronously
 * after spawn(), before any await: a fast child can close inside the
 * flake settle window, and a `close` listener attached later never
 * fires. An `error` settles the child only when no process ever started
 * (no pid), since then no `close` is guaranteed; a started child settles
 * on `close` alone, after its exit and its stdio streams closing.
 *
 * @param child - The freshly spawned child.
 * @returns {Promise<ChildCompletion>} Its exit code and signal.
 */
function watchCompletion(child: ChildProcess): Promise<ChildCompletion> {
  return new Promise<ChildCompletion>((resolve) => {
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
    child.on("error", () => {
      if (child.pid === undefined) {
        resolve({ code: null, signal: null });
      }
    });
  });
}

/**
 * Watches one child for its reap. Like `watchCompletion`, it must be
 * called synchronously after spawn(). `exit` reports the process itself
 * ending, while `close` additionally waits for every stdio stream to
 * close (Node's documented contract), so `exit` alone is used when no
 * stdio stream carries output that must be awaited.
 *
 * @param child - The freshly spawned child.
 * @returns {Promise<ChildCompletion>} Its exit code and signal.
 */
function watchExit(child: ChildProcess): Promise<ChildCompletion> {
  return new Promise<ChildCompletion>((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
    child.on("error", () => {
      if (child.pid === undefined) {
        resolve({ code: null, signal: null });
      }
    });
  });
}

/** A helper-owned regular file standing in for a stdout or stderr pipe. */
export type FileCapture = {
  /** Write descriptor to pass as the child's stdio slot. */
  readonly fd: number;
  /** Closes the parent's descriptor; the file's bytes stay readable. */
  close(): void;
  /** Every byte written so far. */
  read(): Buffer;
};

/**
 * Opens a temporary regular file to capture one child output stream.
 *
 * Bun's stdout and stderr pipes are socketpairs read through the event
 * loop. With a value write still blocked on a FIFO when the CLI exits,
 * macOS runs were observed where the parent side of the stderr socket
 * disappeared without one `data`, `end` or `close` event, although the
 * CLI had written its line and was reaped. The child's `close` then
 * never fires. A regular file passed as a numeric slot is the parent's
 * own descriptor shared with the child, so its contents are final once
 * the child has been reaped, with no event involved.
 *
 * @param name - File name for the stream, such as "stderr".
 * @returns {FileCapture} The open capture; the caller owns closing.
 */
export function openFileCapture(name: string): FileCapture {
  const dir = mkdtempSync(join(tmpdir(), "opchain-relay-capture-"));
  const path = join(dir, name);
  const fd = openSync(path, "w");
  return {
    close: () => {
      closeSync(fd);
    },
    fd,
    read: () => readFileSync(path),
  };
}

/**
 * Kills a failed spawn attempt and waits for its completion, so a retry
 * never runs beside it. Throws when the attempt has not closed within the
 * bound: retrying next to a possibly live child is refused.
 *
 * @param attempt - The failed attempt, if spawn() returned one.
 * @returns {Promise<void>} Resolved once the attempt has settled.
 */
async function reapFailedAttempt(
  attempt: GuardedChild | undefined,
): Promise<void> {
  if (attempt === undefined) {
    return;
  }

  try {
    attempt.child.kill("SIGKILL");
  } catch {
    // Already gone: its completion settles regardless.
  }

  let fallback: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    attempt.completion.then(() => true),
    new Promise<boolean>((resolve) => {
      fallback = setTimeout(() => {
        resolve(false);
      }, FAILED_EXIT_SETTLE_MS);
    }),
  ]);
  clearTimeout(fallback);
  if (!settled) {
    throw new Error(
      `failed spawn attempt (pid ${attempt.child.pid}) did not close within ${FAILED_EXIT_SETTLE_MS} ms; not retrying beside it`,
    );
  }
}

/**
 * Spawns one child process, retrying ONLY the documented Bun
 * stdio-creation flake (up to three retries) and awaiting each failed
 * attempt's completion before respawning; every other error rethrows.
 *
 * The flake can arrive as a synchronous throw or, one tick later, as a
 * stream `error` event, so every pipe stream is watched for one settle
 * window per attempt. Completion is watched before that window opens.
 *
 * @param command - Executable path to spawn.
 * @param args - Argument vector for `command`.
 * @param options - env, stdio slots, and detached group handling.
 * @returns {Promise<GuardedChild>} The settled child and its completion.
 */
async function spawnGuarded(
  command: string,
  args: readonly string[],
  options: GuardedSpawnOptions,
): Promise<GuardedChild> {
  for (let attempt = 0; ; attempt += 1) {
    let guarded: GuardedChild | undefined;
    let attemptError: unknown;
    try {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        detached: options.detached,
        env: options.env,
        stdio: options.stdio as ("pipe" | "ignore" | number)[],
      });
      guarded = {
        child,
        completion: watchCompletion(child),
        exited: watchExit(child),
        ...captureOutput(child),
      };
      const recordStreamError = (error: Error): void => {
        if (attemptError === undefined) {
          attemptError = error;
        }
      };
      for (const stream of child.stdio) {
        stream?.on("error", recordStreamError);
      }
      child.on("error", recordStreamError);
      await new Promise((resolve) => {
        setTimeout(resolve, STDIO_FLAKE_SETTLE_MS);
      });
      if (attemptError !== undefined) {
        throw attemptError;
      }
      return guarded;
    } catch (error) {
      if (attempt >= 3 || !isBunStdioCreationFlake(error)) {
        throw error;
      }

      await reapFailedAttempt(guarded);
    }
  }
}

/**
 * Spawns the opchain CLI (`bun run src/index.ts ...`) with the guarded
 * stdio-flake retry, for tests that drive the process directly.
 *
 * @param argvAfterBinary - Arguments after `bun run src/index.ts`.
 * @param options - env, stdio slots, and detached group handling.
 * @returns {Promise<GuardedChild>} The settled child and its completion.
 */
export async function spawnBunCli(
  argvAfterBinary: readonly string[],
  options: GuardedSpawnOptions,
): Promise<GuardedChild> {
  return spawnGuarded(
    process.execPath,
    ["run", "src/index.ts", ...argvAfterBinary],
    options,
  );
}

/** Read end and write end of the helper-owned FIFO fixture. */
type FifoEnds = {
  readonly readFd: number;
  readonly writeFd: number;
};

/**
 * Creates a FIFO with a held read end and a blocking write end to pass
 * as descriptor 3.
 *
 * @returns {FifoEnds} Both open descriptors; the caller owns closing.
 */
function openFifoEnds(): FifoEnds {
  const dir = mkdtempSync(join(tmpdir(), "opchain-relay-fd3-"));
  const fifoPath = join(dir, "value.fifo");
  spawnSync("mkfifo", [fifoPath]);
  // The read end opens first, non-blocking, so the write end never
  // waits for a reader.
  const readFd = openSync(
    fifoPath,
    fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
  );
  const writeFd = openSync(fifoPath, fsConstants.O_WRONLY);
  return { readFd, writeFd };
}

/**
 * Reads the FIFO's first chunk, polling the non-blocking read end until
 * bytes arrive.
 *
 * @param readFd - Non-blocking FIFO read end.
 * @returns {Promise<Buffer>} The first chunk the peer received.
 */
async function readFirstFifoChunk(readFd: number): Promise<Buffer> {
  const chunk = Buffer.alloc(64 * 1024);
  const deadline = Date.now() + FIFO_FIRST_CHUNK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const bytesRead = readSync(readFd, chunk, 0, chunk.length, null);
      if (bytesRead > 0) {
        return Buffer.from(chunk.subarray(0, bytesRead));
      }
    } catch (error) {
      const code = (error as { readonly code?: string }).code;
      if (code !== "EAGAIN") {
        throw error;
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, FIFO_PEER_POLL_MS);
    });
  }

  return Buffer.alloc(0);
}

/** The Node-native synchronous parent that captures piped relay runs. */
const SUPERVISOR_PATH = join(
  process.cwd(),
  "test/fixtures/relay-supervisor.mjs",
);

/**
 * Backstop on the supervisor itself, above its own 15 s bound on the
 * CLI plus Node startup; a run past it is a fixture failure.
 */
const SUPERVISOR_TIMEOUT_MS = 20_000;

/** Descriptor 3 as the supervisor wires it: a pipe, no slot, or a file. */
type SupervisedFd3 = "pipe" | "none" | { readonly path: string };

/** One supervised run's status and raw bytes. */
type SupervisedRun = {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stderr: Buffer;
  readonly stdout: Buffer;
  readonly value: Buffer;
};

/**
 * Runs one command under `test/fixtures/relay-supervisor.mjs`: Node's
 * spawnSync gives the command real pipes for stdout, stderr and a piped
 * descriptor 3, and the supervisor writes their bytes to a result file.
 * Bun waits for the supervisor synchronously with its stdio ignored, so
 * no Bun stream event is involved. Bun's async stream capture once
 * recorded a missing-executable refusal as exit 1 with empty stderr,
 * while the same CLI under this supervisor wrote its line in every
 * reference run. The environment reaches the command by inheritance;
 * only the command line, descriptor 3 layout and result path ride the
 * request.
 *
 * @param command - Executable path to run.
 * @param args - Argument vector for `command`.
 * @param fd3 - How descriptor 3 is wired.
 * @param env - The command's complete environment.
 * @returns {SupervisedRun} Its exit code, signal and captured bytes.
 */
function runSupervised(
  command: string,
  args: readonly string[],
  fd3: SupervisedFd3,
  env: NodeJS.ProcessEnv,
): SupervisedRun {
  const nodePath = Bun.which("node");
  if (nodePath === null) {
    throw new Error("relay supervisor needs node on PATH");
  }

  const dir = mkdtempSync(join(tmpdir(), "opchain-relay-supervisor-"));
  const resultPath = join(dir, "result.json");
  try {
    const supervisor = spawnSync(
      nodePath,
      [SUPERVISOR_PATH, JSON.stringify({ args, command, fd3, resultPath })],
      {
        cwd: process.cwd(),
        env,
        killSignal: "SIGKILL",
        stdio: "ignore",
        timeout: SUPERVISOR_TIMEOUT_MS,
      },
    );
    if (supervisor.error !== undefined) {
      throw supervisor.error;
    }

    if (!existsSync(resultPath)) {
      throw new Error(
        `relay supervisor exited with status ${supervisor.status}, signal ${supervisor.signal}, without a result`,
      );
    }
    const result = JSON.parse(readFileSync(resultPath, "utf8")) as
      | { readonly error: string }
      | {
          readonly code: number | null;
          readonly signal: string | null;
          readonly stderr: string;
          readonly stdout: string;
          readonly value: string;
        };
    if ("error" in result) {
      throw new Error(`relay supervisor failed: ${result.error}`);
    }
    if (supervisor.status !== 0) {
      throw new Error(
        `relay supervisor exited with status ${supervisor.status}, signal ${supervisor.signal}`,
      );
    }

    return {
      code: result.code,
      signal: result.signal,
      stderr: Buffer.from(result.stderr, "base64"),
      stdout: Buffer.from(result.stdout, "base64"),
      value: Buffer.from(result.value, "base64"),
    };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * Runs the CLI with descriptor 3 on a helper-owned FIFO or a caller's
 * raw descriptor. The value write can stay blocked on such a descriptor
 * when the CLI exits, the case in which Bun was observed to drop the
 * stderr pipe's data and end, so stdout and stderr are captured in files
 * and the run settles on the reap (see `openFileCapture`). The FIFO peer
 * must be serviced while the CLI runs, so this path stays asynchronous.
 *
 * @param argvAfterBinary - Arguments between `bun run src/index.ts` and the end.
 * @param stdio3 - The FIFO or raw descriptor 3 wiring.
 * @param env - The CLI's complete environment.
 * @returns {Promise<SupervisedRun>} Its exit code, signal and captured bytes.
 */
async function runFileCaptured(
  argvAfterBinary: readonly string[],
  stdio3: Extract<RelayStdio3, { kind: "fifo" | "raw-fd" }>,
  env: NodeJS.ProcessEnv,
): Promise<SupervisedRun> {
  const captures = {
    stderr: openFileCapture("stderr"),
    stdout: openFileCapture("stdout"),
  };
  let fifo: FifoEnds | undefined;
  const value: Buffer[] = [];
  let fifoReadEndClosed = false;
  try {
    let fd3: number;
    if (stdio3.kind === "fifo") {
      fifo = openFifoEnds();
      fd3 = fifo.writeFd;
    } else {
      fd3 = stdio3.fd;
    }
    const { exited } = await spawnBunCli(argvAfterBinary, {
      env,
      stdio: ["ignore", captures.stdout.fd, captures.stderr.fd, fd3],
    });

    // The FIFO peer: read the first chunk the relay delivers, then hold
    // the read end open (the raced write waits out the deadline) or close
    // it (the blocked write fails with EPIPE). An unexpected peer error is
    // stashed and rethrown after the child settles, so it fails the test
    // as a fixture error instead of an unhandled rejection.
    const peer =
      fifo !== undefined && stdio3.kind === "fifo"
        ? { mode: stdio3.peer, readFd: fifo.readFd }
        : undefined;
    let fifoPeerError: unknown;
    const fifoPeerTask =
      peer === undefined
        ? undefined
        : (async () => {
            try {
              value.push(await readFirstFifoChunk(peer.readFd));
              if (peer.mode === "destroy-after-first-chunk") {
                closeSync(peer.readFd);
                fifoReadEndClosed = true;
              }
            } catch (error) {
              fifoPeerError = error;
            }
          })();

    const { code, signal } = await exited;
    await fifoPeerTask;
    if (fifoPeerError !== undefined) {
      throw fifoPeerError;
    }

    return {
      code,
      signal,
      stderr: captures.stderr.read(),
      stdout: captures.stdout.read(),
      value: Buffer.concat(value),
    };
  } finally {
    if (fifo !== undefined) {
      if (!fifoReadEndClosed) {
        closeSync(fifo.readFd);
      }
      closeSync(fifo.writeFd);
    }
    captures.stderr.close();
    captures.stdout.close();
  }
}

/**
 * Runs one opchain relay invocation with descriptor 3 wired per `stdio3`.
 *
 * Pipe, closed, alias and file-path layouts run under the Node-native
 * supervisor (see `runSupervised`); FIFO and raw-descriptor layouts use
 * file capture (see `runFileCaptured`).
 *
 * `duplicate-of` runs the CLI under `/bin/sh -c 'exec 3>&N "$0" "$@"'`
 * so fd 3 is a genuine child-side dup2 of the freshly created stdout or
 * stderr pipe: a numeric stdio slot passes the PARENT's descriptor
 * (Node's documented semantics, and Bun's behavior since 1.4.3 on
 * Linux), so it can never create the child-side alias under test. Argv
 * rides "$0"/"$@", so nothing is interpolated.
 *
 * @param argvAfterBinary - Arguments between `bun run src/index.ts` and the end.
 * @param options - Descriptor 3 wiring and extra env.
 * @returns {Promise<RelayRunResult>} Captured streams plus fixture log paths.
 */
export async function runRelay(
  argvAfterBinary: readonly string[],
  options: {
    readonly env?: Record<string, string>;
    readonly stdio3?: RelayStdio3;
  } = {},
): Promise<RelayRunResult> {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-relay-"));
  writeAutoReadWriteConfig(homePath);
  const opLogPath = join(homePath, "op.log");
  const securityLogPath = join(homePath, "security.log");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homePath,
    OPCHAIN_OP_PATH: OP_FIXTURE_PATH,
    OPCHAIN_SECURITY_PATH: SECURITY_FIXTURE_PATH,
    OPCHAIN_TEST_OP_LOG: opLogPath,
    OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
    OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
    ...options.env,
  };

  const cliArgs = ["run", "src/index.ts", ...argvAfterBinary];
  const stdio3 = options.stdio3 ?? { kind: "pipe" };
  let run: SupervisedRun;
  switch (stdio3.kind) {
    case "pipe":
      run = runSupervised(process.execPath, cliArgs, "pipe", env);
      break;
    case "closed":
      run = runSupervised(process.execPath, cliArgs, "none", env);
      break;
    case "duplicate-of":
      run = runSupervised(
        "/bin/sh",
        ["-c", `exec 3>&${stdio3.fd} "$0" "$@"`, process.execPath, ...cliArgs],
        "none",
        env,
      );
      break;
    case "file-path":
      run = runSupervised(
        process.execPath,
        cliArgs,
        { path: stdio3.path },
        env,
      );
      break;
    case "fifo":
    case "raw-fd":
      run = await runFileCaptured(argvAfterBinary, stdio3, env);
      break;
  }

  return {
    homePath,
    opLogPath,
    result: { code: run.code, signal: run.signal },
    securityLogPath,
    stderrText: run.stderr.toString("utf8"),
    stdoutText: run.stdout.toString("utf8"),
    valueBytes: run.value,
  };
}
