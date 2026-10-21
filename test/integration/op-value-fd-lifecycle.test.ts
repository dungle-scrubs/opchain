import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";
import { spawnBunCli } from "../helpers/run-relay.ts";

const OP_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/op");
const SECURITY_FIXTURE_PATH = join(process.cwd(), "test/fixtures/bin/security");
const REFERENCE = "op://Infra/reflect-intake-restic/password";

/**
 * Reports whether a process id is still alive.
 *
 * @param pid - Process id to probe.
 * @returns {boolean} True while the process exists.
 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { readonly code?: string }).code === "EPERM";
  }
}

type ChildProcessRow = {
  readonly command: string;
  readonly pid: number;
};

/**
 * Lists the direct children of one process.
 *
 * @param pid - Parent process id.
 * @returns {readonly ChildProcessRow[]} Child processes with commands.
 */
function childrenOf(pid: number): readonly ChildProcessRow[] {
  const listing = spawnSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
  });
  if (listing.stdout === undefined) {
    return [];
  }

  const rows: ChildProcessRow[] = [];
  for (const line of listing.stdout.split("\n")) {
    const match = /^(\s*\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match === null) {
      continue;
    }

    const parsedPid = Number.parseInt(match[1] ?? "", 10);
    const parsedPpid = Number.parseInt(match[2] ?? "", 10);
    const command = match[3] ?? "";
    if (Number.isNaN(parsedPid) || Number.isNaN(parsedPpid)) {
      continue;
    }

    if (parsedPpid === pid) {
      rows.push({ command, pid: parsedPid });
    }
  }

  return rows;
}

/**
 * Waits until the relay has started a child matching a predicate.
 *
 * @param pid - The opchain process id.
 * @param matches - Child command predicate.
 * @param timeoutMs - Give up after this long.
 * @returns {Promise<number | undefined>} The matching child's pid.
 */
async function waitForChild(
  pid: number,
  matches: (command: string) => boolean,
  timeoutMs: number,
): Promise<number | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = childrenOf(pid).find((row) => matches(row.command));
    if (found !== undefined) {
      return found.pid;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });
  }

  return undefined;
}

/**
 * Waits until a predicate holds, bounded by a timeout.
 *
 * @param predicate - Checked every 100 ms.
 * @param timeoutMs - Give up after this long.
 * @returns {Promise<boolean>} True when the predicate held in time.
 */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  return predicate();
}

type GroupRun = {
  readonly exitCode: Promise<number | null>;
  readonly killGroup: (signal: NodeJS.Signals) => void;
  readonly opchainPid: number;
};

/**
 * Starts one opchain relay run in its own process group, the way fleet's
 * caller does per D401, through the guarded stdio-flake-retry spawn.
 *
 * @param argv - Arguments after `bun run src/index.ts`.
 * @param env - Extra environment variables.
 * @returns {Promise<GroupRun>} Handle for the caller-owned process group.
 */
async function startRelayInOwnGroup(
  argv: readonly string[],
  env: Record<string, string> = {},
): Promise<GroupRun> {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-relay-life-"));
  writeAutoReadWriteConfig(homePath);

  const { child, completion } = await spawnBunCli(argv, {
    detached: true,
    env: {
      ...process.env,
      HOME: homePath,
      OPCHAIN_OP_PATH: OP_FIXTURE_PATH,
      OPCHAIN_SECURITY_PATH: SECURITY_FIXTURE_PATH,
      OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe", "pipe"],
  });

  // The guarded spawn drains every piped descriptor, so a completed
  // write can never block.
  return {
    exitCode: completion.then(({ code }) => code),
    killGroup: (signal) => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          // The group is already gone.
        }
      }
    },
    opchainPid: child.pid ?? -1,
  };
}

describe("relay process lifecycle under a caller-owned group", () => {
  test("a caller group kill during token resolution removes the provider", async () => {
    const run = await startRelayInOwnGroup(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      { OPCHAIN_TEST_SECURITY_SLEEP_MS: "30000" },
    );

    const providerPid = await waitForChild(
      run.opchainPid,
      (command) => command.includes("fixtures/bin/security"),
      20_000,
    );
    expect(providerPid).toBeDefined();

    // The read is cancelled: the caller kills opchain's whole group.
    run.killGroup("SIGKILL");

    const gone = await waitUntil(
      () => !pidAlive(providerPid ?? -1) && !pidAlive(run.opchainPid),
      10_000,
    );
    expect(gone).toBe(true);
  }, 40_000);

  test("a caller group kill removes a TERM-ignoring op child", async () => {
    const run = await startRelayInOwnGroup(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        OPCHAIN_TEST_OP_IGNORE_TERM: "1",
        OPCHAIN_OP_TIMEOUT_MS: "30000",
      },
    );

    const opPid = await waitForChild(
      run.opchainPid,
      (command) => command.includes("fixtures/bin/op read"),
      20_000,
    );
    expect(opPid).toBeDefined();
    expect(pidAlive(opPid ?? -1)).toBe(true);

    // The read is cancelled while the child ignores SIGTERM; the caller
    // kills opchain's whole group.
    run.killGroup("SIGKILL");

    const gone = await waitUntil(
      () => !pidAlive(opPid ?? -1) && !pidAlive(run.opchainPid),
      10_000,
    );
    expect(gone).toBe(true);
  }, 40_000);

  test("the deadline escalation kills a TERM-ignoring child itself", async () => {
    const run = await startRelayInOwnGroup(
      ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE],
      {
        OPCHAIN_TEST_OP_IGNORE_TERM: "1",
        OPCHAIN_OP_TIMEOUT_MS: "1500",
      },
    );

    const opPid = await waitForChild(
      run.opchainPid,
      (command) => command.includes("fixtures/bin/op read"),
      20_000,
    );
    expect(opPid).toBeDefined();

    // TERM at 1.5 s is ignored; SIGKILL lands by ~3.5 s and the relay
    // exits 1 with the child-timeout identifier.
    const exitCode = await run.exitCode;
    expect(exitCode).toBe(1);
    const gone = await waitUntil(() => !pidAlive(opPid ?? -1), 10_000);
    expect(gone).toBe(true);
  }, 40_000);
});
