import type { CliOptions } from "./options.ts";
import {
  CLI_COMMAND_DEFINITIONS,
  type CliCommandDefinition,
  type CommandHandler,
} from "./manifest.ts";

type CommandRoute = {
  readonly exactLength?: number;
  readonly handler: CommandHandler;
  readonly offset: number;
  readonly subject: readonly [string, ...string[]];
};

/**
 * Expands one shared command definition into one or more matcher routes.
 *
 * @param definition - Shared command definition.
 * @returns {readonly CommandRoute[]} Route matchers derived from the manifest.
 */
function buildRoutesForDefinition(
  definition: CliCommandDefinition,
): readonly CommandRoute[] {
  const offset = definition.identityScoped ? 1 : 0;

  if (definition.kind === "command") {
    return [
      {
        exactLength: definition.exactLength,
        handler: definition.handler,
        offset,
        subject: [definition.name],
      },
    ];
  }

  return definition.children.map((child) => ({
    exactLength: child.exactLength,
    handler: child.handler,
    offset,
    subject: [definition.name, child.name],
  }));
}

const COMMAND_ROUTES: readonly CommandRoute[] = CLI_COMMAND_DEFINITIONS.flatMap(
  buildRoutesForDefinition,
);

/**
 * Checks whether parsed command tokens match one command route.
 *
 * @param commandArgs - Parsed command tokens.
 * @param route - Candidate command route.
 * @returns {boolean} True when the route matches the current command.
 */
function matchesRoute(
  commandArgs: readonly string[],
  route: CommandRoute,
): boolean {
  if (route.exactLength !== undefined && commandArgs.length !== route.exactLength) {
    return false;
  }

  if (commandArgs.length < route.offset + route.subject.length) {
    return false;
  }

  return route.subject.every(
    (token, index) => commandArgs[route.offset + index] === token,
  );
}

/**
 * Finds the handler for the current parsed command tokens.
 *
 * @param options - Parsed CLI options.
 * @returns {CommandHandler | null} Matching command handler or null when unsupported.
 */
export function findCommandHandler(options: CliOptions): CommandHandler | null {
  const route = COMMAND_ROUTES.find((candidate) =>
    matchesRoute(options.commandArgs, candidate),
  );

  return route?.handler ?? null;
}
