import { spawnSync, type SpawnSyncReturns } from "node:child_process";

/**
 * Runs the CLI through Bun with a stable test environment.
 *
 * @param args - CLI arguments to pass after `bun run src/index.ts`.
 * @returns {SpawnSyncReturns<string>} Child-process result with captured text output.
 */
export function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["run", "src/index.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      SHOULD_NOT_LEAK: "SHOULD_NOT_LEAK",
    },
  });
}
