import { describe, expect, test } from "bun:test";

import {
  runTokenCommandAsync,
  TokenCommandError,
} from "../../src/token/command-backend.ts";
import { withEnv } from "../helpers/with-env.ts";

describe("runTokenCommandAsync", () => {
  test("resolves stdout on exit 0", async () => {
    const result = await runTokenCommandAsync("/bin/echo", ["hello"], {
      timeoutMs: 10_000,
    });

    expect(result).toEqual({ ok: true, stdout: "hello\n" });
  });

  test("reports an exit failure with the child's exit code", async () => {
    const result = await runTokenCommandAsync("/usr/bin/false", [], {
      timeoutMs: 10_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(TokenCommandError);
      expect(result.error.reason).toBe("exit");
      expect(result.error.exitCode).toBe(1);
    }
  });

  test("reports a start failure for a missing command", async () => {
    const result = await runTokenCommandAsync(
      "/nonexistent-opchain-test-command",
      [],
      { timeoutMs: 10_000 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("start");
    }
  });

  test("kills the child and reports timeout inside the deadline", async () => {
    const startedAt = Date.now();
    const result = await runTokenCommandAsync("/bin/sleep", ["30"], {
      timeoutMs: 150,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(5_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("timeout");
    }
  });

  test("reports stdout_limit when output exceeds the cap", async () => {
    await withEnv(
      { OPCHAIN_PROVIDER_STDOUT_MAX_BYTES: "16" },
      async () => {
        const result = await runTokenCommandAsync(
          "/bin/echo",
          ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
          { timeoutMs: 10_000 },
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.reason).toBe("stdout_limit");
        }
      },
    );
  });
});
