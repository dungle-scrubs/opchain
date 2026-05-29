import { promptForConfirmation } from "../token/prompt-for-token.ts";
import { removeTokenWithHelper } from "../token/remove-token-with-helper.ts";

import type { CommandRequest } from "../cli/command-request.ts";
import { parseFlagArguments } from "../cli/flag-args.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import { resolveHelperPath } from "../cli/paths.ts";
import { resolveConfiguredAccount } from "../cli/profile.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";

type TokenRemoveOptions = {
  readonly identity: string;
  readonly profile: string;
  readonly yes: boolean;
};

const TOKEN_REMOVE_BOOLEAN_FLAGS = new Set(["--yes"]);
const TOKEN_REMOVE_VALUE_FLAGS = new Set(["--identity", "--profile"]);

/**
 * Parses trailing `token remove` arguments.
 *
 * @param trailingArgs - Arguments after the `token remove` path.
 * @returns {TokenRemoveOptions | string} Parsed options or an error message.
 */
function parseTokenRemoveOptions(
  trailingArgs: readonly string[],
): TokenRemoveOptions | string {
  const parsedArgs = parseFlagArguments(trailingArgs, {
    booleanFlags: TOKEN_REMOVE_BOOLEAN_FLAGS,
    valueFlags: TOKEN_REMOVE_VALUE_FLAGS,
  });

  if (parsedArgs.positionals.length > 0) {
    return `Unknown token remove option: ${parsedArgs.positionals[0]}.`;
  }

  if (parsedArgs.unknownOptions.length > 0) {
    return `Unknown token remove option: ${parsedArgs.unknownOptions[0]}.`;
  }

  const identity = parsedArgs.valueFlags.get("--identity");
  const profile = parsedArgs.valueFlags.get("--profile");
  if (identity === undefined || profile === undefined) {
    return "token remove requires --identity and --profile.";
  }

  return {
    identity,
    profile,
    yes: parsedArgs.booleanFlags.has("--yes"),
  };
}

/**
 * Handles the `token remove` command.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runTokenRemove(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "top") {
    return commandFailure("Invalid command shape for token remove.\n");
  }

  const { options } = request;
  const tokenRemoveOptions = parseTokenRemoveOptions(request.trailingArgs);
  if (typeof tokenRemoveOptions === "string") {
    return commandFailure(`${tokenRemoveOptions}\n`);
  }

  if (
    !tokenRemoveOptions.yes &&
    (!process.stdin.isTTY || !process.stdout.isTTY)
  ) {
    return commandFailure(
      "token remove requires --yes or an interactive TTY.\n",
    );
  }

  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    return commandFailure(`${configContext.error}\n`);
  }

  if (configContext.value.config.defaults.keychainBackend !== "helper") {
    return commandFailure(
      "token remove currently supports helper backend only.\n",
    );
  }

  const resolvedAccount = resolveConfiguredAccount(
    configContext.value.config,
    tokenRemoveOptions.identity,
    tokenRemoveOptions.profile,
  );
  if (typeof resolvedAccount === "string") {
    return commandFailure(`${resolvedAccount}\n`);
  }

  if (!tokenRemoveOptions.yes) {
    const confirmed = await promptForConfirmation(
      `Remove token for ${tokenRemoveOptions.identity}.${tokenRemoveOptions.profile}? [y/N] `,
    );
    if (confirmed !== true) {
      return commandFailure("Token removal cancelled.\n");
    }
  }

  const removeResult = await removeTokenWithHelper({
    accountName: resolvedAccount.accountName,
    helperPath: resolveHelperPath(),
    serviceName: "opchain",
  });
  if (!removeResult.ok) {
    return commandFailure(`${removeResult.error.message}\n`);
  }

  return commandSuccess(
    `Removed token for ${tokenRemoveOptions.identity}.${tokenRemoveOptions.profile}.\n`,
  );
}
