import {
  collectSecretReferencesFromFiles,
  validateSecretReferenceWorkflow,
} from "../secrets/workflow.ts";

import type { CommandRequest } from "../cli/command-request.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";
import { resolveReadIdentityContext } from "../cli/token-context.ts";

/**
 * Handles `opchain <identity> secrets check [path]`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runSecretsCheck(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for secrets check.\n");
  }

  const { identityName, options } = request;
  const [targetPath] = request.trailingArgs;

  if (targetPath === undefined) {
    return commandFailure(
      "secrets check currently requires an explicit file path.\n",
    );
  }

  const identityContext = await resolveReadIdentityContext(
    options,
    identityName,
  );
  if (!identityContext.ok) {
    return commandFailure(`${identityContext.error}\n`);
  }

  const referencesResult = collectSecretReferencesFromFiles(options, [
    targetPath,
  ]);
  if (!referencesResult.ok) {
    return commandFailure(`${referencesResult.error}\n`);
  }

  const validationResult = validateSecretReferenceWorkflow(
    options,
    identityContext.value.token,
    referencesResult.value,
  );

  if (validationResult.outputLines.length > 0) {
    return {
      exitCode: validationResult.ok ? 0 : 1,
      stderr: "",
      stdout: `${validationResult.outputLines.join("\n")}\n`,
    };
  }

  return validationResult.ok ? commandSuccess() : commandFailure("");
}
