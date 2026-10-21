import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "./write-opchain-config.ts";

/**
 * How long the config writer holds the FIFO open before writing the
 * config. The relay budget under test must be well below this, so the
 * config read cannot finish inside the budget however fast the run is.
 */
export const CONFIG_DELAY_MS = 200;

/** Upper bound on waiting for the writer to finish after the run. */
const WRITER_SETTLE_BOUND_MS = 5_000;

export type DelayedConfigRun<TValue> = {
  /**
   * True when the writer finished on its own: the run opened the FIFO
   * for reading, so the delayed config was really in its path.
   */
  readonly readerAttached: boolean;
  readonly value: TValue;
};

/**
 * Waits for one promise, giving up after a bound.
 *
 * @param promise - The promise to wait for.
 * @param boundMs - Longest wait in milliseconds.
 * @returns {Promise<boolean>} True when the promise settled inside the bound.
 */
async function settlesWithin(
  promise: Promise<unknown>,
  boundMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
      }, boundMs);
    }),
  ]);
  clearTimeout(timer);
  return settled;
}

/**
 * Runs one relay invocation whose config path is a FIFO that delivers a
 * valid synthetic config only `CONFIG_DELAY_MS` after the reader opens
 * it. The writer's first action opens the FIFO for writing, which blocks
 * until the relay's config read opens it; only then does it sleep and
 * write. Config loading therefore spends the relay budget before either
 * subprocess can start. The writer is always reaped: a run that never
 * opens the FIFO leaves it blocked in open(), and it is killed.
 *
 * @param run - Starts the relay with the given config path.
 * @returns {Promise<DelayedConfigRun<TValue>>} The run's value and whether it opened the config.
 */
export async function withDelayedConfig<TValue>(
  run: (configPath: string) => Promise<TValue>,
): Promise<DelayedConfigRun<TValue>> {
  const dir = mkdtempSync(join(tmpdir(), "opchain-delayed-config-"));
  const sourcePath = writeAutoReadWriteConfig(dir);
  const fifoPath = join(dir, "config.fifo");
  const made = spawnSync("mkfifo", [fifoPath]);
  if (made.status !== 0) {
    throw new Error(`mkfifo failed with status ${made.status}`);
  }

  const writer = spawn(
    "/bin/sh",
    [
      "-c",
      'exec 3>"$1" && sleep "$2" && cat "$0" >&3',
      sourcePath,
      fifoPath,
      String(CONFIG_DELAY_MS / 1_000),
    ],
    { stdio: "ignore" },
  );
  const writerClosed = new Promise<void>((resolve) => {
    writer.once("close", () => {
      resolve();
    });
    writer.once("error", () => {
      resolve();
    });
  });

  try {
    const value = await run(fifoPath);
    // An in-process reader stays pending until the writer delivers, so
    // the writer's own completion is awaited, within a bound.
    const writerFinished = await settlesWithin(
      writerClosed,
      WRITER_SETTLE_BOUND_MS,
    );
    return {
      readerAttached: writerFinished && writer.pid !== undefined,
      value,
    };
  } finally {
    if (writer.exitCode === null && writer.signalCode === null) {
      writer.kill("SIGKILL");
      await settlesWithin(writerClosed, WRITER_SETTLE_BOUND_MS);
    }
  }
}
