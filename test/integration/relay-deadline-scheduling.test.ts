import { describe, expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withDelayedConfig } from "../helpers/delayed-config.ts";
import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";

const OP_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/op");
const OP_EMPTY_READ_FIXTURE_PATH = join(
  process.cwd(),
  "test/fixtures/bin/op-deadline-empty-read",
);
const SECURITY_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/security");
const TIMER_SLACK_PRELOAD_PATH = join(
  process.cwd(),
  "test/fixtures/deadline/loosen-relay-timers.ts",
);

const REFERENCE = "op://Infra/reflect-intake-restic/password";

/** Budget for the scheduling tests: the deadline lands at ~1.2 s. */
const RELAY_DEADLINE_MS = 1_200;
/** Timer slack installed into the relay subprocess via the preload. */
const TIMER_SLACK_MS = 2_500;
/** Child runtime past the deadline but well inside the slack. */
const CHILD_PAST_DEADLINE_SLEEP_MS = 1_700;
/** Parent drain start for the final-write case: past the deadline, inside the slack. */
const FINAL_WRITE_DRAIN_AFTER_MS = 2_000;
/** One value well under the 64 KiB write chunk, so one final write. */
const FINAL_WRITE_VALUE_BYTES = 1_024;

/** Hard bound on one relay subprocess; it is killed past this. */
const CLI_RUN_BOUND_MS = 15_000;

type DeadlineCliRun = {
  /** Bytes the relay delivered to the FIFO, after any prefill filler. */
  readonly relayBytes: Buffer;
  /** Filler bytes the parent wrote into the FIFO before the spawn. */
  readonly prefilledBytes: number;
  readonly result: {
    readonly code: number | null;
    readonly signal: string | null;
  };
  readonly stderrText: string;
  readonly stdoutText: string;
};

/**
 * Fills the FIFO until it accepts no further byte, through a separate
 * non-blocking write end that is closed afterwards. Large writes run
 * first, then single bytes, so no partial room remains whatever the
 * platform's pipe capacity is.
 *
 * @param fifoPath - FIFO whose read end is already open.
 * @returns {number} Filler bytes written.
 */
function prefillFifo(fifoPath: string): number {
  const prefillFd = openSync(
    fifoPath,
    fsConstants.O_WRONLY | fsConstants.O_NONBLOCK,
  );
  let written = 0;
  try {
    for (const size of [65_536, 4_096, 1]) {
      const filler = Buffer.alloc(size, "f");
      for (;;) {
        try {
          written += writeSync(prefillFd, filler);
        } catch (error) {
          if ((error as { readonly code?: string }).code === "EAGAIN") {
            break;
          }
          throw error;
        }
      }
    }
  } finally {
    closeSync(prefillFd);
  }
  return written;
}

/**
 * Reads everything currently buffered on a non-blocking read end.
 *
 * @param readFd - Non-blocking FIFO read end.
 * @param sink - Receives each chunk read.
 * @returns {void}
 */
function drainAvailable(readFd: number, sink: Buffer[]): void {
  for (;;) {
    const buffer = Buffer.alloc(65_536);
    let bytesRead: number;
    try {
      bytesRead = readSync(readFd, buffer, 0, buffer.length, null);
    } catch {
      // EAGAIN: nothing buffered right now.
      return;
    }
    if (bytesRead === 0) {
      return;
    }
    sink.push(buffer.subarray(0, bytesRead));
  }
}

/**
 * Runs the relay CLI as a subprocess, optionally under the timer-slack
 * preload, with descriptor 3 wired to one inherited blocking FIFO write
 * end whose read side the parent keeps.
 *
 * @param argvAfterBinary - Arguments between the binary and the end.
 * @param options - Env overrides, op fixture path, slack, prefill, and drain plan.
 * @returns {Promise<DeadlineCliRun>} Captured streams, exit, delivered bytes.
 */
