import {
  collectSecretReferencesFromFiles,
  scanSecretReferenceTargets,
  validateSecretReferenceWorkflow,
} from "../secrets/workflow.ts";

import type { CommandRequest } from "../cli/command-request.ts";
import { parseFlagArguments } from "../cli/flag-args.ts";
import { commandFailure, type CommandResult } from "../cli/result.ts";
import { resolveReadIdentityContext } from "../cli/token-context.ts";

type SecretsValidateOptions = {
  readonly projectWide: boolean;
  readonly targetPath: string | undefined;
};

const SECRETS_VALIDATE_BOOLEAN_FLAGS = new Set(["--project-wide"]);

/**
 * Parses trailing `secrets validate` arguments.
 *
 * @param trailingArgs - Arguments after the `secrets validate` path.
 * @returns {SecretsValidateOptions | string} Parsed options or an error message.
 */
function parseSecretsValidateOptions(
  trailingArgs: readonly string[],
): SecretsValidateOptions | string {
  const parsedArgs = parseFlagArguments(trailingArgs, {
    booleanFlags: SECRETS_VALIDATE_BOOLEAN_FLAGS,
    valueFlags: new Set<string>(),
  });
  if (!parsedArgs.ok) {
    return parsedArgs.error.message;
  }

  const [targetPath, extraPositional] = parsedArgs.positionals;

  if (parsedArgs.unknownOptions.length > 0) {
    return `Unknown secrets validate option: ${parsedArgs.unknownOptions[0]}.`;
  }

  if (extraPositional !== undefined) {
    return `Unknown secrets validate option: ${extraPositional}.`;
  }

  if (
    parsedArgs.booleanFlags.has("--project-wide") &&
    targetPath !== undefined
  ) {
    return "secrets validate does not allow a path together with --project-wide.";
  }

  return {
    projectWide: parsedArgs.booleanFlags.has("--project-wide"),
    targetPath,
  };
}

/**
 * Handles `opchain <identity> secrets validate [path]`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runSecretsValidate(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for secrets validate.\n");
  }

  const { identityName, options } = request;
  const validateOptions = parseSecretsValidateOptions(request.trailingArgs);

  if (typeof validateOptions === "string") {
    return commandFailure(`${validateOptions}\n`);
  }

  const identityContext = await resolveReadIdentityContext(
    options,
    identityName,
  );
  if (!identityContext.ok) {
    return commandFailure(`${identityContext.error}\n`);
  }

  const scanRoot = validateOptions.projectWide
    ? identityContext.value.config.defaults.projectsDir
    : process.cwd();

  const scanResult = scanSecretReferenceTargets(
    validateOptions.targetPath,
    scanRoot,
  );
  if (!scanResult.ok) {
    return commandFailure(`${scanResult.error}\n`);
  }

  let stderr = "";
  for (const warning of scanResult.warnings) {
    stderr += `${warning}\n`;
  }

  const referencesResult = collectSecretReferencesFromFiles(
    options,
    scanResult.files,
  );
  if (!referencesResult.ok) {
    return commandFailure(`${stderr}${referencesResult.error}\n`);
  }

  const validationResult = validateSecretReferenceWorkflow(
    options,
    identityContext.value.token,
    referencesResult.value,
  );

  const stdout =
    validationResult.outputLines.length > 0
      ? `${validationResult.outputLines.join("\n")}\n`
      : "";
  if (validationResult.outputLines.length > 0) {
    return {
      exitCode: validationResult.ok ? 0 : 1,
      stderr,
      stdout,
    };
  }

  return {
    exitCode: validationResult.ok ? 0 : 1,
    stderr,
    stdout,
  };
}
