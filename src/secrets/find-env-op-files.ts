import { lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

type EnvOpScanResult = {
  readonly files: readonly string[];
  readonly warnings: readonly string[];
};

/**
 * Scans one file or directory tree for `.env.op` files and `.env` warnings.
 *
 * @param targetPath - Optional explicit file or directory path.
 * @param currentDirectory - Current working directory when no path is passed.
 * @returns {EnvOpScanResult} Matching files and non-blocking warnings.
 */
export function scanEnvOpTargets(
  targetPath: string | undefined,
  currentDirectory: string,
): EnvOpScanResult {
  const resolvedPath = targetPath ?? currentDirectory;
  const stats = lstatSync(resolvedPath);

  if (stats.isFile()) {
    return { files: [resolvedPath], warnings: [] };
  }

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return { files: [], warnings: [] };
  }

  return walkDirectory(resolvedPath);
}

/**
 * Recursively walks one directory for `.env.op` files.
 *
 * @param directoryPath - Directory to scan.
 * @returns {EnvOpScanResult} Matching files and non-blocking warnings.
 */
function walkDirectory(directoryPath: string): EnvOpScanResult {
  const foundFiles: string[] = [];
  const warnings: string[] = [];
  const entries = readdirSync(directoryPath, { withFileTypes: true });

  const hasEnv = entries.some(
    (entry) => entry.isFile() && entry.name === ".env",
  );
  const hasEnvOp = entries.some(
    (entry) => entry.isFile() && basename(entry.name).endsWith(".env.op"),
  );
  if (hasEnv && !hasEnvOp) {
    warnings.push(
      `warning ${join(directoryPath, ".env")}: .env.op is preferred for secret references.`,
    );
  }

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.isSymbolicLink() || IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }

      const nestedResult = walkDirectory(entryPath);
      foundFiles.push(...nestedResult.files);
      warnings.push(...nestedResult.warnings);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".env.op")) {
      foundFiles.push(entryPath);
    }
  }

  return { files: foundFiles, warnings };
}

