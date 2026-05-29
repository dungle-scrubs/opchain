import { collectSecretReferencesFromFiles } from "../secrets/workflow.ts";

import type { CommandRequest } from "../cli/command-request.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";

/**
 * Handles `opchain <identity> secrets list [path]`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runSecretsList(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for secrets list.\n");
  }

  const { identityName, options } = request;
  const [targetPath] = request.trailingArgs;

  if (targetPath === undefined) {
    return commandFailure(
      "secrets list currently requires an explicit file path.\n",
    );
  }

  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    return commandFailure(`${configContext.error}\n`);
  }

  if (configContext.value.config.identities[identityName] === undefined) {
    return commandFailure(`Unknown identity: ${identityName}.\n`);
  }

  const referencesResult = collectSecretReferencesFromFiles(options, [
    targetPath,
  ]);
  if (!referencesResult.ok) {
    return commandFailure(`${referencesResult.error}\n`);
  }

  return commandSuccess(`${referencesResult.value.join("\n")}\n`);
}
