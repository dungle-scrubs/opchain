import type { CliOptions } from "../../src/cli/options.ts";

/**
 * Creates one minimal CLI options fixture with optional overrides.
 *
 * @param overrides - Partial CLI option overrides.
 * @returns {CliOptions} Stable CLI options fixture.
 */
export function createCliOptions(
  overrides: Partial<CliOptions> = {},
): CliOptions {
  return {
    accessOverride: undefined,
    allowEnvToken: false,
    commandArgs: [],
    debug: false,
    debugFormat: "text",
    explicitProfile: undefined,
    help: false,
    ...overrides,
  };
}
