import { homedir } from "node:os";
import { join } from "node:path";

const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Asserts a value is safe to use as a single local filesystem path segment.
 *
 * Rejects traversal (`..`), separators (`/`), dots, and empty values so
 * untrusted names cannot escape their intended directory. This is the single
 * owner of the traversal-safety rule; other modules must consume it rather than
 * re-deriving the pattern.
 *
 * @param value - Candidate path segment.
 * @param context - Human-readable subject for the error message.
 * @returns {string} The validated value, unchanged.
 */
export function assertPathSegment(value: string, context: string): string {
  if (!PATH_SEGMENT_PATTERN.test(value)) {
    throw new Error(
      `${context} must contain only letters, numbers, underscores, and hyphens.`,
    );
  }

  return value;
}

/**
 * Resolves the config path using the documented default location, allowing tests to override it.
 *
 * @returns {string} Default config file path.
 */
export function resolveConfigPath(): string {
  return process.env.OPCHAIN_CONFIG_PATH
    ? process.env.OPCHAIN_CONFIG_PATH
    : join(homedir(), ".config", "opchain", "config.toml");
}

/**
 * Resolves the security path, allowing tests to override it.
 *
 * @returns {string} Security executable path.
 */
export function resolveSecurityPath(): string {
  return process.env.OPCHAIN_SECURITY_PATH ?? "/usr/bin/security";
}

/**
 * Resolves the `op` path, allowing tests to override it.
 *
 * @returns {string} `op` executable path.
 */
export function resolveOpPath(): string {
  return process.env.OPCHAIN_OP_PATH ?? "op";
}

/**
 * Resolves one per-identity expiry state path.
 *
 * @param identityName - Identity owning the state file.
 * @returns {string} Per-identity expiry state path.
 */
export function resolveExpiryStatePath(identityName: string): string {
  assertPathSegment(identityName, "Identity names used for expiry state");

  return join(
    homedir(),
    ".config",
    "opchain",
    "state",
    "expires",
    `${identityName}.json`,
  );
}

/**
 * Resolves the legacy v1 config path, allowing tests to override it.
 *
 * @returns {string} Legacy config file path.
 */
export function resolveLegacyConfigPath(): string {
  return process.env.OPCHAIN_LEGACY_CONFIG_PATH
    ? process.env.OPCHAIN_LEGACY_CONFIG_PATH
    : join(homedir(), ".config", "opchain", "config");
}

/**
 * Resolves the legacy v1 expires path, allowing tests to override it.
 *
 * @returns {string} Legacy expires file path.
 */
export function resolveLegacyExpiresPath(): string {
  return process.env.OPCHAIN_LEGACY_EXPIRES_PATH
    ? process.env.OPCHAIN_LEGACY_EXPIRES_PATH
    : join(homedir(), ".config", "opchain", "expires");
}
