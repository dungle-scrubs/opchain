import { promptForConfirmation } from "../token/prompt-for-token.ts";
import { removeTokenWithHelper } from "../token/remove-token-with-helper.ts";

import { parseCommandPath } from "../cli/command-args.ts";
import { parseFlagArguments } from "../cli/flag-args.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import type { CliOptions } from "../cli/options.ts";
import { resolveHelperPath } from "../cli/paths.ts";
import { resolveConfiguredAccount } from "../cli/profile.ts";

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
export async function runTokenRemove(options: CliOptions): Promise<number> {
  const parsedArgs = parseCommandPath(options.commandArgs, [
    "token",
    "remove",
  ]);
  if (!parsedArgs.ok) {
    process.stderr.write(`${parsedArgs.error}\n`);
    return 1;
  }

  const tokenRemoveOptions = parseTokenRemoveOptions(parsedArgs.trailingArgs);
  if (typeof tokenRemoveOptions === "string") {
    process.stderr.write(`${tokenRemoveOptions}\n`);
    return 1;
  }

  if (
    !tokenRemoveOptions.yes &&
    (!process.stdin.isTTY || !process.stdout.isTTY)
  ) {
    process.stderr.write(
      "token remove requires --yes or an interactive TTY.\n",
    );
    return 1;
  }

  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    process.stderr.write(`${configContext.error}\n`);
    return 1;
  }

  if (configContext.value.config.defaults.keychainBackend !== "helper") {
    process.stderr.write(
      "token remove currently supports helper backend only.\n",
    );
    return 1;
  }

  const resolvedAccount = resolveConfiguredAccount(
    configContext.value.config,
    tokenRemoveOptions.identity,
    tokenRemoveOptions.profile,
  );
  if (typeof resolvedAccount === "string") {
    process.stderr.write(`${resolvedAccount}\n`);
    return 1;
  }

  if (!tokenRemoveOptions.yes) {
    const confirmed = await promptForConfirmation(
      `Remove token for ${tokenRemoveOptions.identity}.${tokenRemoveOptions.profile}? [y/N] `,
    );
    if (confirmed !== true) {
      process.stderr.write("Token removal cancelled.\n");
      return 1;
    }
  }

  const removeResult = await removeTokenWithHelper({
    accountName: resolvedAccount.accountName,
    helperPath: resolveHelperPath(),
    serviceName: "opchain",
  });
  if (!removeResult.ok) {
    process.stderr.write(`${removeResult.error.message}\n`);
    return 1;
  }

  process.stdout.write(
    `Removed token for ${tokenRemoveOptions.identity}.${tokenRemoveOptions.profile}.\n`,
  );
  return 0;
}