async function runRelayCli(
  argvAfterBinary: readonly string[],
  options: {
    readonly drainAfterMs?: number;
    readonly env?: Record<string, string>;
    readonly opPath?: string;
    readonly prefill?: boolean;
    readonly slackMs?: number;
  } = {},
): Promise<DeadlineCliRun> {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-deadline-cli-"));
  writeAutoReadWriteConfig(homePath);
  const opLogPath = join(homePath, "op.log");
  const securityLogPath = join(homePath, "security.log");

  // A real blocking FIFO: the CLI's inherited descriptor 3 is the
  // write end, and the parent holds the read end. With `prefill` the
  // FIFO is full before the spawn, so the relay's first write blocks
  // in the kernel until the parent starts draining at `drainAfterMs`
  // (real timers - the preload is never loaded here).
  const fifoPath = join(homePath, "value.fifo");
  spawnSync("mkfifo", [fifoPath]);
  const readFd = openSync(
    fifoPath,
    fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
  );
  let writeFd: number | undefined;
  let child: ChildProcess | undefined;
  let drainStart: ReturnType<typeof setTimeout> | undefined;
  let drainTimer: ReturnType<typeof setInterval> | undefined;
  let boundTimer: ReturnType<typeof setTimeout> | undefined;
  const drained: Buffer[] = [];

  try {
    writeFd = openSync(fifoPath, fsConstants.O_WRONLY);
    const prefilledBytes = options.prefill === true ? prefillFifo(fifoPath) : 0;

    const argv = [
      ...(options.slackMs !== undefined
        ? ["--preload", TIMER_SLACK_PRELOAD_PATH]
        : []),
      "src/index.ts",
      ...argvAfterBinary,
    ];

    const spawned = spawn(process.execPath, argv, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: homePath,
        OPCHAIN_CONFIG_PATH: join(homePath, ".config/opchain/config.toml"),
        OPCHAIN_OP_PATH: options.opPath ?? OP_FIXTURE_PATH,
        OPCHAIN_SECURITY_PATH: SECURITY_FIXTURE_PATH,
        OPCHAIN_TEST_OP_LOG: opLogPath,
        OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
        OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
        ...(options.slackMs !== undefined
          ? { OPCHAIN_TEST_TIMER_SLACK_MS: String(options.slackMs) }
          : {}),
        ...options.env,
      },
      stdio: ["pipe", "pipe", "pipe", writeFd],
    });
    child = spawned;

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    spawned.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    spawned.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    if (options.drainAfterMs !== undefined) {
      drainStart = setTimeout(() => {
        drainAvailable(readFd, drained);
        drainTimer = setInterval(() => drainAvailable(readFd, drained), 80);
      }, options.drainAfterMs);
    }

    const [code, signal] = await new Promise<[number | null, string | null]>(
      (resolve) => {
        spawned.once("close", (exitCode, closeSignal) => {
          resolve([exitCode, closeSignal]);
        });
        spawned.once("error", () => {
          resolve([null, "spawn-error"]);
        });
        boundTimer = setTimeout(() => {
          spawned.kill("SIGKILL");
        }, CLI_RUN_BOUND_MS);
      },
    );

    // Collect whatever the relay left buffered after its exit.
    drainAvailable(readFd, drained);
    const allDrained = Buffer.concat(drained);

    return {
      prefilledBytes,
      relayBytes: allDrained.subarray(
        Math.min(prefilledBytes, allDrained.length),
      ),
      result: { code, signal },
      stderrText: Buffer.concat(stderrChunks).toString("utf8"),
      stdoutText: Buffer.concat(stdoutChunks).toString("utf8"),
    };
  } finally {
    clearTimeout(drainStart);
    clearInterval(drainTimer);
    clearTimeout(boundTimer);
    if (
      child !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill("SIGKILL");
    }
    if (writeFd !== undefined) {
      closeSync(writeFd);
    }
    closeSync(readFd);
  }
}

