import { createExpiryTracker } from "../expires/tracker.ts";

import type { CommandRequest } from "../cli/command-request.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";
import { resolveReadIdentityContext } from "../cli/token-context.ts";

/**
 * Handles `opchain <identity> expires add <op://...>`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runExpiresAdd(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for expires add.\n");
  }

  const { identityName, options } = request;
  const [reference] = request.trailingArgs;

  if (reference === undefined) {
    return commandFailure(
      "expires add currently requires an explicit reference.\n",
    );
  }

  const identityContext = await resolveReadIdentityContext(
    options,
    identityName,
  );
  if (!identityContext.ok) {
    return commandFailure(`${identityContext.error}\n`);
  }

  const addResult = createExpiryTracker(identityName).add(
    identityContext.value.token,
    reference,
  );
  if (!addResult.ok) {
    return commandFailure(`${addResult.error}\n`);
  }

  return commandSuccess(
    `Added expiry tracking for ${addResult.value.item.vaultUuid}/${addResult.value.item.itemUuid}.\n`,
  );
}
