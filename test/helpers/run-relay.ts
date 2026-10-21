import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  mkdtempSync,
  openSync,
  readSync,
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

/**
 * Runs one opchain relay invocation with descriptor 3 wired per `stdio3`
 * and every stream drained concurrently.
 *
 * `duplicate-of` runs the CLI under `/bin/sh -c 'exec 3>&N "$0" "$@"'`
 * so fd 3 is a genuine child-side dup2 of the freshly redirected stdout
 * or stderr pipe: a numeric stdio slot passes the PARENT's descriptor
 * (Node's documented semantics, and Bun's behavior since 1.4.3 on
 * Linux), so it can never create the child-side alias under test.
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

  let fileFd: number | undefined;
  let fifo: FifoEnds | undefined;
  let fifoPeerMode: FifoPeerMode | undefined;
  const stdio: ("pipe" | "ignore" | number)[] = ["pipe", "pipe", "pipe"];
  switch (options.stdio3?.kind) {
    case undefined:
    case "pipe":
      stdio.push("pipe");
      break;
    case "closed":
      break;
    case "duplicate-of":
      // No stdio slot 3: the child-side shell dup below wires fd 3.
      break;
    case "file-path":
      fileFd = openSync(options.stdio3.path, "w");
      stdio.push(fileFd);
      break;
    case "raw-fd":
      stdio.push(options.stdio3.fd);
      break;
    case "fifo":
      fifo = openFifoEnds();
      fifoPeerMode = options.stdio3.peer;
      stdio.push(fifo.writeFd);
      break;
  }

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

  // The alias fixture dups fd 1 or 2 onto fd 3 inside the child before
  // exec'ing the CLI; argv rides "$0"/"$@" so nothing is interpolated.
  const { completion, output, outputEnded } =
    options.stdio3?.kind === "duplicate-of"
      ? await spawnGuarded(
          "/bin/sh",
          [
            "-c",
            `exec 3>&${options.stdio3.fd} "$0" "$@"`,
            process.execPath,
            "run",
            "src/index.ts",
            ...argvAfterBinary,
          ],
          { env, stdio },
        )
      : await spawnBunCli(argvAfterBinary, { env, stdio });

  // Descriptor 3 is always drained when it is a pipe: a fixture peer that
  // stops reading belongs to the FIFO kinds, whose deterministic
  // backpressure the kernel enforces.

  // The FIFO peer: read the first chunk the relay delivers, then hold
  // the read end open (the raced write waits out the deadline) or close
  // it (the blocked write fails with EPIPE). An unexpected peer error is
  // stashed and rethrown after the child settles, so it fails the test
  // as a fixture error instead of an unhandled rejection.
  let fifoReadEndClosed = false;
  let fifoPeerError: unknown;
  const fifoPeerTask =
    fifo === undefined || fifoPeerMode === undefined
      ? undefined
      : (async () => {
          try {
            const firstChunk = await readFirstFifoChunk(fifo.readFd);
            output.value.push(firstChunk);
            if (fifoPeerMode === "destroy-after-first-chunk") {
              closeSync(fifo.readFd);
              fifoReadEndClosed = true;
            }
          } catch (error) {
            fifoPeerError = error;
          }
        })();

  // The child's close can precede delivery of its last stdout or stderr
  // bytes, so each stream's own end is awaited too.
  const { code, signal } = await completion;
  await outputEnded;

  if (fifoPeerTask !== undefined) {
    await fifoPeerTask;
  }
  if (fifoPeerError !== undefined) {
    throw fifoPeerError;
  }
  if (fifo !== undefined) {
    if (!fifoReadEndClosed) {
      closeSync(fifo.readFd);
    }
    closeSync(fifo.writeFd);
  }
  if (fileFd !== undefined) {
    closeSync(fileFd);
  }

  return {
    homePath,
    opLogPath,
    result: { code, signal },
    securityLogPath,
    stderrText: Buffer.concat(output.stderr).toString("utf8"),
    stdoutText: Buffer.concat(output.stdout).toString("utf8"),
    valueBytes: Buffer.concat(output.value),
  };
}