describe("relay deadline scheduling (F2 counterexamples)", () => {
  test("a final write completing after the deadline is never accepted", async () => {
    // The FIFO is prefilled until it accepts no further byte, and the
    // value is smaller than one write chunk, so the relay issues ONE
    // write - its final one - and that write blocks in the kernel. The
    // parent drains only after the deadline, while the timer-slack
    // preload keeps the deadline timer from dispatching first: the
    // write's completion callback is then delivered after the deadline
    // but ahead of the timer - the exact F2 counterexample.
    const run = await runRelayCli(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        drainAfterMs: FINAL_WRITE_DRAIN_AFTER_MS,
        env: {
          OPCHAIN_OP_TIMEOUT_MS: String(RELAY_DEADLINE_MS),
          OPCHAIN_TEST_OP_RELAY_VALUE_BYTES: String(
            FINAL_WRITE_VALUE_BYTES - 1,
          ),
        },
        prefill: true,
        slackMs: TIMER_SLACK_MS,
      },
    );

    // The prefill really filled the FIFO, so the write had to block.
    expect(run.prefilledBytes).toBeGreaterThan(0);
    // The late write completes physically, but whatever reached the
    // FIFO is a byte-exact prefix of the value - never more.
    const value = Buffer.concat([
      Buffer.alloc(FINAL_WRITE_VALUE_BYTES - 1, "x"),
      Buffer.from("\n"),
    ]);
    expect(run.relayBytes.length).toBeLessThanOrEqual(value.length);
    expect(
      run.relayBytes.equals(value.subarray(0, run.relayBytes.length)),
    ).toBe(true);
    // The completion landed after the deadline, so it is not success.
    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: deadline\n");
    expect(run.stdoutText).toBe("");
  }, 20_000);

  test("a child completing just after the deadline reports child-timeout", async () => {
    // The op child sleeps past the deadline and exits 0 before the
    // slack-delayed timer dispatches: its close event is observed
    // after the deadline, so completion must classify as timeout, not
    // success - and the write phase must never run.
    const run = await runRelayCli(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        env: {
          OPCHAIN_OP_TIMEOUT_MS: String(RELAY_DEADLINE_MS),
          OPCHAIN_TEST_OP_SLEEP_MS: String(CHILD_PAST_DEADLINE_SLEEP_MS),
        },
        slackMs: TIMER_SLACK_MS,
      },
    );

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: child-timeout\n");
  }, 20_000);

  test("an empty value completing after the deadline is never written", async () => {
    // Same counterexample with a zero-byte value: the child exits 0
    // past the deadline, so even an empty write must not report
    // success.
    const run = await runRelayCli(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        env: {
          OPCHAIN_OP_TIMEOUT_MS: String(RELAY_DEADLINE_MS),
          OPCHAIN_TEST_OP_SLEEP_MS: String(CHILD_PAST_DEADLINE_SLEEP_MS),
        },
        opPath: OP_EMPTY_READ_FIXTURE_PATH,
        slackMs: TIMER_SLACK_MS,
      },
    );

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: child-timeout\n");
    expect(run.stdoutText).toBe("");
  }, 20_000);
});

describe("relay exhausted budget (F1, end to end)", () => {
  test("a near-zero budget refuses before starting either subprocess", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opchain-deadline-budget-"));
    const opLogPath = join(dir, "op.log");
    const securityLogPath = join(dir, "security.log");

    // Config arrives CONFIG_DELAY_MS after the read opens, so the 50 ms
    // budget is spent in config loading, before either subprocess.
    const { readerAttached, value: run } = await withDelayedConfig(
      (configPath) =>
        runRelayCli(
          ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
          {
            env: {
              OPCHAIN_CONFIG_PATH: configPath,
              OPCHAIN_OP_TIMEOUT_MS: "50",
              OPCHAIN_TEST_OP_LOG: opLogPath,
              OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
            },
          },
        ),
    );

    expect(readerAttached).toBe(true);
    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: deadline\n");
    expect(existsSync(securityLogPath)).toBe(false);
    expect(existsSync(opLogPath)).toBe(false);
  }, 20_000);
});
