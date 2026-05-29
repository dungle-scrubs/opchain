import { homedir } from "node:os";
import { join } from "node:path";

const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

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
 * Resolves the helper path, allowing tests to override it.
 *
 * @returns {string} Helper executable path.
 */
export function resolveHelperPath(): string {
  return process.env.OPCHAIN_HELPER_PATH ?? "opchain-helper";
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
  if (!PATH_SEGMENT_PATTERN.test(identityName)) {
    throw new Error(
      "Identity names used for expiry state must contain only letters, numbers, underscores, and hyphens.",
    );
  }

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
