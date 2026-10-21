import { describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";

const OP_SIGNALS_FIXTURE = join(process.cwd(), "test/fixtures/bin/op-signals");
const SECURITY_FIXTURE = join(process.cwd(), "test/fixtures/bin/security");

type ExitFacts = {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
};

/**
 * Sleeps for a bounded time.
 *
 * @param ms - Time to sleep in milliseconds.
 * @returns {Promise<void>} Resolves once the time has passed.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Waits until a file exists, without guessing when it appears.
 *
 * @param filePath - File to wait for.
 * @param timeoutMs - Bound on the wait.
 * @returns {Promise<void>} Resolves when the file exists.
 */
async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      return;
    }
    await sleep(25);
  }
  throw new Error(`ready file never appeared: ${filePath}`);
}

/**
 * Reads the fake op's readiness file.
 *
 * @param signalsDirectory - Directory holding op-ready.
 * @returns {Promise<{opPid: number; programPid: number | null}>} PIDs from it.
 */
async function readOpReady(
  signalsDirectory: string,
): Promise<{ opPid: number; programPid: number | null }> {
  await waitForFile(join(signalsDirectory, "op-ready"), 10_000);
  const ready = readFileSync(join(signalsDirectory, "op-ready"), "utf8");
  const opPid = Number(/^op=(\d+)$/m.exec(ready)?.[1]);
  const programPid = Number(/^program=(\d+)$/m.exec(ready)?.[1]);
  if (!Number.isInteger(opPid) || opPid <= 0) {
    throw new Error(`op-ready has no op pid: ${ready}`);
  }
  return {
    opPid,
    programPid:
      Number.isInteger(programPid) && programPid > 0 ? programPid : null,
  };
}

/**
 * Waits for the spawned opchain to exit and collects its output.
 *
 * Resolves on exit rather than close: a leak in the red run can leave
 * orphaned children holding the output pipes open past opchain's own exit,
 * so the pipe wait is bounded and then cut short.
 *
 * @param proc - Spawned opchain process.
 * @param timeoutMs - Bound on the wait for the exit itself.
 * @returns {Promise<ExitFacts>} Exit status and streamed output.
 */
