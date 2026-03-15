import { createTelemetryEvent, type TelemetryEvent } from "../telemetry/event.ts";

import { parseCliOptions, type CliOptions } from "./options.ts";
import { buildProgram } from "./program.ts";
import { findCommandHandler } from "./routes.ts";
import { resolveCommandName, writeTelemetry } from "./telemetry.ts";

export type HelpProgram = {
  readonly helpInformation: () => string;
};

export type CliRuntimeDeps = {
  readonly buildProgram: () => HelpProgram;
  readonly findCommandHandler: (
    options: CliOptions,
  ) => ((options: CliOptions) => Promise<number>) | null;
  readonly parseCliOptions: (argv: readonly string[]) => CliOptions;
  readonly resolveCommandName: (options: CliOptions) => string;
  readonly writeStderr: (text: string) => void;
  readonly writeStdout: (text: string) => void;
  readonly writeTelemetry: (options: CliOptions, event: TelemetryEvent) => void;
};

const DEFAULT_RUNTIME_DEPS: CliRuntimeDeps = {
  buildProgram,
  findCommandHandler,
  parseCliOptions,
  resolveCommandName,
  writeStderr: (text) => {
    process.stderr.write(text);
  },
  writeStdout: (text) => {
    process.stdout.write(text);
  },
  writeTelemetry,
};

/**
 * Runs the CLI runtime from raw argv using injectable dependencies.
 *
 * @param argv - User-provided CLI arguments.
 * @param deps - Runtime dependencies for parsing, dispatch, and output.
 * @returns {Promise<number>} Process exit code.
 */
export async function runCli(
  argv: readonly string[],
  deps: CliRuntimeDeps = DEFAULT_RUNTIME_DEPS,
): Promise<number> {
  const options = deps.parseCliOptions(argv);
  const program = deps.buildProgram();

  deps.writeTelemetry(
    options,
    createTelemetryEvent("cli.start", {
      command: deps.resolveCommandName(options),
      debug_format: options.debugFormat,
    }),
  );

  if (options.help) {
    deps.writeStdout(program.helpInformation());
    return 0;
  }

  const handler = deps.findCommandHandler(options);
  if (handler === null) {
    deps.writeStderr(program.helpInformation());
    return 1;
  }

  return handler(options);
}
