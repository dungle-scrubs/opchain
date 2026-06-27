import { createTelemetryEvent } from "../telemetry/event.ts";

import { formatRuntimeError, readTextFile } from "../cli/io.ts";
import type { CliOptions } from "../cli/options.ts";
import { writeTelemetry } from "../cli/telemetry.ts";

import { scanEnvOpTargets } from "./find-env-op-files.ts";
import { listSecretReferences } from "./parse-env-op.ts";
import {
  hashSecretReference,
  validateSecretReferences,
} from "./reference-validation.ts";

type SecretReferenceCollectionResult =
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly error: string; readonly ok: false };

type SecretValidationWorkflowResult = {
  readonly ok: boolean;
  readonly outputLines: readonly string[];
};

type SecretScanResult =
  | {
      readonly files: readonly string[];
      readonly ok: true;
      readonly warnings: readonly string[];
    }
  | { readonly error: string; readonly ok: false };

/**
 * Scans one target for `.env.op` files and formats scan errors for CLI output.
 *
 * @param targetPath - Optional explicit file or directory path.
 * @param currentDirectory - Current working directory when no path is passed.
 * @returns {SecretScanResult} Scan result or printable error.
 */
export function scanSecretReferenceTargets(
  targetPath: string | undefined,
  currentDirectory: string,
): SecretScanResult {
  try {
    return {
      ok: true,
      ...scanEnvOpTargets(targetPath, currentDirectory),
    };
  } catch (error) {
    return {
      error: formatRuntimeError("Failed to scan .env.op targets", error),
      ok: false,
    };
  }
}

/**
 * Reads `.env.op` files, emits scan telemetry, and returns unique references.
 *
 * @param options - Parsed CLI options.
 * @param filePaths - Files to read.
 * @returns {SecretReferenceCollectionResult} Unique references or printable error.
 */
export function collectSecretReferencesFromFiles(
  options: CliOptions,
  filePaths: readonly string[],
): SecretReferenceCollectionResult {
  const uniqueReferences = new Set<string>();

  for (const filePath of filePaths) {
    const fileResult = readTextFile(filePath, "Failed to read .env.op file");
    if (!fileResult.ok) {
      return fileResult;
    }

    const references = listSecretReferences(fileResult.value);
    writeTelemetry(
      options,
      createTelemetryEvent("envop.scan.file", {
        file_path: filePath,
        reference_count: references.length,
      }),
    );

    for (const reference of references) {
      uniqueReferences.add(reference);
    }
  }

  return {
    ok: true,
    value: [...uniqueReferences],
  };
}

/**
 * Validates collected secret references and emits redacted validation telemetry.
 *
 * @param options - Parsed CLI options.
 * @param token - Service-account token for validation.
 * @param references - Unique references to validate.
 * @returns {SecretValidationWorkflowResult} Validation status and output lines.
 */
export function validateSecretReferenceWorkflow(
  options: CliOptions,
  token: string,
  references: readonly string[],
): SecretValidationWorkflowResult {
  return validateSecretReferences(token, references, (reference, outcome) => {
    writeTelemetry(
      options,
      createTelemetryEvent("envop.validate.ref", {
        outcome,
        ref_hash: hashSecretReference(reference),
      }),
    );
  });
}
