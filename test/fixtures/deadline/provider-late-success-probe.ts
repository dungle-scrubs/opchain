/**
 * Isolated probe: a provider that succeeds after its deadline, while
 * the deadline timer has not dispatched yet, still reports timeout.
 *
 * Run only as its own Bun subprocess under the timer-slack preload
 * (`loosen-relay-timers.ts`), so the deadline timer dispatches well
 * after the provider's real completion. Only the runner's
 * completion-time timestamp check can then turn the late success into
 * a timeout. Prints one JSON line; exits 0 only for a timeout.
 */

import { runTokenCommandAsync } from "../../../src/token/command-backend.ts";

/** The probe's single JSON report. */
export type ProviderLateSuccessReport =
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly stdout: string };

const result = await runTokenCommandAsync(
  "/bin/sh",
  ["-c", "sleep 0.2; printf synthetic-provider-output"],
  { timeoutMs: 50 },
);
const outcome: ProviderLateSuccessReport = result.ok
  ? { ok: true, stdout: result.stdout }
  : { ok: false, reason: result.error.reason };

process.stdout.write(`${JSON.stringify(outcome)}\n`);
process.exit(!outcome.ok && outcome.reason === "timeout" ? 0 : 1);
