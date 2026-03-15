import { promptForToken } from "../token/prompt-for-token.ts";
import { setTokenWithHelper } from "../token/set-token-with-helper.ts";

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

/**
 * Parses `token set` command arguments.
 *
 * @param commandArgs - Command tokens beginning with `token set`.
 * @returns {TokenSetOptions | string} Parsed options or an error message.
 */
function parseTokenSetOptions(
  commandArgs: readonly string[],
): TokenSetOptions | string {
  let identity: string | undefined;
  let profile: string | undefined;
  let useStdin = false;
  const unexpectedArgs: string[] = [];

  for (let index = 2; index < commandArgs.length; index += 1) {
    const token = commandArgs[index];

    if (token === undefined) {
      continue;
    }

    if (token === "--stdin") {
      useStdin = true;
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

  if (unexpectedArgs.some((token) => !token.startsWith("-"))) {
    return "token set does not accept token values through argv.";
  }

  if (unexpectedArgs.length > 0) {
    return `Unknown token set option: ${unexpectedArgs[0]}.`;
  }

  if (identity === undefined || profile === undefined) {
    return "token set requires --identity and --profile.";
  }

  return {
    identity,
    profile,
    stdin: useStdin,
  };
}

/**
 * Handles the `token set` command.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runTokenSet(options: CliOptions): Promise<number> {
  const tokenSetOptions = parseTokenSetOptions(options.commandArgs);
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
    serviceName: "opchain-v2",
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
