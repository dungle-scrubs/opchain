import { scanEnvOpTargets } from "../secrets/find-env-op-files.ts";
import { listSecretReferences } from "../secrets/parse-env-op.ts";
import {
  hashSecretReference,
  validateSecretReferences,
} from "../secrets/reference-validation.ts";
import { createTelemetryEvent } from "../telemetry/event.ts";

import { parseIdentityCommandPath } from "../cli/command-args.ts";
import { parseFlagArguments } from "../cli/flag-args.ts";
import { formatRuntimeError, readTextFile } from "../cli/io.ts";
import type { CliOptions } from "../cli/options.ts";
import { writeTelemetry } from "../cli/telemetry.ts";
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
export async function runSecretsValidate(options: CliOptions): Promise<number> {
  const parsedArgs = parseIdentityCommandPath(options.commandArgs, [
    "secrets",
    "validate",
  ]);
  if (!parsedArgs.ok) {
    process.stderr.write(`${parsedArgs.error}\n`);
    return 1;
  }

  const { identityName } = parsedArgs;
  const validateOptions = parseSecretsValidateOptions(parsedArgs.trailingArgs);

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
