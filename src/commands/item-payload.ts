import type { ExpiryTrackedItem } from "../expires/state.ts";

type SecretInspectMetadata = {
  readonly expiresAt: string | null;
  readonly fieldLabels: readonly string[];
  readonly itemTitle: string;
  readonly reference: string;
  readonly vaultName: string;
};

/**
 * Extracts metadata from one `op item get --format json` payload.
 *
 * @param input - Parsed JSON payload.
 * @returns {SecretInspectMetadata | string} Sanitized metadata or an error.
 */
export function parseSecretInspectMetadata(
  input: unknown,
): SecretInspectMetadata | string {
  try {
    if (!isRecord(input)) {
      return "Invalid secret inspection payload.";
    }

    const reference = readStringProperty(input, "reference");
    const itemTitle = readStringProperty(input, "title");
    const vault = input.vault;
    if (!isRecord(vault)) {
      return "Invalid secret inspection payload.";
    }

    const vaultName = readStringProperty(vault, "name");
    const fieldLabels = readFieldLabels(input.fields);
    if (typeof fieldLabels === "string") {
      return fieldLabels;
    }

    return {
      expiresAt: readOptionalStringProperty(input, "expires_at"),
      fieldLabels,
      itemTitle,
      reference,
      vaultName,
    };
  } catch {
    return "Invalid secret inspection payload.";
  }
}

/**
 * Formats a readable secret inspection summary.
 *
 * @param metadata - Sanitized inspection metadata.
 * @returns {string} Printable inspection summary.
 */
export function formatSecretInspectOutput(
  metadata: SecretInspectMetadata,
): string {
  return [
    `reference: ${metadata.reference}`,
    `vault: ${metadata.vaultName}`,
    `item: ${metadata.itemTitle}`,
    `fields: ${metadata.fieldLabels.join(", ")}`,
    `expires_at: ${metadata.expiresAt ?? "none"}`,
  ].join("\n");
}

/**
 * Extracts one canonical tracked item from an `op item get --format json` payload.
 *
 * @param input - Parsed JSON payload.
 * @returns {ExpiryTrackedItem | string} Canonical tracked item or an error.
 */
export function parseExpiryTrackedItem(
  input: unknown,
): ExpiryTrackedItem | string {
  try {
    if (!isRecord(input)) {
      return "Invalid expiry tracking payload.";
    }

    const vault = input.vault;
    if (!isRecord(vault)) {
      return "Invalid expiry tracking payload.";
    }

    return {
      expiresAt: readOptionalStringProperty(input, "expires_at") ?? undefined,
      itemTitle: readStringProperty(input, "title"),
      itemUuid: readStringProperty(input, "id"),
      vaultTitle: readStringProperty(vault, "name"),
      vaultUuid: readStringProperty(vault, "id"),
    };
  } catch {
    return "Invalid expiry tracking payload.";
  }
}

/**
 * Reads string labels from an item field array.
 *
 * @param input - Unknown fields payload.
 * @returns {readonly string[] | string} Field labels or an error.
 */
function readFieldLabels(input: unknown): readonly string[] | string {
  if (!Array.isArray(input)) {
    return "Invalid secret inspection payload.";
  }

  const labels: string[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) {
      return "Invalid secret inspection payload.";
    }

    const label = readStringProperty(entry, "label");
    labels.push(label);
  }

  return labels;
}

/**
 * Reads a required string property from an object.
 *
 * @param input - Source object.
 * @param key - Property name.
 * @returns {string} String property value.
 */
function readStringProperty(
  input: Record<string, unknown>,
  key: string,
): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string property: ${key}`);
  }

  return value;
}

/**
 * Reads an optional string property from an object.
 *
 * @param input - Source object.
 * @param key - Property name.
 * @returns {string | null} Optional string property value.
 */
function readOptionalStringProperty(
  input: Record<string, unknown>,
  key: string,
): string | null {
  const value = input[key];
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === "string" ? value : null;
}

/**
 * Checks whether a value is a plain object.
 *
 * @param input - Unknown input.
 * @returns {input is Record<string, unknown>} True when the value is a plain object.
 */
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
