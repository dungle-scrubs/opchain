import { describe, expect, test } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";

/**
 * Runs `opchain primary --read op ...` against the fake op, with a child
 * timeout far shorter than the fake op's run time.
 *
 * @param opArgs - Arguments passed after `op`.
 * @returns {SpawnSyncReturns<string>} Child-process result.
 */
function runSlowOp(opArgs: readonly string[]): SpawnSyncReturns<string> {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
  writeAutoReadWriteConfig(homePath);

  return spawnSync(
    process.execPath,
    ["run", "src/index.ts", "primary", "--read", "op", ...opArgs],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homePath,
        OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
        OPCHAIN_OP_TIMEOUT_MS: "50",
        OPCHAIN_SECURITY_PATH: join(
          process.cwd(),
          "test/fixtures/bin/security",
        ),
        OPCHAIN_TEST_OP_PASSTHROUGH: "1",
        OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
        OPCHAIN_TEST_OP_SLEEP_MS: "300",
      },
    },
  );
}

describe("op child timeout", () => {
  test("never times out op run, whose lifetime is the wrapped program", () => {
    const result = runSlowOp(["run", "--", "true"]);

    expect(result.stderr).not.toContain("timed out");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("run ok\n");
  });

  test("never times out op run behind global flags", () => {
    const result = runSlowOp(["--account", "acme", "run", "--", "true"]);

    expect(result.stderr).not.toContain("timed out");
    expect(result.status).toBe(0);
  });

  test("still times out other op commands", () => {
    const result = runSlowOp(["item", "list"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "1Password CLI command timed out after 50ms",
    );
  });
});
