import { existsSync, readFileSync } from "node:fs";

type LegacyConfig = {
  readonly expiresThreshold: number | null;
  readonly projectsDir: string | null;
  readonly readAccount: string | null;
  readonly writeAccount: string | null;
};

type MutableLegacyConfig = {
  expiresThreshold: number | null;
  projectsDir: string | null;
  readAccount: string | null;
  writeAccount: string | null;
};

/**
 * Parses a positive integer from one legacy config field.
 *
 * @param value - Raw config value.
 * @returns {number | null} Parsed positive integer or null when invalid.
 */
function parsePositiveInteger(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }

  return Number.parseInt(value, 10);
}

/**
 * Loads the legacy v1 config file when it exists.
 *
 * @param configPath - Absolute path to the legacy config file.
 * @returns {LegacyConfig | null} Parsed legacy config or null when missing.
 * @throws {Error} When the legacy config contains invalid values.
 */
export function loadLegacyConfig(configPath: string): LegacyConfig | null {
  if (!existsSync(configPath)) {
    return null;
  }

  const config: MutableLegacyConfig = {
    expiresThreshold: null,
    projectsDir: null,
    readAccount: null,
    writeAccount: null,
  };

  for (const rawLine of readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();

    switch (key) {
      case "expires_threshold": {
        const expiresThreshold = parsePositiveInteger(value);
        if (expiresThreshold === null) {
          throw new Error(
            "expires_threshold must be a positive integer.",
          );
        }

        config.expiresThreshold = expiresThreshold;
        break;
      }
      case "projects_dir":
        config.projectsDir = value;
        break;
      case "read_account":
        config.readAccount = value;
        break;
      case "write_account":
        config.writeAccount = value;
        break;
      default:
        break;
    }
  }

  return config;
}

export type { LegacyConfig };
