import type { Command } from "commander";

import { parseCliOptions, type CliOptions } from "./cli/options.ts";
import { buildProgram } from "./cli/program.ts";
import { findCommandHandler } from "./cli/routes.ts";
import { resolveCommandName, writeTelemetry } from "./cli/telemetry.ts";
import { createTelemetryEvent } from "./telemetry/event.ts";

/**
 * Dispatches parsed command tokens.
 *
 * @param options - Parsed CLI options.
 * @param program - Root command for help rendering.
 * @returns {Promise<number>} Process exit code.
 */
async function runCommand(
  options: CliOptions,
  program: Command,
): Promise<number> {
  if (options.help) {
    process.stdout.write(program.helpInformation());
    return 0;
  }

  const handler = findCommandHandler(options);
  if (handler === null) {
    process.stderr.write(program.helpInformation());
    return 1;
  }

  return handler(options);
}

/**
 * Runs the CLI entrypoint.
 *
 * @param argv - User-provided CLI arguments.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const options = parseCliOptions(argv);
  const program = buildProgram();

  writeTelemetry(
    options,
    createTelemetryEvent("cli.start", {
      command: resolveCommandName(options),
      debug_format: options.debugFormat,
    }),
  );

  return runCommand(options, program);
}

if (import.meta.main) {
  const exitCode = await main(Bun.argv.slice(2));
  process.exit(exitCode);
}
