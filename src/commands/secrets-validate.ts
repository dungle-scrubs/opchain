import { scanEnvOpTargets } from "../secrets/find-env-op-files.ts";
import { listSecretReferences } from "../secrets/parse-env-op.ts";
import {
  hashSecretReference,
  validateSecretReferences,
} from "../secrets/reference-validation.ts";
import { createTelemetryEvent } from "../telemetry/event.ts";

import { formatRuntimeError, readTextFile } from "../cli/io.ts";
import type { CliOptions } from "../cli/options.ts";
import { writeTelemetry } from "../cli/telemetry.ts";
import { resolveReadIdentityContext } from "../cli/token-context.ts";

type SecretsValidateOptions = {
  readonly projectWide: boolean;
  readonly targetPath: string | undefined;
};

/**
 * Parses `secrets validate` command arguments.
 *
 * @param commandArgs - Command tokens beginning with `secrets validate`.
 * @returns {SecretsValidateOptions | string} Parsed options or an error message.
 */
function parseSecretsValidateOptions(
  commandArgs: readonly string[],
): SecretsValidateOptions | string {
  let projectWide = false;
  let targetPath: string | undefined;

  for (let index = 3; index < commandArgs.length; index += 1) {
    const token = commandArgs[index];

    if (token === undefined) {
      continue;
    }

    if (token === "--project-wide") {
      projectWide = true;
      continue;
    }

    if (targetPath === undefined) {
      targetPath = token;
      continue;
    }

    return `Unknown secrets validate option: ${token}.`;
  }

  if (projectWide && targetPath !== undefined) {
    return "secrets validate does not allow a path together with --project-wide.";
  }

  return {
    projectWide,
    targetPath,
  };
}

/**
 * Handles `opchain <identity> secrets validate [path]`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runSecretsValidate(options: CliOptions): Promise<number> {
  const identityName = options.commandArgs[0];
  const validateOptions = parseSecretsValidateOptions(options.commandArgs);

  if (identityName === undefined) {
    process.stderr.write("Missing identity before secrets command.\n");
    return 1;
  }

  if (typeof validateOptions === "string") {
    process.stderr.write(`${validateOptions}\n`);
    return 1;
  }

  const identityContext = await resolveReadIdentityContext(options, identityName);
  if (!identityContext.ok) {
    process.stderr.write(`${identityContext.error}\n`);
    return 1;
  }

  const scanRoot = validateOptions.projectWide
    ? identityContext.value.config.defaults.projectsDir
    : process.cwd();

  let scanResult: ReturnType<typeof scanEnvOpTargets>;
  try {
    scanResult = scanEnvOpTargets(validateOptions.targetPath, scanRoot);
  } catch (error) {
    process.stderr.write(
      `${formatRuntimeError("Failed to scan .env.op targets", error)}\n`,
    );
    return 1;
  }

  const uniqueReferences = new Set<string>();

  for (const warning of scanResult.warnings) {
    process.stderr.write(`${warning}\n`);
  }

  for (const envOpFilePath of scanResult.files) {
    const envOpFileResult = readTextFile(
      envOpFilePath,
      "Failed to read .env.op file",
    );
    if (!envOpFileResult.ok) {
      process.stderr.write(`${envOpFileResult.error}\n`);
      return 1;
    }

    const references = listSecretReferences(envOpFileResult.value);
    writeTelemetry(
      options,
      createTelemetryEvent("envop.scan.file", {
        file_path: envOpFilePath,
        reference_count: references.length,
      }),
    );

    for (const reference of references) {
      uniqueReferences.add(reference);
    }
  }

  const validationResult = validateSecretReferences(
    identityContext.value.token,
    [...uniqueReferences],
    (reference, outcome) => {
      writeTelemetry(
        options,
        createTelemetryEvent("envop.validate.ref", {
          outcome,
          ref_hash: hashSecretReference(reference),
        }),
      );
    },
  );

  if (validationResult.outputLines.length > 0) {
    process.stdout.write(`${validationResult.outputLines.join("\n")}\n`);
  }

  return validationResult.ok ? 0 : 1;
}
