import {
  createTelemetryEvent,
  type TelemetryEvent,
} from "../telemetry/event.ts";

import { parseCliOptions, type CliOptions } from "./options.ts";
import { buildProgram } from "./program.ts";
import { findCommandDispatch } from "./routes.ts";
import { resolveCommandName, writeTelemetry } from "./telemetry.ts";
import type { CommandRequest } from "./command-request.ts";
import type { CommandHandler } from "./manifest.ts";

export type HelpProgram = {
  readonly helpInformation: () => string;
};

export type CliRuntimeDeps = {
  readonly buildProgram: () => HelpProgram;
  readonly findCommandDispatch: (options: CliOptions) => {
    readonly handler: CommandHandler;
    readonly request: CommandRequest;
  } | null;
  readonly parseCliOptions: (argv: readonly string[]) => CliOptions;
  readonly resolveCommandName: (options: CliOptions) => string;
  readonly writeStderr: (text: string) => void;
  readonly writeStdout: (text: string) => void;
  readonly writeTelemetry: (options: CliOptions, event: TelemetryEvent) => void;
};

const DEFAULT_RUNTIME_DEPS: CliRuntimeDeps = {
  buildProgram,
  findCommandDispatch,
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

  if (options.parseError !== undefined) {
    deps.writeStderr(`${options.parseError}\n`);
    return 1;
  }

  const dispatch = deps.findCommandDispatch(options);
  if (dispatch === null) {
    deps.writeStderr(program.helpInformation());
    return 1;
  }

  const result = await dispatch.handler(dispatch.request);
  if (result.stdout.length > 0) {
    deps.writeStdout(result.stdout);
  }
  if (result.stderr.length > 0) {
    deps.writeStderr(result.stderr);
  }

  return result.exitCode;
}