function waitForExit(
  proc: ChildProcess,
  timeoutMs: number,
): Promise<ExitFacts> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let stdout = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      reject(new Error(`opchain did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    proc.once("exit", (status) => {
      const drainTimer = setTimeout(() => {
        clearTimeout(timer);
        proc.stdout?.destroy();
        proc.stderr?.destroy();
        resolve({ status, stderr, stdout });
      }, 1_000);
      proc.once("close", () => {
        clearTimeout(drainTimer);
        clearTimeout(timer);
        resolve({ status, stderr, stdout });
      });
    });
  });
}

/**
 * Reports whether a pid no longer exists, bounded in time.
 *
 * @param pid - Process to check.
 * @param timeoutMs - Bound on the wait.
 * @returns {Promise<boolean>} True once the pid is gone.
 */
async function isPidGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
    await sleep(25);
  }
  return false;
}

/**
 * Reads the spawned opchain's pid, which every signal delivery needs.
 *
 * @param proc - Spawned opchain process.
 * @returns {number} The pid.
 */
function requireOpchainPid(proc: ChildProcess): number {
  if (proc.pid === undefined) {
    throw new Error("opchain spawned without a pid");
  }
  return proc.pid;
}

/**
 * Kills the whole detached process group opchain runs in.
 *
 * The group holds only processes this test spawned, so nothing else dies.
 *
 * @param proc - Spawned opchain process.
 */
function killProcessGroup(proc: ChildProcess): void {
  proc.stdout?.destroy();
  proc.stderr?.destroy();
  if (proc.pid === undefined) {
    return;
  }
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
  try {
    process.kill(proc.pid, "SIGKILL");
  } catch {
    // The process is already gone.
  }
}

/**
 * Spawns `opchain primary --read op ...` against the signal fake op.
 *
 * @param opArgs - Arguments passed after `op`.
 * @param signalsDirectory - Directory for readiness and receipt files.
 * @param extraEnv - Extra environment for the child.
 * @returns {ChildProcess} Detached opchain process (its own process group).
 */
function spawnOpchain(
  opArgs: readonly string[],
  signalsDirectory: string,
  extraEnv: Record<string, string> = {},
): ChildProcess {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-signals-home-"));
  writeAutoReadWriteConfig(homePath);
  return spawn(
    process.execPath,
    ["run", "src/index.ts", "primary", "--read", "op", ...opArgs],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: homePath,
        OPCHAIN_OP_PATH: OP_SIGNALS_FIXTURE,
        OPCHAIN_SECURITY_PATH: SECURITY_FIXTURE,
        OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
        OPCHAIN_TEST_OP_SIGNALS_DIR: signalsDirectory,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
}

/**
 * Builds the wrapped program's `bun -e` script: it arms a handler for
 * `signal`, announces readiness, and waits after receipt until the test
 * releases its nonzero exit.
 *
 * A shell program cannot do this: bash swallows a trapped SIGINT while it
 * waits inside `sleep` or `wait`.
 *
 * @param signal - Signal the program handles and records.
 * @param receiptName - File the handler writes to prove receipt.
 * @param exitCode - Nonzero status the program exits with after the delay.
 * @returns {string[]} Argument vector for the program.
 */
function buildTrappingProgramArgs(
  signal: "SIGHUP" | "SIGINT" | "SIGTERM",
  receiptName: string,
  exitCode: number,
): string[] {
  const script = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    "const dir = process.env.OPCHAIN_TEST_OP_SIGNALS_DIR;",
    `process.on("${signal}", () => {`,
    `  fs.writeFileSync(path.join(dir, "${receiptName}"), "x");`,
    "  setInterval(() => {",
    `    if (fs.existsSync(path.join(dir, "release-program"))) process.exit(${exitCode});`,
    "  }, 25);",
    "});",
    'fs.writeFileSync(path.join(dir, "program-ready"), String(process.pid));',
    "setTimeout(() => process.exit(1), 60000);",
    "",
  ].join("\n");
  return ["bun", "-e", script];
}

/**
 * Runs one end-to-end forwarding case: signal opchain, prove the wrapped
 * program received the forwarded signal, and check opchain waits until the
 * test releases the program's nonzero exit.
 *
 * @param signal - Signal sent to the opchain pid.
 * @param receiptName - File the program's trap writes to prove receipt.
 * @param exitCode - Nonzero status the program exits with after a delay.
 */
async function expectForwardedToProgram(
  signal: "SIGHUP" | "SIGINT" | "SIGTERM",
  receiptName: string,
  exitCode: number,
): Promise<void> {
  const signalsDirectory = mkdtempSync(join(tmpdir(), "opchain-signals-dir-"));
  const programArgs = buildTrappingProgramArgs(signal, receiptName, exitCode);
  const proc = spawnOpchain(["run", "--", ...programArgs], signalsDirectory);
  const opchainPid = requireOpchainPid(proc);
  try {
    const { opPid, programPid } = await readOpReady(signalsDirectory);
    if (programPid === null) {
      throw new Error("op-ready announced no program pid");
    }

    const exited = waitForExit(proc, 10_000);
    process.kill(opchainPid, signal);

    await waitForFile(join(signalsDirectory, receiptName), 5_000);
    expect(proc.exitCode).toBeNull();
    expect(proc.signalCode).toBeNull();
    expect(await isPidGone(programPid, 50)).toBe(false);

    writeFileSync(join(signalsDirectory, "release-program"), "exit");
    const exit = await exited;
    expect(exit.status).toBe(exitCode);
    expect(existsSync(join(signalsDirectory, receiptName))).toBe(true);

    // No orphaned op or program process may outlive opchain.
    expect(await isPidGone(opPid, 2_000)).toBe(true);
    expect(await isPidGone(programPid, 2_000)).toBe(true);
  } finally {
    killProcessGroup(proc);
  }
}

describe("op stop signals", () => {
  test.each([
    ["SIGTERM", 143],
    ["SIGINT", 130],
    ["SIGHUP", 129],
  ])(
    "reports op run ended by %s as its shell status",
    async (signal, expectedStatus) => {
      const signalsDirectory = mkdtempSync(
        join(tmpdir(), "opchain-signals-dir-"),
      );
      // hold mode with no signal handler: the fake op itself dies from the
      // forwarded signal, so opchain reports the child's signal status.
      const proc = spawnOpchain(
        ["run", "--", "sleep", "60"],
        signalsDirectory,
        { OPCHAIN_TEST_OP_SIGNALS_MODE: "hold" },
      );
      const opchainPid = requireOpchainPid(proc);
      try {
        const { opPid } = await readOpReady(signalsDirectory);

        process.kill(opchainPid, signal);

        const exit = await waitForExit(proc, 10_000);
        expect(exit.status).toBe(expectedStatus);
        expect(await isPidGone(opPid, 2_000)).toBe(true);
      } finally {
        killProcessGroup(proc);
      }
    },
    15_000,
  );
  test("forwards SIGTERM to op run and waits for the wrapped program", async () => {
    await expectForwardedToProgram("SIGTERM", "term-received", 42);
  }, 15_000);

  test("forwards SIGINT to op run and waits for the wrapped program", async () => {
    await expectForwardedToProgram("SIGINT", "int-received", 43);
  }, 15_000);

  test("forwards SIGHUP to op run and waits for the wrapped program", async () => {
    await expectForwardedToProgram("SIGHUP", "hup-received", 44);
  }, 15_000);

  test("forwards SIGTERM to a non-run op command and reports its signal status", async () => {
    const signalsDirectory = mkdtempSync(
      join(tmpdir(), "opchain-signals-dir-"),
    );
    // hold mode: a non-run command that never finishes on its own, so only
    // the forwarded signal can end it.
    const proc = spawnOpchain(["item", "list"], signalsDirectory, {
      OPCHAIN_TEST_OP_SIGNALS_MODE: "hold",
    });
    const opchainPid = requireOpchainPid(proc);
    try {
      const { opPid, programPid } = await readOpReady(signalsDirectory);
      expect(programPid).toBeNull();

      process.kill(opchainPid, "SIGTERM");

      const exit = await waitForExit(proc, 10_000);
      expect(exit.status).toBe(143);
      expect(await isPidGone(opPid, 2_000)).toBe(true);
    } finally {
      killProcessGroup(proc);
    }
  }, 15_000);

  test("escalates a signal-ignoring op through the timeout to SIGKILL", async () => {
    const signalsDirectory = mkdtempSync(
      join(tmpdir(), "opchain-signals-dir-"),
    );
    // ignore mode: `op` traps every stop signal without acting, so the
    // existing timeout must SIGTERM it, wait out the grace period, and
    // SIGKILL it.
    const proc = spawnOpchain(["item", "list"], signalsDirectory, {
      OPCHAIN_TEST_OP_SIGNALS_MODE: "ignore",
      OPCHAIN_OP_TIMEOUT_MS: "1000",
    });
    try {
      const exited = waitForExit(proc, 15_000);
      const { opPid } = await readOpReady(signalsDirectory);
      process.kill(requireOpchainPid(proc), "SIGINT");
      await waitForFile(join(signalsDirectory, "op-SIGINT-received"), 5_000);

      const exit = await exited;
      expect(exit.status).toBe(1);
      expect(exit.stderr).toContain(
        "1Password CLI command timed out after 1000ms",
      );
      expect(await isPidGone(opPid, 2_000)).toBe(true);
    } finally {
      killProcessGroup(proc);
    }
  }, 20_000);
});
