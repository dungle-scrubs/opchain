type FlagArgumentParserConfig = {
  readonly booleanFlags: ReadonlySet<string>;
  readonly valueFlags: ReadonlySet<string>;
};

export type ParsedFlagArguments = {
  readonly booleanFlags: ReadonlySet<string>;
  readonly positionals: readonly string[];
  readonly unknownOptions: readonly string[];
  readonly unparsedTokens: readonly string[];
  readonly valueFlags: ReadonlyMap<string, string | undefined>;
};

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
  const parsedValueFlags = new Map<string, string | undefined>();
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
      parsedValueFlags.set(token, tokens[index + 1]);
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
    positionals,
    unknownOptions,
    unparsedTokens,
    valueFlags: parsedValueFlags,
  };
}
