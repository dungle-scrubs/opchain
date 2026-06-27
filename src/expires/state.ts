import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

type ExpiryTrackedItem = {
  readonly expiresAt?: string;
  readonly itemTitle: string;
  readonly itemUuid: string;
  readonly lastCheckedAt?: string;
  readonly status?: "expiring" | "expired" | "healthy" | "missing";
  readonly vaultTitle: string;
  readonly vaultUuid: string;
};

type ExpiryState = {
  readonly identity: string;
  readonly trackedItems: readonly ExpiryTrackedItem[];
  readonly version: 1;
};

const EXPIRY_STATUSES = new Set(["expired", "expiring", "healthy", "missing"]);

/**
 * Raised when persisted expiry state has an invalid schema.
 */
export class ExpiryStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExpiryStateError";
  }
}

/**
 * Raised when expiry state cannot be written because a lock is held.
 */
export class ExpiryStateLockError extends Error {
  public constructor(statePath: string) {
    super(`Expiry state is locked: ${statePath}`);
    this.name = "ExpiryStateLockError";
  }
}

/**
 * Checks for non-empty string fields in persisted expiry state.
 *
 * @param value - Candidate value.
 * @returns {boolean} True when the value is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Checks for object records that can be inspected by field name.
 *
 * @param value - Candidate value.
 * @returns {boolean} True when the value is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates one optional string field on a tracked item.
 *
 * @param item - Tracked item record.
 * @param index - Tracked item index for error messages.
 * @param fieldName - Optional field to validate.
 * @returns {void} Nothing.
 */
function validateOptionalStringField(
  item: Record<string, unknown>,
  index: number,
  fieldName: "expiresAt" | "lastCheckedAt",
): void {
  const value = item[fieldName];
  if (value !== undefined && typeof value !== "string") {
    throw new ExpiryStateError(
      `Invalid expiry state: trackedItems[${index}].${fieldName} must be a string when present.`,
    );
  }
}

/**
 * Parses and validates one persisted expiry tracked item.
 *
 * @param input - Candidate tracked item.
 * @param index - Tracked item index for error messages.
 * @returns {ExpiryTrackedItem} Valid tracked item.
 */
function parseExpiryTrackedItem(
  input: unknown,
  index: number,
): ExpiryTrackedItem {
  if (!isRecord(input)) {
    throw new ExpiryStateError(
      `Invalid expiry state: trackedItems[${index}] must be an object.`,
    );
  }

  for (const fieldName of [
    "itemTitle",
    "itemUuid",
    "vaultTitle",
    "vaultUuid",
  ] as const) {
    if (!isNonEmptyString(input[fieldName])) {
      throw new ExpiryStateError(
        `Invalid expiry state: trackedItems[${index}].${fieldName} must be a non-empty string.`,
      );
    }
  }

  validateOptionalStringField(input, index, "expiresAt");
  validateOptionalStringField(input, index, "lastCheckedAt");

  if (
    input.status !== undefined &&
    (typeof input.status !== "string" || !EXPIRY_STATUSES.has(input.status))
  ) {
    throw new ExpiryStateError(
      `Invalid expiry state: trackedItems[${index}].status is invalid.`,
    );
  }

  const itemTitle = input.itemTitle as string;
  const itemUuid = input.itemUuid as string;
  const vaultTitle = input.vaultTitle as string;
  const vaultUuid = input.vaultUuid as string;

  return {
    ...(input.expiresAt === undefined
      ? {}
      : { expiresAt: input.expiresAt as string }),
    itemTitle,
    itemUuid,
    ...(input.lastCheckedAt === undefined
      ? {}
      : { lastCheckedAt: input.lastCheckedAt as string }),
    ...(input.status === undefined
      ? {}
      : { status: input.status as ExpiryTrackedItem["status"] }),
    vaultTitle,
    vaultUuid,
  };
}

/**
 * Parses and validates persisted expiry state JSON.
 *
 * @param input - Candidate expiry state value.
 * @returns {ExpiryState} Valid expiry state.
 */
