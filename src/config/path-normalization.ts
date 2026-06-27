import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Expands a leading `~` path segment while leaving absolute and relative paths
 * otherwise deliberate.
 *
 * @param inputPath - Configured path value.
 * @param homePath - Home directory used for expansion.
 * @returns {string} Normalized path value.
 */
export function expandHomePath(
  inputPath: string,
  homePath: string = homedir(),
): string {
  if (inputPath === "~") {
    return homePath;
  }

  if (inputPath.startsWith("~/")) {
    return join(homePath, inputPath.slice(2));
  }

  return inputPath;
}
