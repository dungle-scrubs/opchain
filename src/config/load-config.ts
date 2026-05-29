import { readFile } from "node:fs/promises";

import { parse } from "toml";

const ACCESS_MODES = ["auto", "default"] as const;
const KEYCHAIN_BACKENDS = ["helper", "security"] as const;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

type AccessMode = (typeof ACCESS_MODES)[number];
type KeychainBackend = (typeof KEYCHAIN_BACKENDS)[number];

type ConfigDefaults = {
  readonly enforceVaultAllowlist: boolean;
  readonly expiresThresholdDays: number;
  readonly keychainBackend: KeychainBackend;
  readonly projectsDir: string;
};

type ConfigProfile = {
  readonly keychainAccount: string;
};

type ConfigIdentity = {
  readonly defaultMode: AccessMode;
  readonly profiles: Readonly<Record<string, ConfigProfile>>;
  readonly vaults: readonly string[];
};

type Config = {
  readonly defaults: ConfigDefaults;
  readonly identities: Readonly<Record<string, ConfigIdentity>>;
};

type ConfigLoadResult =
  | { readonly ok: true; readonly value: Config }
  | { readonly error: ConfigError; readonly ok: false };

/**
 * Raised when a config file cannot be parsed into valid runtime data.
 */
export class ConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Loads and validates a TOML config file from disk.
 *
 * @param configPath - Absolute or relative path to `config.toml`.
 * @returns {Promise<ConfigLoadResult>} Validated config result.
 */
export async function loadConfig(
  configPath: string,
): Promise<ConfigLoadResult> {
  try {
    const configText = await readFile(configPath, "utf8");
    const parsedConfig = parse(configText) as unknown;

    return {
      ok: true,
      value: {
        defaults: parseDefaults(readRecord(parsedConfig, "config"), "defaults"),
        identities: parseIdentities(
          readRecord(parsedConfig, "config"),
          "identities",
        ),
      },
    };
  } catch (error) {
    return {
      error:
        error instanceof ConfigError
          ? error
          : new ConfigError(
              error instanceof Error
                ? error.message
                : "Failed to load config.toml.",
            ),
      ok: false,
    };
  }
}

/**
 * Parses the required defaults block.
 *
 * @param document - Parsed top-level config document.
 * @param key - Property name to read.
 * @returns {ConfigDefaults} Validated defaults.
 */
function parseDefaults(
  document: Record<string, unknown>,
  key: string,
): ConfigDefaults {
  const defaults = readRecord(document[key], key);
  const keychainBackend = readString(
    defaults,
    "keychain_backend",
    "defaults.keychain_backend",
  );

  if (!KEYCHAIN_BACKENDS.includes(keychainBackend as KeychainBackend)) {
    throw new ConfigError(
      `defaults.keychain_backend must be one of: ${KEYCHAIN_BACKENDS.join(", ")}.`,
    );
  }

  return {
    enforceVaultAllowlist: readBoolean(
      defaults,
      "enforce_vault_allowlist",
      "defaults.enforce_vault_allowlist",
    ),
    expiresThresholdDays: readPositiveInteger(
      defaults,
      "expires_threshold_days",
      "defaults.expires_threshold_days",
    ),
    keychainBackend: keychainBackend as KeychainBackend,
    projectsDir: readString(defaults, "projects_dir", "defaults.projects_dir"),
  };
}

/**
 * Parses configured identities without hardcoding identity names.
 *
 * @param document - Parsed top-level config document.
 * @param key - Property name to read.
 * @returns {Readonly<Record<string, ConfigIdentity>>} Validated identities.
 */
function parseIdentities(
  document: Record<string, unknown>,
  key: string,
): Readonly<Record<string, ConfigIdentity>> {
  const identities = readRecord(document[key], key);
  const entries = Object.entries(identities);

  if (entries.length === 0) {
    throw new ConfigError("identities must define at least one identity.");
  }

  return Object.fromEntries(
    entries.map(([identityName, identityValue]) => [
      identityName,
      parseIdentity(
        validateConfigKey(identityName, `identities.${identityName}`),
        readRecord(identityValue, `identities.${identityName}`),
      ),
    ]),
  );
}

/**
 * Parses one identity block.
 *
 * @param identityName - Configured identity name.
 * @param identity - Parsed identity block.
 * @returns {ConfigIdentity} Validated identity.
 */
