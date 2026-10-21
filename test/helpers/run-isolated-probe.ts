import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TIMER_SLACK_PRELOAD_PATH = join(
  process.cwd(),
  "test/fixtures/deadline/loosen-relay-timers.ts",
);

/** One isolated probe run: its exit plus its single JSON report. */
export type IsolatedProbeRun<T> = {
  readonly code: number | null;
  readonly report: T | null;
  readonly stderrText: string;
};

/**
 * Runs one deadline probe script as its own Bun subprocess, so the
 * probe's time and environment patches never reach the test runner.
 *
 * The probe gets only the explicit environment given here plus a fixed
 * `PATH`, and leads its own process group: whatever it leaves running
 * is killed with the group when the run ends, passes, or times out.
 * Output goes to regular files and is read once the probe is reaped.
 *
 * @param scriptPath - Probe script, relative to the repository root.
 * @param options - Probe args, explicit env, optional timer slack, and run bound.
 * @returns {Promise<IsolatedProbeRun<T>>} Exit code, parsed report, and stderr.
 */
export async function runIsolatedProbe<T>(
  scriptPath: string,
  options: {
    readonly args?: readonly string[];
    readonly boundMs: number;
    readonly env: Readonly<Record<string, string>>;
    readonly timerSlackMs?: number;
  },
): Promise<IsolatedProbeRun<T>> {
  const captureDir = mkdtempSync(join(tmpdir(), "opchain-probe-capture-"));
  const stdoutPath = join(captureDir, "stdout");
  const stderrPath = join(captureDir, "stderr");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  const argv = [
    ...(options.timerSlackMs !== undefined
      ? ["--preload", TIMER_SLACK_PRELOAD_PATH]
      : []),
    scriptPath,
    ...(options.args ?? []),
  ];
  const child = spawn(process.execPath, argv, {
    cwd: process.cwd(),
    detached: true,
    env: {
      PATH: "/usr/bin:/bin",
      ...(options.timerSlackMs !== undefined
        ? { OPCHAIN_TEST_TIMER_SLACK_MS: String(options.timerSlackMs) }
        : {}),
      ...options.env,
    },
    stdio: ["ignore", stdoutFd, stderrFd],
  });
  let bound: ReturnType<typeof setTimeout> | undefined;

  try {
    const code = await new Promise<number | null>((resolve) => {
      bound = setTimeout(() => {
        child.kill("SIGKILL");
      }, options.boundMs);
      child.on("exit", (exitCode) => resolve(exitCode));
      child.on("error", () => resolve(null));
    });
    const line =
      readFileSync(stdoutPath, "utf8").trim().split("\n").at(-1) ?? "";
    let report: T | null = null;
    try {
      report = JSON.parse(line) as T;
    } catch {
      report = null;
    }
    return { code, report, stderrText: readFileSync(stderrPath, "utf8") };
  } finally {
    clearTimeout(bound);
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group already ended.
      }
    }
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
}
