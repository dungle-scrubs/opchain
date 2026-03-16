import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  AccessMode,
  KeychainBackend,
} from "../../src/config/load-config.ts";

type TestIdentityConfig = {
  readonly defaultMode: AccessMode;
  readonly profiles: Readonly<Record<string, string>>;
  readonly vaults: readonly string[];
};

type TestConfigDefaults = {
  readonly enforceVaultAllowlist: boolean;
  readonly expiresThresholdDays: number;
  readonly keychainBackend: KeychainBackend;
  readonly projectsDir: string;
};

type TestConfigDefinition = {
  readonly defaults?: Partial<TestConfigDefaults>;
  readonly identities: Readonly<Record<string, TestIdentityConfig>>;
};

type SingleIdentityOptions = {
  readonly identityName?: string;
  readonly projectsDir?: string;
  readonly vaults?: readonly string[];
};

type AutoReadWriteOptions = SingleIdentityOptions & {
  readonly readAccount?: string;
  readonly writeAccount?: string;
};

type HumanAndKevinOptions = {
  readonly humanAccount?: string;
  readonly humanVaults?: readonly string[];
  readonly kevinReadAccount?: string;
  readonly kevinVaults?: readonly string[];
  readonly kevinWriteAccount?: string;
  readonly projectsDir?: string;
};

const DEFAULTS: TestConfigDefaults = {
  enforceVaultAllowlist: true,
  expiresThresholdDays: 14,
  keychainBackend: "helper",
  projectsDir: "/Users/kevin/dev",
};

/**
 * Renders one TOML config fixture from a compact test definition.
 *
 * @param definition - Test config definition.
 * @returns {string} TOML config content.
 */
export function renderOpchainConfig(definition: TestConfigDefinition): string {
  const defaults = {
    ...DEFAULTS,
    ...definition.defaults,
  };
  const lines = [
    "[defaults]",
    `projects_dir = "${defaults.projectsDir}"`,
    `expires_threshold_days = ${defaults.expiresThresholdDays}`,
    `keychain_backend = "${defaults.keychainBackend}"`,
    `enforce_vault_allowlist = ${String(defaults.enforceVaultAllowlist)}`,
  ];

  for (const [identityName, identity] of Object.entries(
    definition.identities,
  )) {
    lines.push(
      "",
      `[identities.${identityName}]`,
      `default_mode = "${identity.defaultMode}"`,
      `vaults = [${identity.vaults.map((vault) => `"${vault}"`).join(", ")}]`,
    );

    for (const [profileName, keychainAccount] of Object.entries(
      identity.profiles,
    )) {
      lines.push(
        "",
        `[identities.${identityName}.profiles.${profileName}]`,
        `keychain_account = "${keychainAccount}"`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Writes one config fixture under the standard project config directory.
 *
 * @param homePath - Temporary HOME directory.
 * @param definition - Test config definition.
 * @returns {string} Written config path.
 */
export function writeHomeConfig(
  homePath: string,
  definition: TestConfigDefinition,
): string {
  const configDirectoryPath = join(homePath, ".config", "opchain");
  const configPath = join(configDirectoryPath, "config.toml");

  mkdirSync(configDirectoryPath, { recursive: true });
  writeFileSync(configPath, renderOpchainConfig(definition), "utf8");
  return configPath;
}

/**
 * Writes a single-profile human-style config fixture.
 *
 * @param homePath - Temporary HOME directory.
 * @param options - Optional identity customizations.
 * @returns {string} Written config path.
 */
export function writeHumanConfig(
  homePath: string,
  options: SingleIdentityOptions = {},
): string {
  return writeHomeConfig(homePath, {
    defaults: {
      projectsDir: options.projectsDir,
    },
    identities: {
      [options.identityName ?? "human"]: {
        defaultMode: "default",
        profiles: {
          default: `opchain:${options.identityName ?? "human"}:default`,
        },
        vaults: options.vaults ?? ["Human"],
      },
    },
  });
}

/**
 * Writes an auto-mode read-only config fixture.
 *
 * @param homePath - Temporary HOME directory.
 * @param options - Optional identity customizations.
 * @returns {string} Written config path.
 */
export function writeAutoReadConfig(
  homePath: string,
  options: SingleIdentityOptions = {},
): string {
  const identityName = options.identityName ?? "kevin";

  return writeHomeConfig(homePath, {
    defaults: {
      projectsDir: options.projectsDir,
    },
    identities: {
      [identityName]: {
        defaultMode: "auto",
        profiles: {
          read: `opchain:${identityName}:read`,
        },
        vaults: options.vaults ?? ["Personal"],
      },
    },
  });
}

/**
 * Writes an auto-mode read/write config fixture.
 *
 * @param homePath - Temporary HOME directory.
 * @param options - Optional identity customizations.
 * @returns {string} Written config path.
 */
export function writeAutoReadWriteConfig(
  homePath: string,
  options: AutoReadWriteOptions = {},
): string {
  const identityName = options.identityName ?? "kevin";

  return writeHomeConfig(homePath, {
    defaults: {
      projectsDir: options.projectsDir,
    },
    identities: {
      [identityName]: {
        defaultMode: "auto",
        profiles: {
          read: options.readAccount ?? `opchain:${identityName}:read`,
          write: options.writeAccount ?? `opchain:${identityName}:write`,
        },
        vaults: options.vaults ?? ["Personal", "Services"],
      },
    },
  });
}

/**
 * Writes a combined kevin/human config fixture.
 *
 * @param homePath - Temporary HOME directory.
 * @param options - Optional identity customizations.
 * @returns {string} Written config path.
 */
export function writeHumanAndKevinConfig(
  homePath: string,
  options: HumanAndKevinOptions = {},
): string {
  return writeHomeConfig(homePath, {
    defaults: {
      projectsDir: options.projectsDir,
    },
    identities: {
      kevin: {
        defaultMode: options.kevinWriteAccount ? "auto" : "auto",
        profiles: options.kevinWriteAccount
          ? {
              read: options.kevinReadAccount ?? "opchain:kevin:read",
              write: options.kevinWriteAccount,
            }
          : {
              read: options.kevinReadAccount ?? "opchain:kevin:read",
            },
        vaults: options.kevinVaults ?? ["Personal"],
      },
      human: {
        defaultMode: "default",
        profiles: {
          default: options.humanAccount ?? "opchain:human:default",
        },
        vaults: options.humanVaults ?? ["Human"],
      },
    },
  });
}
