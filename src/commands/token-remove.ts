import { promptForConfirmation } from "../token/prompt-for-token.ts";
import { removeTokenWithHelper } from "../token/remove-token-with-helper.ts";

import { loadConfigContext } from "../cli/config-context.ts";
import type { CliOptions } from "../cli/options.ts";
import { resolveHelperPath } from "../cli/paths.ts";
import { resolveConfiguredAccount } from "../cli/profile.ts";

type TokenRemoveOptions = {
  readonly identity: string;
  readonly profile: string;
  readonly yes: boolean;
};

/**
 * Parses `token remove` command arguments.
 *
 * @param commandArgs - Command tokens beginning with `token remove`.
 * @returns {TokenRemoveOptions | string} Parsed options or an error message.
 */
function parseTokenRemoveOptions(
  commandArgs: readonly string[],
): TokenRemoveOptions | string {
  let identity: string | undefined;
  let profile: string | undefined;
  let yes = false;
  const unexpectedArgs: string[] = [];

  for (let index = 2; index < commandArgs.length; index += 1) {
    const token = commandArgs[index];

    if (token === undefined) {
      continue;
    }

    if (token === "--yes") {
      yes = true;
      continue;
    }

    if (token === "--identity") {
      identity = commandArgs[index + 1];
      index += 1;
      continue;
    }

    if (token === "--profile") {
      profile = commandArgs[index + 1];
      index += 1;
      continue;
    }

    unexpectedArgs.push(token);
  }

  if (unexpectedArgs.length > 0) {
    return `Unknown token remove option: ${unexpectedArgs[0]}.`;
  }

  if (identity === undefined || profile === undefined) {
    return "token remove requires --identity and --profile.";
  }

  return {
    identity,
    profile,
    yes,
  };
}

/**
 * Handles the `token remove` command.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runTokenRemove(options: CliOptions): Promise<number> {
  const tokenRemoveOptions = parseTokenRemoveOptions(options.commandArgs);
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
    serviceName: "opchain-v2",
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
