import { resolveReadIdentityContext } from "../cli/token-context.ts";
import type { CliOptions } from "../cli/options.ts";
import { readOpItemJson } from "../op/item-json.ts";

import { parseIdentityCommandPath } from "../cli/command-args.ts";
import {
  formatSecretInspectOutput,
  parseSecretInspectMetadata,
} from "./item-payload.ts";

/**
 * Handles `opchain <identity> secrets inspect <ref>`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runSecretsInspect(options: CliOptions): Promise<number> {
  const parsedArgs = parseIdentityCommandPath(options.commandArgs, [
    "secrets",
    "inspect",
  ]);
  if (!parsedArgs.ok) {
    process.stderr.write(`${parsedArgs.error}\n`);
    return 1;
  }

  const { identityName } = parsedArgs;
  const [reference] = parsedArgs.trailingArgs;

  if (reference === undefined) {
    process.stderr.write(
      "secrets inspect currently requires an explicit reference.\n",
    );
    return 1;
  }

  const identityContext = await resolveReadIdentityContext(
    options,
    identityName,
  );
  if (!identityContext.ok) {
    process.stderr.write(`${identityContext.error}\n`);
    return 1;
  }

  const itemResult = readOpItemJson(
    identityContext.value.token,
    reference,
    "Failed to inspect secret reference.",
    "Invalid secret inspection payload.",
  );
  if (!itemResult.ok) {
    process.stderr.write(`${itemResult.error}\n`);
    return 1;
  }

  const metadata = parseSecretInspectMetadata(itemResult.value);
  if (typeof metadata === "string") {
    process.stderr.write(`${metadata}\n`);
    return 1;
  }

  process.stdout.write(`${formatSecretInspectOutput(metadata)}\n`);
  return 0;
}
