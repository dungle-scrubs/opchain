type FlagArgumentParserConfig = {
  readonly booleanFlags: ReadonlySet<string>;
  readonly valueFlags: ReadonlySet<string>;
};

type ParsedFlagArgumentsSuccess = {
  readonly booleanFlags: ReadonlySet<string>;
  readonly ok: true;
  readonly positionals: readonly string[];
  readonly unknownOptions: readonly string[];
  readonly unparsedTokens: readonly string[];
  readonly valueFlags: ReadonlyMap<string, string>;
};

type ParsedFlagArgumentsFailure = {
  readonly error: {
    readonly flag: string;
    readonly message: string;
  };
  readonly ok: false;
};

export type ParsedFlagArguments =
  | ParsedFlagArgumentsFailure
  | ParsedFlagArgumentsSuccess;

/**
 * Parses recognized boolean and value flags while preserving unconsumed tokens.
 *
 * Recognized flags are removed from `unparsedTokens`. All other tokens are left
 * intact and additionally classified as either positional args or unknown
 * dashed options.
 *
 * @param tokens - Tokens to scan.
 * @param config - Recognized boolean and value flag sets.
 * @returns {ParsedFlagArguments} Parsed flags plus preserved unconsumed tokens.
 */
export function parseFlagArguments(
  tokens: readonly string[],
  config: FlagArgumentParserConfig,
): ParsedFlagArguments {
  const parsedBooleanFlags = new Set<string>();
  const parsedValueFlags = new Map<string, string>();
  const positionals: string[] = [];
  const unknownOptions: string[] = [];
  const unparsedTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }

    if (config.booleanFlags.has(token)) {
      parsedBooleanFlags.add(token);
      continue;
    }

    if (config.valueFlags.has(token)) {
      const value = tokens[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return {
          error: {
            flag: token,
            message: `Missing value for ${token}.`,
          },
          ok: false,
        };
      }

      parsedValueFlags.set(token, value);
      index += 1;
      continue;
    }

    unparsedTokens.push(token);
    if (token.startsWith("-")) {
      unknownOptions.push(token);
      continue;
    }

    positionals.push(token);
  }

  return {
    booleanFlags: parsedBooleanFlags,
    ok: true,
    positionals,
    unknownOptions,
    unparsedTokens,
    valueFlags: parsedValueFlags,
  };
}
