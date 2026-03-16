import { promptForToken } from "../token/prompt-for-token.ts";
import { setTokenWithHelper } from "../token/set-token-with-helper.ts";

import { parseCommandPath } from "../cli/command-args.ts";
import { parseFlagArguments } from "../cli/flag-args.ts";
import { readTokenFromStdin } from "../cli/io.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import type { CliOptions } from "../cli/options.ts";
import { resolveHelperPath } from "../cli/paths.ts";
import { resolveConfiguredAccount } from "../cli/profile.ts";

type TokenSetOptions = {
  readonly identity: string;
  readonly profile: string;
  readonly stdin: boolean;
};

const TOKEN_SET_BOOLEAN_FLAGS = new Set(["--stdin"]);
const TOKEN_SET_VALUE_FLAGS = new Set(["--identity", "--profile"]);

/**
 * Parses trailing `token set` arguments.
 *
 * @param trailingArgs - Arguments after the `token set` path.
 * @returns {TokenSetOptions | string} Parsed options or an error message.
 */
function parseTokenSetOptions(
  trailingArgs: readonly string[],
): TokenSetOptions | string {
  const parsedArgs = parseFlagArguments(trailingArgs, {
    booleanFlags: TOKEN_SET_BOOLEAN_FLAGS,
    valueFlags: TOKEN_SET_VALUE_FLAGS,
  });

  if (parsedArgs.positionals.length > 0) {
    return "token set does not accept token values through argv.";
  }

  if (parsedArgs.unknownOptions.length > 0) {
    return `Unknown token set option: ${parsedArgs.unknownOptions[0]}.`;
  }

  const identity = parsedArgs.valueFlags.get("--identity");
  const profile = parsedArgs.valueFlags.get("--profile");
  if (identity === undefined || profile === undefined) {
    return "token set requires --identity and --profile.";
  }

  return {
    identity,
    profile,
    stdin: parsedArgs.booleanFlags.has("--stdin"),
  };
}

/**
 * Handles the `token set` command.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runTokenSet(options: CliOptions): Promise<number> {
  const parsedArgs = parseCommandPath(options.commandArgs, ["token", "set"]);
  if (!parsedArgs.ok) {
    process.stderr.write(`${parsedArgs.error}\n`);
    return 1;
  }

  const tokenSetOptions = parseTokenSetOptions(parsedArgs.trailingArgs);
  if (typeof tokenSetOptions === "string") {
    process.stderr.write(`${tokenSetOptions}\n`);
    return 1;
  }

  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    process.stderr.write(`${configContext.error}\n`);
    return 1;
  }

  if (configContext.value.config.defaults.keychainBackend !== "helper") {
    process.stderr.write("token set currently supports helper backend only.\n");
    return 1;
  }

  const resolvedAccount = resolveConfiguredAccount(
    configContext.value.config,
    tokenSetOptions.identity,
    tokenSetOptions.profile,
  );
  if (typeof resolvedAccount === "string") {
    process.stderr.write(`${resolvedAccount}\n`);
    return 1;
  }

  const token = tokenSetOptions.stdin
    ? readTokenFromStdin()
    : await promptForToken(
        `Enter token for ${tokenSetOptions.identity}.${tokenSetOptions.profile}: `,
      );
  if (token === null) {
    process.stderr.write(
      tokenSetOptions.stdin
        ? "token set requires exactly one token value on stdin.\n"
        : "token set requires --stdin or an interactive TTY.\n",
    );
    return 1;
  }

  const setResult = await setTokenWithHelper({
    accountName: resolvedAccount.accountName,
    helperPath: resolveHelperPath(),
    serviceName: "opchain",
    token,
  });
  if (!setResult.ok) {
    process.stderr.write(`${setResult.error.message}\n`);
    return 1;
  }

  process.stdout.write(
    `Stored token for ${tokenSetOptions.identity}.${tokenSetOptions.profile}.\n`,
  );
  return 0;
}
