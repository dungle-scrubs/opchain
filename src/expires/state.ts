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
 * Loads one expiry state file from disk.
 *
 * @param statePath - Absolute or relative path to the state file.
 * @returns {ExpiryState} Parsed expiry state.
 */
export function loadExpiryState(statePath: string): ExpiryState {
  return JSON.parse(readFileSync(statePath, "utf8")) as ExpiryState;
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
