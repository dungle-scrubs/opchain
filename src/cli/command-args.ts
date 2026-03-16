type CommandPath = readonly [string, ...string[]];

type CommandPathParseSuccess = {
  readonly ok: true;
  readonly trailingArgs: readonly string[];
};

type IdentityCommandPathParseSuccess = CommandPathParseSuccess & {
  readonly identityName: string;
};

type CommandPathParseFailure = {
  readonly error: string;
  readonly ok: false;
};

export type CommandPathParseResult =
  | CommandPathParseFailure
  | CommandPathParseSuccess;

export type IdentityCommandPathParseResult =
  | CommandPathParseFailure
  | IdentityCommandPathParseSuccess;

/**
 * Formats one stable invalid-command error for one expected command path.
 *
 * @param path - Expected command path tokens.
 * @returns {string} Printable invalid-shape error.
 */
function formatInvalidCommandShape(path: CommandPath): string {
  return `Invalid command shape for ${path.join(" ")}.`;
}

/**
 * Checks whether one command path matches at one starting offset.
 *
 * @param commandArgs - Full parsed command tokens.
 * @param path - Expected command path tokens.
 * @param offset - Starting offset inside `commandArgs`.
 * @returns {boolean} True when all path tokens match.
 */
function matchesCommandPath(
  commandArgs: readonly string[],
  path: CommandPath,
  offset: number,
): boolean {
  return path.every((token, index) => commandArgs[offset + index] === token);
}

/**
 * Parses one top-level command path and returns trailing args after the path.
 *
 * @param commandArgs - Full parsed command tokens.
 * @param path - Expected command path tokens.
 * @returns {CommandPathParseResult} Parsed trailing args or a stable error.
 */
export function parseCommandPath(
  commandArgs: readonly string[],
  path: CommandPath,
): CommandPathParseResult {
  if (
    commandArgs.length < path.length ||
    !matchesCommandPath(commandArgs, path, 0)
  ) {
    return {
      error: formatInvalidCommandShape(path),
      ok: false,
    };
  }

  return {
    ok: true,
    trailingArgs: commandArgs.slice(path.length),
  };
}

/**
 * Parses one identity-scoped command path and returns the identity plus trailing args.
 *
 * @param commandArgs - Full parsed command tokens.
 * @param path - Expected command path tokens after the identity.
 * @returns {IdentityCommandPathParseResult} Parsed identity/trailing args or a stable error.
 */
export function parseIdentityCommandPath(
  commandArgs: readonly string[],
  path: CommandPath,
): IdentityCommandPathParseResult {
  const identityName = commandArgs[0];
  if (identityName === undefined) {
    return {
      error: `Missing identity before ${path[0]} command.`,
      ok: false,
    };
  }

  if (
    commandArgs.length < path.length + 1 ||
    !matchesCommandPath(commandArgs, path, 1)
  ) {
    return {
      error: formatInvalidCommandShape(path),
      ok: false,
    };
  }

  return {
    identityName,
    ok: true,
    trailingArgs: commandArgs.slice(path.length + 1),
  };
}
