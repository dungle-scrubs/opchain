/**
 * Test preload that loosens every `setTimeout` the process schedules.
 *
 * The deadline counterexamples (a late final write, a child completing
 * just after the deadline) are scheduling races: a completion callback
 * dispatched after the deadline can still beat the deadline timer's
 * dispatch. Real timers make that window sub-millisecond, so this
 * preload widens it deterministically: every timer callback is delayed
 * by `OPCHAIN_TEST_TIMER_SLACK_MS` beyond its requested delay, while
 * `Date.now()` and `clearTimeout` keep their real semantics. Loaded
 * only into isolated relay CLI subprocesses spawned by the deadline
 * scheduling tests; never into the test runner itself.
 */

const slackMs = Number.parseInt(
  process.env.OPCHAIN_TEST_TIMER_SLACK_MS ?? "0",
  10,
);

if (Number.isSafeInteger(slackMs) && slackMs > 0) {
  const realSetTimeout = globalThis.setTimeout;

  const loosenedSetTimeout = (
    handler: Parameters<typeof realSetTimeout>[0],
    delay?: number,
    ...rest: unknown[]
  ): ReturnType<typeof realSetTimeout> => {
    const baseDelay = Math.max(0, Number(delay) || 0);
    return realSetTimeout(handler, baseDelay + slackMs, ...rest);
  };

  globalThis.setTimeout = Object.assign(
    loosenedSetTimeout,
    realSetTimeout,
  ) as typeof setTimeout;
}
