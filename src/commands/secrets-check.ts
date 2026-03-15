import { listSecretReferences } from "../secrets/parse-env-op.ts";
import {
  hashSecretReference,
  validateSecretReferences,
} from "../secrets/reference-validation.ts";
import { createTelemetryEvent } from "../telemetry/event.ts";

import { readTextFile } from "../cli/io.ts";
import type { CliOptions } from "../cli/options.ts";
import { writeTelemetry } from "../cli/telemetry.ts";
import { resolveReadIdentityContext } from "../cli/token-context.ts";

/**
 * Handles `opchain <identity> secrets check [path]`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runSecretsCheck(options: CliOptions): Promise<number> {
  const identityName = options.commandArgs[0];
  const targetPath = options.commandArgs[3];

  if (identityName === undefined) {
    process.stderr.write("Missing identity before secrets command.\n");
    return 1;
  }

  if (targetPath === undefined) {
    process.stderr.write(
      "secrets check currently requires an explicit file path.\n",
    );
    return 1;
  }

  const identityContext = await resolveReadIdentityContext(options, identityName);
  if (!identityContext.ok) {
    process.stderr.write(`${identityContext.error}\n`);
    return 1;
  }

  const envOpFileResult = readTextFile(targetPath, "Failed to read .env.op file");
  if (!envOpFileResult.ok) {
    process.stderr.write(`${envOpFileResult.error}\n`);
    return 1;
  }

  const references = listSecretReferences(envOpFileResult.value);
  writeTelemetry(
    options,
    createTelemetryEvent("envop.scan.file", {
      file_path: targetPath,
      reference_count: references.length,
    }),
  );

  const validationResult = validateSecretReferences(
    identityContext.value.token,
    references,
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
