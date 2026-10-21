import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RelaySetupExpiryReport } from "../fixtures/deadline/relay-setup-expiry-probe.ts";
import { runIsolatedProbe } from "../helpers/run-isolated-probe.ts";

const RELAY_SETUP_EXPIRY_PROBE_PATH =
  "test/fixtures/deadline/relay-setup-expiry-probe.ts";

describe("runValueRelay deadline during op setup (F1)", () => {
  test("a budget that expires after the token, before the op spawn, is a child timeout", async () => {
    // The probe's fake clock passes the deadline while the relay forms
    // the op child's environment and path, after its post-token check.
    // Only the op child's own pre-spawn check can refuse; without it the
    // nonexistent op path is spawned and fails as `spawn`.
    const workPath = mkdtempSync(join(tmpdir(), "opchain-relay-setup-"));
    const { code, report, stderrText } =
      await runIsolatedProbe<RelaySetupExpiryReport>(
        RELAY_SETUP_EXPIRY_PROBE_PATH,
        {
          args: [workPath],
          boundMs: 15_000,
          env: { HOME: workPath },
          timerSlackMs: 10_000,
        },
      );

    expect({ code, stderrText }).toEqual({ code: 0, stderrText: "" });
    expect(report).toEqual({
      clockAdvanced: true,
      exitCode: 1,
      providerRan: true,
      stderr: "opchain: relay: child-timeout\n",
    });
  }, 20_000);
});
