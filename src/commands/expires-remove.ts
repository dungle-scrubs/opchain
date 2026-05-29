import { createExpiryTracker } from "../expires/tracker.ts";

import type { CommandRequest } from "../cli/command-request.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";

/**
 * Handles `opchain <identity> expires remove <vault-uuid>/<item-uuid>`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runExpiresRemove(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for expires remove.\n");
  }

  const { identityName, options } = request;
  const [removalTarget] = request.trailingArgs;

  if (removalTarget === undefined || !removalTarget.includes("/")) {
    return commandFailure(
      "expires remove currently requires <vault-uuid>/<item-uuid>.\n",
    );
  }

  const [vaultUuid, itemUuid] = removalTarget.split("/");
  if (vaultUuid === undefined || itemUuid === undefined) {
    return commandFailure(
      "expires remove currently requires <vault-uuid>/<item-uuid>.\n",
    );
  }

  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    return commandFailure(`${configContext.error}\n`);
  }

  if (configContext.value.config.identities[identityName] === undefined) {
    return commandFailure(`Unknown identity: ${identityName}.\n`);
  }

  const removeResult = createExpiryTracker(identityName).remove(
    vaultUuid,
    itemUuid,
  );
  if (!removeResult.ok) {
    return commandFailure(`${removeResult.error}\n`);
  }

  return commandSuccess(
    `Removed expiry tracking for ${vaultUuid}/${itemUuid}.\n`,
  );
}
