import { listSecretReferences } from "../secrets/parse-env-op.ts";

import { parseIdentityCommandPath } from "../cli/command-args.ts";
import { readTextFile } from "../cli/io.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import type { CliOptions } from "../cli/options.ts";

/**
 * Handles `opchain <identity> secrets list [path]`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runSecretsList(options: CliOptions): Promise<number> {
  const parsedArgs = parseIdentityCommandPath(options.commandArgs, [
    "secrets",
    "list",
  ]);
  if (!parsedArgs.ok) {
    process.stderr.write(`${parsedArgs.error}\n`);
    return 1;
  }

  const { identityName } = parsedArgs;
  const [targetPath] = parsedArgs.trailingArgs;

  if (targetPath === undefined) {
    process.stderr.write(
      "secrets list currently requires an explicit file path.\n",
    );
    return 1;
  }

  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    process.stderr.write(`${configContext.error}\n`);
    return 1;
  }

  if (configContext.value.config.identities[identityName] === undefined) {
    process.stderr.write(`Unknown identity: ${identityName}.\n`);
    return 1;
  }

  const envOpFileResult = readTextFile(
    targetPath,
    "Failed to read .env.op file",
  );
  if (!envOpFileResult.ok) {
    process.stderr.write(`${envOpFileResult.error}\n`);
    return 1;
  }

  const references = listSecretReferences(envOpFileResult.value);
  process.stdout.write(`${references.join("\n")}\n`);
  return 0;
}
