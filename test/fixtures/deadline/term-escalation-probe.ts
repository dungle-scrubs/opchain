/**
 * Isolated probe: a TERM-ignoring provider is escalated to SIGKILL
 * after the grace period once the deadline fires.
 *
 * The probe owns the runner's time boundary until the provider is
 * ready. `Date.now` is frozen, and the runner's initial deadline timer
 * is captured instead of armed, so the deadline cannot fire before the
 * fixture has installed its TERM trap however slowly the shell starts.
 * Once the readiness marker exists (written after the trap), the fake
 * clock advances to the deadline and the captured callback is
 * dispatched by hand; the SIGKILL grace timer it arms runs on the real
 * clock. Run only as its own Bun subprocess, so the time patches never
 * reach the test runner. Prints one JSON line and exits.
 *
 * Environment: OPCHAIN_TEST_HELPER_MARKER_PATH, OPCHAIN_TEST_HELPER_PID_PATH,
 * and OPCHAIN_TEST_HELPER_IGNORE_TERM for the fixture.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runTokenCommandAsync } from "../../../src/token/command-backend.ts";

/** Logical deadline handed to the runner, relative to the frozen clock. */
const DEADLINE_MS = 150;
/** Real-time bound on waiting for the fixture's readiness marker. */
const MARKER_WAIT_BOUND_MS = 5_000;
/** Real-time bound on the escalated run settling after dispatch. */
const SETTLE_BOUND_MS = 8_000;

type Handler = Parameters<typeof setTimeout>[0];

/** The probe's single JSON report. */
export type TermEscalationReport = {
  readonly afterDispatchMs: number;
  readonly capturedDelayMs: number | null;
  readonly failure?: string;
  readonly markerExists: boolean;
  readonly providerAlive: boolean;
  readonly reason: string;
};

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realDateNow = Date.now;
const markerPath = process.env.OPCHAIN_TEST_HELPER_MARKER_PATH ?? "";
const pidPath = process.env.OPCHAIN_TEST_HELPER_PID_PATH ?? "";

/**
 * Reports whether a pid still names a live (unreaped) process.
 *
 * @param pid - Process id to probe with signal 0.
 * @returns {boolean} True while the process exists.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the provider pid the fixture recorded, when it did.
 *
 * @returns {number | null} Provider pid, or null before the fixture wrote it.
 */
function readProviderPid(): number | null {
  if (!existsSync(pidPath)) {
    return null;
  }
  const pid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Waits on the real clock until the marker exists or the bound passes.
 *
 * @returns {Promise<boolean>} True once the marker exists.
 */
async function waitForMarker(): Promise<boolean> {
  const startedAt = realDateNow();
  while (realDateNow() - startedAt < MARKER_WAIT_BOUND_MS) {
    if (existsSync(markerPath)) {
      return true;
    }
    await new Promise((resolve) => realSetTimeout(resolve, 10));
  }
  return existsSync(markerPath);
}

/**
 * Prints the report and exits with its status.
 *
 * @param outcome - Probe outcome.
 * @returns {never} Never returns.
 */
function report(outcome: TermEscalationReport): never {
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  process.exit(outcome.failure === undefined ? 0 : 1);
}

let fakeNow = realDateNow();
let captured: { readonly delayMs: number; readonly handler: Handler } | null =
  null;
let placeholder: ReturnType<typeof setTimeout> | undefined;

try {
  Date.now = () => fakeNow;
  // Only the runner's initial deadline timer is captured; any other
  // timer passes straight through to the real implementation.
  globalThis.setTimeout = Object.assign(
    (handler: Handler, delay?: number, ...rest: unknown[]) => {
      if (captured === null && delay === DEADLINE_MS) {
        captured = { delayMs: delay, handler };
        // A real, cancellable handle the runner can clear on settle.
        placeholder = realSetTimeout(() => {}, 2 ** 31 - 1);
        return placeholder;
      }
      return realSetTimeout(handler, delay, ...rest);
    },
    realSetTimeout,
  ) as typeof setTimeout;

  const run = runTokenCommandAsync(
    join(process.cwd(), "test/fixtures/bin/provider-deadline-marker"),
    [],
    { deadlineAt: fakeNow + DEADLINE_MS, timeoutMs: 30_000 },
  );
  // Restored before dispatch: the grace timer must use the real clock.
  globalThis.setTimeout = realSetTimeout;

  const capturedTimer = captured as {
    readonly delayMs: number;
    readonly handler: Handler;
  } | null;
  const markerExists = await waitForMarker();
  if (capturedTimer === null || !markerExists) {
    const pid = readProviderPid();
    if (pid !== null && isAlive(pid)) {
      process.kill(pid, "SIGKILL");
    }
    report({
      afterDispatchMs: 0,
      capturedDelayMs: capturedTimer?.delayMs ?? null,
      failure: capturedTimer === null ? "no-deadline-timer" : "no-marker",
      markerExists,
      providerAlive: false,
      reason: "",
    });
  }

  const providerPid = readProviderPid();
  fakeNow += DEADLINE_MS;
  const dispatchedAt = realDateNow();
  (capturedTimer.handler as () => void)();

  let bound: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    run,
    new Promise<null>((resolve) => {
      bound = realSetTimeout(() => resolve(null), SETTLE_BOUND_MS);
    }),
  ]);
  realClearTimeout(bound);
  const afterDispatchMs = realDateNow() - dispatchedAt;
  const providerAlive = providerPid !== null && isAlive(providerPid);
  if (providerAlive && providerPid !== null) {
    process.kill(providerPid, "SIGKILL");
  }

  report({
    afterDispatchMs,
    capturedDelayMs: capturedTimer.delayMs,
    ...(result === null
      ? { failure: "unsettled" }
      : providerPid === null
        ? { failure: "no-pid" }
        : {}),
    markerExists,
    providerAlive,
    reason: result === null ? "" : result.ok ? "success" : result.error.reason,
  });
} finally {
  globalThis.setTimeout = realSetTimeout;
  Date.now = realDateNow;
  realClearTimeout(placeholder);
}
