import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { runRelay } from "../helpers/run-relay.ts";

const REFERENCE = "op://Infra/reflect-intake-restic/password";
const ARGV = ["primary", "--read", "--value-fd", "3", "op", "read", REFERENCE];

describe("op --value-fd spawn errors", () => {
  test("a synchronous spawn throw reports only the spawn identifier", async () => {
    const run = await runRelay(ARGV, { env: { OPCHAIN_OP_PATH: "" } });

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: spawn\n");
    expect(run.stdoutText).toBe("");
    expect(run.valueBytes.length).toBe(0);
    // The provider ran; the op child never started.
    expect(existsSync(run.securityLogPath)).toBe(true);
    expect(existsSync(run.opLogPath)).toBe(false);
  });

  test("a missing executable reports only the spawn identifier", async () => {
    const run = await runRelay(ARGV, {
      env: { OPCHAIN_OP_PATH: join("/nonexistent", "opchain-missing-op") },
    });

    expect(run.result).toEqual({ code: 1, signal: null });
    expect(run.stderrText).toBe("opchain: relay: spawn\n");
    expect(run.stdoutText).toBe("");
    expect(run.valueBytes.length).toBe(0);
    expect(run.stderrText).not.toContain("opchain-missing-op");
    expect(run.stderrText).not.toContain("Infra");
    expect(existsSync(run.securityLogPath)).toBe(true);
    expect(existsSync(run.opLogPath)).toBe(false);
  });
});
