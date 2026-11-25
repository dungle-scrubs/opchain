import type { ExpiryTrackedItem } from "../expires/state.ts";
import type { ParsedSecretReference } from "../op/secret-reference.ts";

type SecretInspectMetadata = {
  readonly expiresAt: string | null;
  readonly fieldLabels: readonly string[];
  readonly itemTitle: string;
  readonly reference: string;
  readonly vaultName: string;
};

/** One field entry of a structure-only item report. */
export type ItemFieldStructure = {
  readonly label: string;
  readonly type: string;
  readonly has_value: boolean;
  readonly value_length: number;
};

/** Structure-only item report: identity fields plus per-field value shape. */
export type ItemStructure = {
  readonly title: string;
  readonly vault: string;
  readonly category: string;
  readonly fields: readonly ItemFieldStructure[];
};

/** Outcome of reading inspection metadata for one reference. */
export type SecretInspectParse =
  | { readonly kind: "ambiguous" }
  | { readonly kind: "field_not_found" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ok"; readonly metadata: SecretInspectMetadata };

type InspectField = {
  readonly id: string;
  readonly label: string;
  readonly sectionId: string | null;
  readonly sectionLabel: string | null;
};

/**
 * Extracts metadata from one `op item get --format json` payload and checks
 * that the item has the referenced field. The printed reference is the
 * caller's: op's item payload carries none. The last segment names a field
 * (by ID or label) or a file attachment (by ID or name), case-insensitively,
 * and, when the reference names a section, only within the section with that
 * ID or label. More than one match is ambiguous, as it is for `op read`.
 *
 * @param input - Parsed JSON payload.
 * @param reference - The raw reference the caller asked about.
 * @param parsed - The same reference, split.
 * @returns {SecretInspectParse} Sanitized metadata, or why there is none.
 */
export function parseSecretInspectMetadata(
  input: unknown,
  reference: string,
  parsed: ParsedSecretReference,
): SecretInspectParse {
  try {
    if (!isRecord(input)) {
      return { kind: "invalid" };
    }

    const itemTitle = readStringProperty(input, "title");
    const vault = input.vault;
    if (!isRecord(vault)) {
      return { kind: "invalid" };
    }

    const vaultName = readStringProperty(vault, "name");
    const fields = readInspectFields(input.fields, "label");
    const files =
      input.files === undefined ? [] : readInspectFields(input.files, "name");
    if (fields === undefined || files === undefined) {
      return { kind: "invalid" };
    }

    const matches = [...fields, ...files].filter((field) =>
      fieldMatches(field, parsed),
    ).length;
    if (matches === 0) {
      return { kind: "field_not_found" };
    }

    if (matches > 1) {
      return { kind: "ambiguous" };
    }

    return {
      kind: "ok",
      metadata: {
        expiresAt: readOptionalStringProperty(input, "expires_at"),
        fieldLabels: fields.map((field) => field.label),
        itemTitle,
        reference,
        vaultName,
      },
    };
  } catch {
    return { kind: "invalid" };
  }
}

function fieldMatches(
  field: InspectField,
  parsed: ParsedSecretReference,
): boolean {
  if (
    !sameName(parsed.field, field.id) &&
    !sameName(parsed.field, field.label)
  ) {
    return false;
  }

  if (parsed.section === undefined) {
    return true;
  }

  return (
    sameName(parsed.section, field.sectionId) ||
    sameName(parsed.section, field.sectionLabel)
  );
}

function sameName(wanted: string, actual: string | null): boolean {
  return (
    actual !== null &&
    actual.length > 0 &&
    wanted.toLowerCase() === actual.toLowerCase()
  );
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
 * Extracts one structure-only report from an `op item get --format json` payload.
 *
 * Values never cross the result: each field contributes its label, type,
 * whether it has a value, and its value length in Unicode code points.
 * A missing `fields` array is an empty list; a missing field `label` or
 * `type` is an empty string; a field `value` that is neither absent, null,
 * nor a string is invalid.
 *
 * @param input - Parsed JSON payload.
 * @returns {ItemStructure | string} Structure-only report or an error.
 */
export function parseItemStructure(input: unknown): ItemStructure | string {
  const INVALID = "Invalid item structure payload.";
  try {
    if (!isRecord(input)) {
      return INVALID;
    }

    const title = readStringProperty(input, "title");
    const vault = input.vault;
    if (!isRecord(vault)) {
      return INVALID;
    }

    const vaultName = readStringProperty(vault, "name");
    const category = readStringProperty(input, "category");

    const fieldsPayload = input.fields;
    if (fieldsPayload === undefined) {
      return {
        title,
        vault: vaultName,
        category,
        fields: [],
      };
    }

    if (!Array.isArray(fieldsPayload)) {
      return INVALID;
    }

    const fields: ItemFieldStructure[] = [];
    for (const entry of fieldsPayload) {
      if (!isRecord(entry)) {
        return INVALID;
      }

      const value = entry.value;
      if (value !== undefined && value !== null && typeof value !== "string") {
        return INVALID;
      }

      const valueText = typeof value === "string" ? value : "";
      fields.push({
        label: readOptionalStringProperty(entry, "label") ?? "",
        type: readOptionalStringProperty(entry, "type") ?? "",
        has_value: valueText.length > 0,
        value_length: [...valueText].length,
      });
    }

    return {
      title,
      vault: vaultName,
      category,
      fields,
    };
  } catch {
    return INVALID;
  }
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
 * Reads the identifying parts of an item's fields or file attachments, never
 * their values or contents. A missing `id` or name reads as empty; one of
 * another type is invalid.
 *
 * @param input - Unknown `fields` or `files` payload.
 * @param nameKey - `label` for fields, `name` for files.
 * @returns {readonly InspectField[] | undefined} Entries, or undefined when malformed.
 */
function readInspectFields(
  input: unknown,
  nameKey: "label" | "name",
): readonly InspectField[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const fields: InspectField[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) {
      return undefined;
    }

    const id = readNameProperty(entry, "id");
    const label = readNameProperty(entry, nameKey);
    if (id === undefined || label === undefined) {
      return undefined;
    }

    const section = entry.section;
    let sectionId: string | null = null;
    let sectionLabel: string | null = null;
    if (section !== undefined && section !== null) {
      if (!isRecord(section)) {
        return undefined;
      }

      sectionId = readOptionalStringProperty(section, "id");
      sectionLabel = readOptionalStringProperty(section, "label");
    }

    fields.push({ id, label, sectionId, sectionLabel });
  }

  return fields;
}

/** Reads an optional string property as a name: absent is "", a non-string is undefined. */
function readNameProperty(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    return "";
  }

  return typeof value === "string" ? value : undefined;
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
