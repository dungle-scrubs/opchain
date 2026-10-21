import { parseFlagArguments } from "./flag-args.ts";

const DEBUG_FORMATS = ["json", "text"] as const;
const ROOT_BOOLEAN_FLAGS = new Set(["--debug", "--help", "-h"]);
const ROOT_VALUE_FLAGS = new Set(["--debug-format"]);
const OP_BOOLEAN_FLAGS = new Set([
  "--read",
  "--write",
  "--allow-env-token",
  "--allow-reveal",
  "--pass-token",
]);
const OP_VALUE_FLAGS = new Set(["--profile", "--value-fd"]);

/**
 * Every op-execution flag name, for messages that name a misplaced flag.
 *
 * These flags apply only to `op` commands; other commands reject them.
 */
export const OP_EXECUTION_FLAGS: readonly string[] = [
  ...OP_VALUE_FLAGS,
  ...OP_BOOLEAN_FLAGS,
];

export type DebugFormat = (typeof DEBUG_FORMATS)[number];

export type AccessOverride = "read" | "write";

export type CliOptions = {
  readonly accessOverride: AccessOverride | undefined;
  readonly allowEnvToken: boolean;
  readonly allowReveal: boolean;
  readonly passToken: boolean;
  readonly commandArgs: readonly string[];
  readonly debug: boolean;
  readonly debugFormat: DebugFormat;
  readonly explicitProfile: string | undefined;
  readonly help: boolean;
  readonly parseError?: string;
  readonly valueFd?: string;
  /** True when a --value-fd spelling appeared in the op option prefix. */
  readonly valueFdIntent?: boolean;
  /** True when option parsing failed on the --value-fd value itself. */
  readonly valueFdMalformed?: boolean;
  /** True when option parsing refused the line outright; the relay renders grammar. */
  readonly relayParseRefused?: boolean;
};

