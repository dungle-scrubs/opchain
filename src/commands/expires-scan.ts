import { createExpiryTracker } from "../expires/tracker.ts";

import type { CommandRequest } from "../cli/command-request.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";
import { resolveReadIdentityContext } from "../cli/token-context.ts";

/**
 * Handles `opchain <identity> expires scan`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runExpiresScan(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for expires scan.\n");
  }

  const { identityName, options } = request;
  const identityContext = await resolveReadIdentityContext(
    options,
    identityName,
  );
  if (!identityContext.ok) {
    return commandFailure(`${identityContext.error}\n`);
  }

  const scanResult = createExpiryTracker(identityName).scan(
    options,
    identityContext.value.token,
    identityContext.value.config.defaults.expiresThresholdDays,
  );
  if (!scanResult.ok) {
    return commandFailure(`${scanResult.error}\n`);
  }

  if (scanResult.value.lines.length > 0) {
    return commandSuccess(`${scanResult.value.lines.join("\n")}\n`);
  }

  return commandSuccess();
}
