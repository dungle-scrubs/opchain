import { resolveReadIdentityContext } from "../cli/token-context.ts";
import type { CommandRequest } from "../cli/command-request.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";
import { readOpItemJson } from "../op/item-json.ts";

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
export async function runSecretsInspect(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for secrets inspect.\n");
  }

  const { identityName, options } = request;
  const [reference] = request.trailingArgs;

  if (reference === undefined) {
    return commandFailure(
      "secrets inspect currently requires an explicit reference.\n",
    );
  }

  const identityContext = await resolveReadIdentityContext(
    options,
    identityName,
  );
  if (!identityContext.ok) {
    return commandFailure(`${identityContext.error}\n`);
  }

  const itemResult = readOpItemJson(
    identityContext.value.token,
    reference,
    "Failed to inspect secret reference.",
    "Invalid secret inspection payload.",
  );
  if (!itemResult.ok) {
    return commandFailure(`${itemResult.error}\n`);
  }

  const metadata = parseSecretInspectMetadata(itemResult.value);
  if (typeof metadata === "string") {
    return commandFailure(`${metadata}\n`);
  }

  return commandSuccess(`${formatSecretInspectOutput(metadata)}\n`);
}