export function parseExpiryState(input: unknown): ExpiryState {
  if (!isRecord(input)) {
    throw new ExpiryStateError("Invalid expiry state: root must be an object.");
  }

  if (input.version !== 1) {
    throw new ExpiryStateError("Invalid expiry state: version must be 1.");
  }

  if (!isNonEmptyString(input.identity)) {
    throw new ExpiryStateError(
      "Invalid expiry state: identity must be a non-empty string.",
    );
  }

  if (!Array.isArray(input.trackedItems)) {
    throw new ExpiryStateError(
      "Invalid expiry state: trackedItems must be an array.",
    );
  }

  return {
    identity: input.identity,
    trackedItems: input.trackedItems.map((item, index) =>
      parseExpiryTrackedItem(item, index),
    ),
    version: 1,
  };
}

/**
 * Loads one expiry state file from disk.
 *
 * @param statePath - Absolute or relative path to the state file.
 * @returns {ExpiryState} Parsed expiry state.
 */
export function loadExpiryState(statePath: string): ExpiryState {
  return parseExpiryState(JSON.parse(readFileSync(statePath, "utf8")));
}

/**
 * Loads one expiry state file or returns an empty state when it does not exist.
 *
 * @param statePath - Absolute or relative path to the state file.
 * @param identity - Identity name owning the state file.
 * @returns {ExpiryState} Existing or empty expiry state.
 */
export function loadExpiryStateOrEmpty(
  statePath: string,
  identity: string,
): ExpiryState {
  if (!existsSync(statePath)) {
    return {
      identity,
      trackedItems: [],
      version: 1,
    };
  }

  return loadExpiryState(statePath);
}

/**
 * Saves one expiry state file using an atomic same-directory rename.
 *
 * @param statePath - Absolute or relative path to the state file.
 * @param state - Serializable expiry state.
 * @returns {void} Nothing.
 */
export function saveExpiryState(statePath: string, state: ExpiryState): void {
  const directoryPath = dirname(statePath);
  const temporaryPath = join(
    directoryPath,
    `.${state.identity}.${Date.now()}.tmp.json`,
  );
  const lockPath = `${statePath}.lock`;

  mkdirSync(directoryPath, { recursive: true });

  let lockFileDescriptor: number | null = null;
  try {
    try {
      lockFileDescriptor = openSync(lockPath, "wx");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        throw new ExpiryStateLockError(statePath);
      }

      throw error;
    }

    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, statePath);
  } finally {
    if (lockFileDescriptor !== null) {
      closeSync(lockFileDescriptor);
      unlinkSync(lockPath);
    }
  }
}

/**
 * Adds or replaces one tracked item by canonical vault/item IDs.
 *
 * @param state - Current expiry state.
 * @param trackedItem - Tracked item to persist.
 * @returns {ExpiryState} Updated expiry state.
 */
export function upsertExpiryTrackedItem(
  state: ExpiryState,
  trackedItem: ExpiryTrackedItem,
): ExpiryState {
  const nextItems = state.trackedItems.filter(
    (item) =>
      !(
        item.itemUuid === trackedItem.itemUuid &&
        item.vaultUuid === trackedItem.vaultUuid
      ),
  );

  return {
    identity: state.identity,
    trackedItems: [...nextItems, trackedItem],
    version: state.version,
  };
}

/**
 * Removes one tracked item by canonical vault/item IDs.
 *
 * @param state - Current expiry state.
 * @param vaultUuid - Canonical vault UUID.
 * @param itemUuid - Canonical item UUID.
 * @returns {ExpiryState} Updated expiry state.
 */
export function removeExpiryTrackedItem(
  state: ExpiryState,
  vaultUuid: string,
  itemUuid: string,
): ExpiryState {
  return {
    identity: state.identity,
    trackedItems: state.trackedItems.filter(
      (item) => !(item.vaultUuid === vaultUuid && item.itemUuid === itemUuid),
    ),
    version: state.version,
  };
}

export type { ExpiryState, ExpiryTrackedItem };
