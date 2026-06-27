import { existsSync, readFileSync } from "node:fs";

type LegacyExpiryRecord = {
  readonly cachedTitle: string | null;
  readonly itemSelector: string;
  readonly vaultName: string;
};

/**
 * Loads the legacy v1 expires file when it exists.
 *
 * @param expiresPath - Absolute path to the legacy expires file.
 * @returns {readonly LegacyExpiryRecord[]} Parsed legacy records.
 */
export function loadLegacyExpires(
  expiresPath: string,
): readonly LegacyExpiryRecord[] {
  if (!existsSync(expiresPath)) {
    return [];
  }

  const records: LegacyExpiryRecord[] = [];

  for (const rawLine of readFileSync(expiresPath, "utf8").split(/\r?\n/)) {
    if (rawLine.trim().length === 0) {
      continue;
    }

    const [vaultName, itemSelector, cachedTitle] = rawLine.split("\t");
    if (!vaultName || !itemSelector) {
      continue;
    }

    records.push({
      cachedTitle: cachedTitle && cachedTitle.length > 0 ? cachedTitle : null,
      itemSelector,
      vaultName,
    });
  }

  return records;
}

export type { LegacyExpiryRecord };
