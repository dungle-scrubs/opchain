import { parseFlagArguments } from "./flag-args.ts";

const DEBUG_FORMATS = ["json", "text"] as const;
const ROOT_BOOLEAN_FLAGS = new Set(["--debug", "--help", "-h"]);
const ROOT_VALUE_FLAGS = new Set(["--debug-format"]);
const OP_BOOLEAN_FLAGS = new Set(["--read", "--write", "--allow-env-token"]);
const OP_VALUE_FLAGS = new Set(["--profile"]);

export type DebugFormat = (typeof DEBUG_FORMATS)[number];

export type AccessOverride = "read" | "write";

export type CliOptions = {
  readonly accessOverride: AccessOverride | undefined;
  readonly allowEnvToken: boolean;
  readonly commandArgs: readonly string[];
  readonly debug: boolean;
  readonly debugFormat: DebugFormat;
  readonly explicitProfile: string | undefined;
  readonly help: boolean;
  readonly parseError?: string;
};

type ParsedIdentityOpCommand = {
  readonly accessOverride: AccessOverride | undefined;
  readonly allowEnvToken: boolean;
  readonly commandArgs: readonly string[];
  readonly explicitProfile: string | undefined;
  readonly parseError?: string;
};

/**
 * Builds one parsed identity-scoped `op` command candidate when all other prefix
 * tokens are valid `op` flags.
 *
 * @param prefixTokens - Tokens before the `op` marker.
 * @param opArgs - Tokens after the `op` marker.
 * @param identityIndex - Candidate identity position inside `prefixTokens`.
 * @returns {ParsedIdentityOpCommand | null} Parsed command or null when invalid.
 */
function buildIdentityOpCandidate(
  prefixTokens: readonly string[],
  opArgs: readonly string[],
  identityIndex: number,
): ParsedIdentityOpCommand | null {
  const identity = prefixTokens[identityIndex];
  if (identity === undefined || identity.startsWith("-")) {
    return null;
  }

  const flagTokens = [
    ...prefixTokens.slice(0, identityIndex),
    ...prefixTokens.slice(identityIndex + 1),
  ];
  const parsedFlags = parseFlagArguments(flagTokens, {
    booleanFlags: OP_BOOLEAN_FLAGS,
    valueFlags: OP_VALUE_FLAGS,
  });

  if (!parsedFlags.ok) {
    return {
      accessOverride: undefined,
      allowEnvToken: false,
      commandArgs: [identity, "op", ...opArgs],
      explicitProfile: undefined,
      parseError: parsedFlags.error.message,
    };
  }

  if (parsedFlags.unparsedTokens.length > 0) {
    return null;
  }

  if (
    parsedFlags.booleanFlags.has("--read") &&
    parsedFlags.booleanFlags.has("--write")
  ) {
    return {
      accessOverride: undefined,
      allowEnvToken: parsedFlags.booleanFlags.has("--allow-env-token"),
      commandArgs: [identity, "op", ...opArgs],
      explicitProfile: parsedFlags.valueFlags.get("--profile"),
      parseError: "Cannot pass both --read and --write.",
    };
  }

  return {
    accessOverride: parsedFlags.booleanFlags.has("--write")
      ? "write"
      : parsedFlags.booleanFlags.has("--read")
        ? "read"
        : undefined,
    allowEnvToken: parsedFlags.booleanFlags.has("--allow-env-token"),
    commandArgs: [identity, "op", ...opArgs],
    explicitProfile: parsedFlags.valueFlags.get("--profile"),
  };
}

/**
 * Parses one identity-scoped `op` envelope only when the prefix shape is valid.
 *
 * Valid shapes are the documented identity-first form and the existing
 * compatibility form where flags appear before the identity.
 *
 * @param commandArgs - Positional command tokens after root flag stripping.
 * @returns {ParsedIdentityOpCommand | null} Parsed `op` command or null when the envelope is invalid.
 */
function parseIdentityOpCommand(
  commandArgs: readonly string[],
): ParsedIdentityOpCommand | null {
  const opIndex = commandArgs.indexOf("op");
  if (opIndex < 1) {
    return null;
  }

  const prefixTokens = commandArgs.slice(0, opIndex);
  const opArgs = commandArgs.slice(opIndex + 1);
  const candidateIndices = [...new Set([0, prefixTokens.length - 1])];

  for (const identityIndex of candidateIndices) {
    const parsedCandidate = buildIdentityOpCandidate(
      prefixTokens,
      opArgs,
      identityIndex,
    );
    if (parsedCandidate !== null) {
      return parsedCandidate;
    }
  }

  return null;
}

/**
 * Normalizes the debug format token.
 *
 * @param input - Raw parsed debug format value.
 * @returns {DebugFormat} Supported debug format.
 */
function normalizeDebugFormat(input: string | undefined): DebugFormat {
  return DEBUG_FORMATS.includes(input as DebugFormat)
    ? (input as DebugFormat)
    : "text";
}

/**
 * Parses the current CLI options and strips handled global flags.
 *
 * @param argv - User-provided CLI arguments.
 * @returns {CliOptions} Parsed CLI options.
 */
export function parseCliOptions(argv: readonly string[]): CliOptions {
  const parsedRootFlags = parseFlagArguments(argv, {
    booleanFlags: ROOT_BOOLEAN_FLAGS,
    valueFlags: ROOT_VALUE_FLAGS,
  });

  if (!parsedRootFlags.ok) {
    return {
      accessOverride: undefined,
      allowEnvToken: false,
      commandArgs: [],
      debug: false,
      debugFormat: "text",
      explicitProfile: undefined,
      help: false,
      parseError: parsedRootFlags.error.message,
    };
  }

  const parsedIdentityOpCommand = parseIdentityOpCommand(
    parsedRootFlags.unparsedTokens,
  );

  return {
    accessOverride: parsedIdentityOpCommand?.accessOverride,
    allowEnvToken: parsedIdentityOpCommand?.allowEnvToken ?? false,
    commandArgs:
      parsedIdentityOpCommand?.commandArgs ?? parsedRootFlags.unparsedTokens,
    debug: parsedRootFlags.booleanFlags.has("--debug"),
    debugFormat: normalizeDebugFormat(
      parsedRootFlags.valueFlags.get("--debug-format"),
    ),
    explicitProfile: parsedIdentityOpCommand?.explicitProfile,
    help:
      argv.length === 0 ||
      parsedRootFlags.booleanFlags.has("--help") ||
      parsedRootFlags.booleanFlags.has("-h"),
    ...(parsedIdentityOpCommand?.parseError === undefined
      ? {}
      : { parseError: parsedIdentityOpCommand.parseError }),
  };
}
