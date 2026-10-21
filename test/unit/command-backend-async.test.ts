import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runTokenCommandAsync,
  TokenCommandError,
} from "../../src/token/command-backend.ts";
import { withEnv } from "../helpers/with-env.ts";

const PROVIDER_MARKER_FIXTURE_PATH = join(
  process.cwd(),
  "test/fixtures/bin/provider-deadline-marker",
);

/** One deadline-fixture run: outcome, marker presence, and timing. */
type MarkerFixtureRun = {
  readonly elapsedMs: number;
  readonly markerExists: boolean;
  readonly result: Awaited<ReturnType<typeof runTokenCommandAsync>>;
};

/**
 * Runs the marker provider fixture under the given controls.
 *
 * @param options - Backend options (budget and optional absolute deadline).
 * @param fixture - Extra fixture environment (timing and signal knobs).
 * @returns {Promise<MarkerFixtureRun>} Marker presence, elapsed time, and result.
 */
async function runMarkerFixture(
  options: Parameters<typeof runTokenCommandAsync>[2],
  fixture: Record<string, string> = {},
): Promise<MarkerFixtureRun> {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-deadline-"));
  const markerPath = join(homePath, "started.marker");
  const startedAt = Date.now();
  const result = await withEnv(
    { OPCHAIN_TEST_HELPER_MARKER_PATH: markerPath, ...fixture },
    () => runTokenCommandAsync(PROVIDER_MARKER_FIXTURE_PATH, [], options),
  );

  return {
    elapsedMs: Date.now() - startedAt,
    markerExists: existsSync(markerPath),
    result,
  };
}

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
    await withEnv({ OPCHAIN_PROVIDER_STDOUT_MAX_BYTES: "16" }, async () => {
      const result = await runTokenCommandAsync(
        "/bin/echo",
        ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        { timeoutMs: 10_000 },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe("stdout_limit");
      }
    });
  });
});

describe("runTokenCommandAsync exhausted budgets (F1)", () => {
  test("a zero budget reports timeout, not start, for a missing command", async () => {
    // An exhausted budget must refuse before spawning: a missing
    // executable can then never surface its "start" failure, because
    // no subprocess is ever attempted.
    const result = await runTokenCommandAsync(
      "/nonexistent-opchain-test-command",
      [],
      { timeoutMs: 0 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(TokenCommandError);
      expect(result.error.reason).toBe("timeout");
    }
  });

  test("a negative budget reports timeout, not start, for a missing command", async () => {
    const result = await runTokenCommandAsync(
      "/nonexistent-opchain-test-command",
      [],
      { timeoutMs: -5 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("timeout");
    }
  });

  test("a zero budget returns timeout without starting the provider", async () => {
    const { markerExists, result } = await runMarkerFixture({ timeoutMs: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("timeout");
    }
    // The provider never started: exhausted work is refused, never run.
    expect(markerExists).toBe(false);
  }, 10_000);

  test("a negative budget returns timeout without starting the provider", async () => {
    const { markerExists, result } = await runMarkerFixture({ timeoutMs: -1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("timeout");
    }
    expect(markerExists).toBe(false);
  }, 10_000);
});

describe("runTokenCommandAsync absolute deadline (F1)", () => {
  test("arms the kill timer from the deadline, not the stale timeout", async () => {
    // The command finishes at ~350ms; the stale relative timeout would
    // let it succeed. The absolute deadline (150ms) must win instead,
    // and the marker proves it never got to complete its work.
    const { elapsedMs, markerExists, result } = await runMarkerFixture(
      {
        deadlineAt: Date.now() + 150,
        timeoutMs: 30_000,
      },
      {
        OPCHAIN_TEST_HELPER_MARKER_DELAY_MS: "300",
        OPCHAIN_TEST_HELPER_EXIT_AFTER_MS: "10",
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("timeout");
    }
    expect(markerExists).toBe(false);
    expect(elapsedMs).toBeLessThan(5_000);
  }, 10_000);

  test("a TERM-ignoring provider still escalates to KILL under the deadline", async () => {
    const { elapsedMs, markerExists, result } = await runMarkerFixture(
      {
        deadlineAt: Date.now() + 150,
        timeoutMs: 30_000,
      },
      { OPCHAIN_TEST_HELPER_IGNORE_TERM: "1" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("timeout");
    }
    // The marker was written before the deadline fired; the run is
    // ended by SIGKILL after the grace period, never by success.
    expect(markerExists).toBe(true);
    expect(elapsedMs).toBeLessThan(6_000);
  }, 15_000);
});
