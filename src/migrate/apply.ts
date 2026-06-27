import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { saveExpiryStateResult } from "../cli/io.ts";
import { resolveConfigPath, resolveExpiryStatePath } from "../cli/paths.ts";
import type { RuntimeResult } from "../cli/result.ts";

import type { MigrationPlan } from "./plan.ts";

type AppliedMigration = {
  readonly v2ConfigPath: string;
  readonly v2ExpiresPath: string;
};

/**
 * Removes files created by the current migration attempt.
 *
 * @param filePaths - Current-attempt files to remove.
 * @returns {void} Nothing.
 */
function rollbackCreatedFiles(filePaths: readonly string[]): void {
  for (const filePath of filePaths) {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}

/**
 * Writes one migration target through a same-directory temp file.
 *
 * @param targetPath - Final target path.
 * @param content - File content.
 * @returns {void} Nothing.
 */
function writeMigrationTarget(targetPath: string, content: string): void {
  const directoryPath = dirname(targetPath);
  const temporaryPath = join(
    directoryPath,
    `.migration.${Date.now()}.${process.pid}.tmp`,
  );

  writeFileSync(temporaryPath, content, "utf8");
  renameSync(temporaryPath, targetPath);
}

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
  const v2ExpiresPath = resolveExpiryStatePath("primary");
  if (existsSync(v2ConfigPath) || existsSync(v2ExpiresPath)) {
    return {
      error:
        "migrate-v1 apply is guarded: target v2 config or expires state already exists.",
      ok: false,
    };
  }

  const createdFiles: string[] = [];

  try {
    mkdirSync(dirname(v2ConfigPath), { recursive: true });
    writeMigrationTarget(v2ConfigPath, `${plan.migratedConfigToml}\n`);
    createdFiles.push(v2ConfigPath);

    const stateSaveError = saveExpiryStateResult(v2ExpiresPath, {
      identity: "primary",
      trackedItems: plan.trackedItems,
      version: 1,
    });
    if (stateSaveError !== null) {
      rollbackCreatedFiles([...createdFiles, v2ExpiresPath]);
      return {
        error: stateSaveError,
        ok: false,
      };
    }
    createdFiles.push(v2ExpiresPath);
  } catch (error) {
    rollbackCreatedFiles([...createdFiles, v2ExpiresPath]);
    return {
      error:
        error instanceof Error
          ? `Failed to apply migration: ${error.message}`
          : "Failed to apply migration.",
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
