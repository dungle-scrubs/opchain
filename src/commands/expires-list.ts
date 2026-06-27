import type { CommandRequest } from "../cli/command-request.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";
import { createExpiryTracker } from "../expires/tracker.ts";

/**
 * Handles `opchain <identity> expires list`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runExpiresList(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for expires list.\n");
  }

  const { identityName, options } = request;
  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    return commandFailure(`${configContext.error}\n`);
  }

  if (configContext.value.config.identities[identityName] === undefined) {
    return commandFailure(`Unknown identity: ${identityName}.\n`);
  }

  const listResult = createExpiryTracker(identityName).list();
  if (!listResult.ok) {
    return commandFailure(`${listResult.error}\n`);
  }

  const { lines } = listResult.value;

  if (lines.length === 0) {
    return commandSuccess();
  }

  return commandSuccess(`${lines.join("\n")}\n`);
}
