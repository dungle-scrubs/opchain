import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { saveExpiryStateResult } from "../cli/io.ts";
import { resolveConfigPath, resolveExpiryStatePath } from "../cli/paths.ts";
import type { RuntimeResult } from "../cli/result.ts";

import type { MigrationPlan } from "./plan.ts";

type AppliedMigration = {
  readonly v2ConfigPath: string;
  readonly v2ExpiresPath: string;
};

/**
 * Applies one previously built migration plan.
 *
 * @param plan - Validated migration plan.
 * @returns {RuntimeResult<AppliedMigration>} Written paths or a printable error.
 */
export function applyMigrationPlan(
  plan: MigrationPlan,
): RuntimeResult<AppliedMigration> {
  const v2ConfigPath = resolveConfigPath();
  const v2ExpiresPath = resolveExpiryStatePath("kevin");
  if (existsSync(v2ConfigPath) || existsSync(v2ExpiresPath)) {
    return {
      error:
        "migrate-v1 apply is guarded: target v2 config or expires state already exists.",
      ok: false,
    };
  }

  mkdirSync(dirname(v2ConfigPath), { recursive: true });
  writeFileSync(v2ConfigPath, `${plan.migratedConfigToml}\n`, "utf8");

  const stateSaveError = saveExpiryStateResult(v2ExpiresPath, {
    identity: "kevin",
    trackedItems: plan.trackedItems,
    version: 1,
  });
  if (stateSaveError !== null) {
    return {
      error: stateSaveError,
      ok: false,
    };
  }

  return {
    ok: true,
    value: {
      v2ConfigPath,
      v2ExpiresPath,
    },
  };
}