function parseIdentity(
  identityName: string,
  identity: Record<string, unknown>,
): ConfigIdentity {
  const defaultMode = readString(
    identity,
    "default_mode",
    `identities.${identityName}.default_mode`,
  );

  if (!ACCESS_MODES.includes(defaultMode as AccessMode)) {
    throw new ConfigError(
      `identities.${identityName}.default_mode must be one of: ${ACCESS_MODES.join(", ")}.`,
    );
  }

  return {
    defaultMode: defaultMode as AccessMode,
    profiles: parseProfiles(
      identityName,
      readRecord(identity.profiles, `identities.${identityName}.profiles`),
    ),
    vaults: readStringArray(
      identity,
      "vaults",
      `identities.${identityName}.vaults`,
    ),
  };
}

/**
 * Parses profile blocks for a single identity.
 *
 * @param identityName - Configured identity name.
 * @param profiles - Parsed profiles block.
 * @returns {Readonly<Record<string, ConfigProfile>>} Validated profiles.
 */
function parseProfiles(
  identityName: string,
  profiles: Record<string, unknown>,
): Readonly<Record<string, ConfigProfile>> {
  const entries = Object.entries(profiles);

  if (entries.length === 0) {
    throw new ConfigError(
      `identities.${identityName}.profiles must define at least one profile.`,
    );
  }

  return Object.fromEntries(
    entries.map(([profileName, profileValue]) => [
      validateConfigKey(
        profileName,
        `identities.${identityName}.profiles.${profileName}`,
      ),
      {
        keychainAccount: readString(
          readRecord(
            profileValue,
            `identities.${identityName}.profiles.${profileName}`,
          ),
          "keychain_account",
          `identities.${identityName}.profiles.${profileName}.keychain_account`,
        ),
      },
    ]),
  );
}

/**
 * Validates one config key that is reused as a local path segment.
 *
 * @param value - Config key value.
 * @param path - Fully qualified field path for error messages.
 * @returns {string} Validated key.
 */
function validateConfigKey(value: string, path: string): string {
  if (!PATH_SEGMENT_PATTERN.test(value)) {
    throw new ConfigError(
      `${path} must contain only letters, numbers, underscores, and hyphens.`,
    );
  }

  return value;
}

/**
 * Reads a required string field.
 *
 * @param record - Source object.
 * @param key - Property name.
 * @param path - Fully qualified field path for error messages.
 * @returns {string} Non-empty string value.
 */
function readString(
  record: Record<string, unknown>,
  key: string,
  path: string = key,
): string {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(`${path} must be a non-empty string.`);
  }

  return value;
}

/**
 * Reads a required boolean field.
 *
 * @param record - Source object.
 * @param key - Property name.
 * @param path - Fully qualified field path for error messages.
 * @returns {boolean} Boolean value.
 */
function readBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string = key,
): boolean {
  const value = record[key];

  if (typeof value !== "boolean") {
    throw new ConfigError(`${path} must be a boolean.`);
  }

  return value;
}

/**
 * Reads a required positive integer field.
 *
 * @param record - Source object.
 * @param key - Property name.
 * @param path - Fully qualified field path for error messages.
 * @returns {number} Positive integer value.
 */
function readPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  path: string = key,
): number {
  const value = record[key];

  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ConfigError(`${path} must be a positive integer.`);
  }

  return value as number;
}

/**
 * Reads a required string array field.
 *
 * @param record - Source object.
 * @param key - Property name.
 * @param path - Fully qualified field path for error messages.
 * @returns {readonly string[]} Array of non-empty strings.
 */
function readStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string = key,
): readonly string[] {
  const value = record[key];

  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new ConfigError(`${path} must be a non-empty string array.`);
  }

  return value;
}

/**
 * Reads a required object field.
 *
 * @param value - Unknown value to validate.
 * @param key - Property name for error messages.
 * @returns {Record<string, unknown>} Plain object record.
 */
function readRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ConfigError(`${key} must be an object.`);
  }

  return value;
}

/**
 * Checks whether a value is a plain object record.
 *
 * @param value - Unknown input.
 * @returns {value is Record<string, unknown>} True when the value is a plain object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type {
  AccessMode,
  Config,
  ConfigDefaults,
  ConfigIdentity,
  ConfigLoadResult,
  ConfigProfile,
  KeychainBackend,
};
