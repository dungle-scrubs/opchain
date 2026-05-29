import { promptForToken } from "../token/prompt-for-token.ts";
import { setTokenWithHelper } from "../token/set-token-with-helper.ts";

import type { CommandRequest } from "../cli/command-request.ts";
import { parseFlagArguments } from "../cli/flag-args.ts";
import { readTokenFromStdin } from "../cli/io.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import { resolveHelperPath } from "../cli/paths.ts";
import { resolveConfiguredAccount } from "../cli/profile.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";

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
export async function runTokenSet(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "top") {
    return commandFailure("Invalid command shape for token set.\n");
  }

  const { options } = request;
  const tokenSetOptions = parseTokenSetOptions(request.trailingArgs);
  if (typeof tokenSetOptions === "string") {
    return commandFailure(`${tokenSetOptions}\n`);
  }

  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    return commandFailure(`${configContext.error}\n`);
  }

  if (configContext.value.config.defaults.keychainBackend !== "helper") {
    return commandFailure(
      "token set currently supports helper backend only.\n",
    );
  }

  const resolvedAccount = resolveConfiguredAccount(
    configContext.value.config,
    tokenSetOptions.identity,
    tokenSetOptions.profile,
  );
  if (typeof resolvedAccount === "string") {
    return commandFailure(`${resolvedAccount}\n`);
  }

  const token = tokenSetOptions.stdin
    ? readTokenFromStdin()
    : await promptForToken(
        `Enter token for ${tokenSetOptions.identity}.${tokenSetOptions.profile}: `,
      );
  if (token === null) {
    return commandFailure(
      tokenSetOptions.stdin
        ? "token set requires exactly one token value on stdin.\n"
        : "token set requires --stdin or an interactive TTY.\n",
    );
  }

  const setResult = await setTokenWithHelper({
    accountName: resolvedAccount.accountName,
    helperPath: resolveHelperPath(),
    serviceName: "opchain",
    token,
  });
  if (!setResult.ok) {
    return commandFailure(`${setResult.error.message}\n`);
  }

  return commandSuccess(
    `Stored token for ${tokenSetOptions.identity}.${tokenSetOptions.profile}.\n`,
  );
}