type ParsedIdentityOpCommand = {
  readonly accessOverride: AccessOverride | undefined;
  readonly allowEnvToken: boolean;
  readonly allowReveal: boolean;
  readonly passToken: boolean;
  readonly commandArgs: readonly string[];
  readonly explicitProfile: string | undefined;
  readonly parseError?: string;
  readonly valueFd: string | undefined;
  /** True when a --value-fd spelling appeared in the op option prefix. */
  readonly valueFdIntent?: boolean;
  /** True when the parse failed on the --value-fd value itself. */
  readonly valueFdMalformed?: boolean;
  /** True when option parsing refused the line outright; the relay renders grammar. */
  readonly relayParseRefused?: boolean;
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
    // A relay-intent line keeps its routing even when parsing fails, so
    // the relay renders one anchored identifier instead of the generic
    // parser message. The read/write intent is recovered from the raw
    // tokens so the relay grammar still sees the real flags.
    const valueFdIntent = flagTokens.includes("--value-fd");
    const hasRead = flagTokens.includes("--read");
    const hasWrite = flagTokens.includes("--write");
    return {
      accessOverride:
        hasRead && !hasWrite
          ? "read"
          : hasWrite && !hasRead
            ? "write"
            : undefined,
      allowEnvToken: false,
      allowReveal: false,
      passToken: false,
      commandArgs: [identity, "op", ...opArgs],
      explicitProfile: undefined,
      parseError: valueFdIntent ? undefined : parsedFlags.error.message,
      valueFd: undefined,
      valueFdIntent: valueFdIntent || undefined,
      valueFdMalformed: parsedFlags.error.flag === "--value-fd" || undefined,
    };
  }

  if (parsedFlags.unparsedTokens.length > 0) {
    return null;
  }

  if (
    parsedFlags.booleanFlags.has("--read") &&
    parsedFlags.booleanFlags.has("--write")
  ) {
    const valueFd = parsedFlags.valueFlags.get("--value-fd");
    return {
      accessOverride: undefined,
      allowEnvToken: parsedFlags.booleanFlags.has("--allow-env-token"),
      allowReveal: parsedFlags.booleanFlags.has("--allow-reveal"),
      passToken: parsedFlags.booleanFlags.has("--pass-token"),
      commandArgs: [identity, "op", ...opArgs],
      explicitProfile: parsedFlags.valueFlags.get("--profile"),
      // The relay owns this refusal: forbidden flag combinations on a
      // relay line render as `relay: grammar`.
      parseError:
        valueFd === undefined
          ? "Cannot pass both --read and --write."
          : undefined,
      valueFd,
      valueFdIntent: valueFd !== undefined || undefined,
    };
  }

  return {
    accessOverride: parsedFlags.booleanFlags.has("--write")
      ? "write"
      : parsedFlags.booleanFlags.has("--read")
        ? "read"
        : undefined,
    allowEnvToken: parsedFlags.booleanFlags.has("--allow-env-token"),
    allowReveal: parsedFlags.booleanFlags.has("--allow-reveal"),
    passToken: parsedFlags.booleanFlags.has("--pass-token"),
    commandArgs: [identity, "op", ...opArgs],
    explicitProfile: parsedFlags.valueFlags.get("--profile"),
    valueFd: parsedFlags.valueFlags.get("--value-fd"),
    valueFdIntent: parsedFlags.valueFlags.has("--value-fd") || undefined,
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
 * Finds the `op` envelope boundary marker index in the raw argument vector.
 *
 * Scans left to right, skipping the value that follows a root value flag so a
 * `--debug-format op` value is not mistaken for the marker. Returns the index of
 * the first genuine `op` marker, or -1 when the argument vector has no envelope.
 *
 * @param argv - User-provided CLI arguments.
 * @returns {number} Index of the `op` marker, or -1 when absent.
 */
function findOpEnvelopeIndex(argv: readonly string[]): number {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (ROOT_VALUE_FLAGS.has(token)) {
      index += 1;
      continue;
    }

    if (token === "op") {
      return index;
    }
  }

  return -1;
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
 * Splits attached `--value-fd=<value>` spellings into separate tokens,
 * but only inside opchain's own option prefix.
 *
 * Everything after the `op` boundary marker is delegated `op` argv -
 * including a wrapped program's arguments after `--` - and must pass
 * through byte for byte, so the boundary is located on the raw argv
 * before any splitting. Any resulting value, integer or not, reaches
 * the relay descriptor checks, which refuse non-integers fail-closed.
 *
 * @param argv - User-provided CLI arguments.
 * @returns {readonly string[]} Arguments with attached --value-fd spellings split before the op marker.
 */
function expandAttachedValueFd(argv: readonly string[]): readonly string[] {
  const opBoundary = findOpEnvelopeIndex(argv);
  const prefix = opBoundary === -1 ? argv : argv.slice(0, opBoundary);
  const suffix = opBoundary === -1 ? [] : argv.slice(opBoundary);

  const expanded: string[] = [];
  for (const token of prefix) {
    if (token.startsWith("--value-fd=")) {
      expanded.push("--value-fd", token.slice("--value-fd=".length));
      continue;
    }

    expanded.push(token);
  }

  return [...expanded, ...suffix];
}

/**
 * Recovers relay intent from a raw argv that option parsing refused or
 * could not shape into an envelope.
 *
 * Whenever `--value-fd` appears in opchain's own option prefix with an
 * `op` marker and an identity token, the line belongs to the relay
 * route even when parsing fails on another token (an unknown option, a
 * root-parser error): the relay then renders one anchored identifier
 * instead of the generic parser message.
 *
 * @param argv - Normalized CLI arguments.
 * @returns {ParsedIdentityOpCommand | null} A grammar-refusal candidate, or null when the line carries no relay intent.
 */
function synthesizeRelayIntent(
  argv: readonly string[],
): ParsedIdentityOpCommand | null {
  const opBoundary = findOpEnvelopeIndex(argv);
  if (opBoundary < 1) {
    return null;
  }

  const prefix = argv.slice(0, opBoundary);
  const hasValueFd = prefix.some(
    (token) => token === "--value-fd" || token.startsWith("--value-fd="),
  );
  if (!hasValueFd) {
    return null;
  }

  const identity = prefix.find((token) => !token.startsWith("-"));
  if (identity === undefined) {
    return null;
  }

  return {
    accessOverride: undefined,
    allowEnvToken: false,
    allowReveal: false,
    passToken: false,
    commandArgs: [identity, "op", ...argv.slice(opBoundary + 1)],
    explicitProfile: undefined,
    relayParseRefused: true,
    valueFd: undefined,
    valueFdIntent: true,
  };
}
export function parseCliOptions(argv: readonly string[]): CliOptions {
  const normalizedArgv = expandAttachedValueFd(argv);
  const opEnvelopeIndex = findOpEnvelopeIndex(normalizedArgv);
  const rootFlagTokens =
    opEnvelopeIndex === -1
      ? normalizedArgv
      : normalizedArgv.slice(0, opEnvelopeIndex);
  const opEnvelopeTokens =
    opEnvelopeIndex === -1 ? [] : normalizedArgv.slice(opEnvelopeIndex);

  const parsedRootFlags = parseFlagArguments(rootFlagTokens, {
    booleanFlags: ROOT_BOOLEAN_FLAGS,
    valueFlags: ROOT_VALUE_FLAGS,
  });

  if (!parsedRootFlags.ok) {
    // A relay-intent line still routes to the relay, whose grammar
    // refusal is the one anchored identifier for the line.
    const rootRelayCandidate = synthesizeRelayIntent(normalizedArgv);
    if (rootRelayCandidate !== null) {
      // Root flags failed to parse; the relay candidate routes on its
      // own and the refusal is the relay's, so no root flag applies.
      return assembleCliOptions(
        rootRelayCandidate,
        [],
        {
          booleanFlags: new Set<string>(),
          valueFlags: new Map<string, string>(),
        },
        argv,
      );
    }

    return {
      accessOverride: undefined,
      allowEnvToken: false,
      allowReveal: false,
      passToken: false,
      commandArgs: [],
      debug: false,
      debugFormat: "text",
      explicitProfile: undefined,
      help: false,
      parseError: parsedRootFlags.error.message,
      valueFd: undefined,
    };
  }

  const commandTokens = [
    ...parsedRootFlags.unparsedTokens,
    ...opEnvelopeTokens,
  ];

  const parsedIdentityOpCommand =
    parseIdentityOpCommand(commandTokens) ??
    synthesizeRelayIntent(normalizedArgv);

  return assembleCliOptions(
    parsedIdentityOpCommand,
    commandTokens,
    parsedRootFlags,
    argv,
  );
}

type ParsedRootFlags = {
  readonly booleanFlags: ReadonlySet<string>;
  readonly valueFlags: ReadonlyMap<string, string>;
};

/**
 * Assembles the final CLI options from one parsed op candidate.
 *
 * @param candidate - Parsed identity op command, or undefined.
 * @param commandTokens - Positional command tokens after root stripping.
 * @param parsedRootFlags - Parsed root flags.
 * @param argv - Raw user-provided arguments.
 * @returns {CliOptions} Parsed CLI options.
 */
function assembleCliOptions(
  candidate: ParsedIdentityOpCommand | null,
  commandTokens: readonly string[],
  parsedRootFlags: ParsedRootFlags,
  argv: readonly string[],
): CliOptions {
  return {
    accessOverride: candidate?.accessOverride,
    allowEnvToken: candidate?.allowEnvToken ?? false,
    allowReveal: candidate?.allowReveal ?? false,
    passToken: candidate?.passToken ?? false,
    commandArgs: candidate?.commandArgs ?? commandTokens,
    debug: parsedRootFlags.booleanFlags.has("--debug"),
    debugFormat: normalizeDebugFormat(
      parsedRootFlags.valueFlags.get("--debug-format"),
    ),
    explicitProfile: candidate?.explicitProfile,
    help:
      argv.length === 0 ||
      parsedRootFlags.booleanFlags.has("--help") ||
      parsedRootFlags.booleanFlags.has("-h"),
    valueFd: candidate?.valueFd,
    valueFdIntent: candidate?.valueFdIntent,
    valueFdMalformed: candidate?.valueFdMalformed,
    ...(candidate?.parseError === undefined
      ? {}
      : { parseError: candidate.parseError }),
  };
}
