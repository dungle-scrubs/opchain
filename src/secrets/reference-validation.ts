import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { resolveOpPath } from "../cli/paths.ts";

export type SecretValidationOutcome = "error" | "ok";

export type SecretValidationResult = {
  readonly ok: boolean;
  readonly outputLines: readonly string[];
};

/**
 * Produces a stable redacted identifier for one secret reference.
 *
 * @param reference - Raw `op://` reference.
 * @returns {string} Short hash safe for telemetry.
 */
export function hashSecretReference(reference: string): string {
  return createHash("sha256").update(reference).digest("hex").slice(0, 12);
}

/**
 * Validates a set of secret references through `op read`.
 *
 * @param token - Service-account token for the child `op` process.
 * @param references - Unique references to validate.
 * @param emitValidationEvent - Optional telemetry sink.
 * @returns {SecretValidationResult} Validation lines plus overall success status.
 */
export function validateSecretReferences(
  token: string,
  references: readonly string[],
  emitValidationEvent?: (
    reference: string,
    outcome: SecretValidationOutcome,
  ) => void,
): SecretValidationResult {
  let allReferencesValid = true;
  const outputLines: string[] = [];

  for (const reference of references) {
    const opResult = spawnSync(resolveOpPath(), ["read", reference], {
      encoding: "utf8",
      env: {
        ...process.env,
        OP_SERVICE_ACCOUNT_TOKEN: token,
      },
    });

    if (opResult.error || opResult.status !== 0) {
      allReferencesValid = false;
      emitValidationEvent?.(reference, "error");
      outputLines.push(`error ${reference}`);
      continue;
    }

    emitValidationEvent?.(reference, "ok");
    outputLines.push(`ok ${reference}`);
  }

  return {
    ok: allReferencesValid,
    outputLines,
  };
}
