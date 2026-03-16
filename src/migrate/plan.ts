import type { ExpiryTrackedItem } from "../expires/state.ts";
import { loadLegacyConfig } from "./load-legacy-config.ts";
import { loadLegacyExpires } from "./load-legacy-expires.ts";
import { readOpItemJson } from "../op/item-json.ts";
import { parseExpiryTrackedItem } from "../commands/item-payload.ts";

import type { CliOptions } from "../cli/options.ts";
import {
  resolveLegacyConfigPath,
  resolveLegacyExpiresPath,
} from "../cli/paths.ts";
import type { RuntimeResult } from "../cli/result.ts";
import { resolveTokenForAccount } from "../cli/token-context.ts";

export type MigrationPlan = {
  readonly canApply: boolean;
  readonly expiresRecordCount: number;
  readonly legacyConfigPath: string;
  readonly legacyExpiresPath: string;
  readonly migratedConfigToml: string;
  readonly outputLines: readonly string[];
  readonly trackedItems: readonly ExpiryTrackedItem[];
};

type LegacyExpiryResolution = {
  readonly canApply: boolean;
  readonly outputLines: readonly string[];
  readonly trackedItems: readonly ExpiryTrackedItem[];
};

/**
 * Builds the migrated v2 config TOML for the current personal-machine setup.
 *
 * @param legacyConfig - Parsed legacy config values.
 * @returns {string} TOML config content.
 */
function buildMigratedConfigToml(
  legacyConfig: NonNullable<ReturnType<typeof loadLegacyConfig>>,
): string {
  return [
    "[defaults]",
    `projects_dir = "${legacyConfig.projectsDir ?? "~/dev"}"`,
    `expires_threshold_days = ${legacyConfig.expiresThreshold ?? 14}`,
    'keychain_backend = "helper"',
    "enforce_vault_allowlist = true",
    "",
    "[identities.kevin]",
    'default_mode = "auto"',
    'vaults = ["Personal", "SSH", "Services", "Models", "Infra"]',
    "",
    "[identities.kevin.profiles.read]",
    `keychain_account = "${legacyConfig.readAccount ?? "opchain-read"}"`,
    "",
    "[identities.kevin.profiles.write]",
    `keychain_account = "${legacyConfig.writeAccount ?? "opchain-write"}"`,
    "",
  ].join("\n");
}

/**
 * Resolves legacy expiry records into canonical tracked items when possible.
 *
 * @param options - Parsed CLI options.
 * @param readAccount - Legacy read-account name.
 * @param legacyExpiryRecords - Parsed legacy expiry records.
 * @returns {Promise<LegacyExpiryResolution>} Resolution output and canonical items.
 */
async function resolveLegacyExpiryRecords(
  options: CliOptions,
  readAccount: string | null,
  legacyExpiryRecords: readonly ReturnType<typeof loadLegacyExpires>[number][],
): Promise<LegacyExpiryResolution> {
  if (legacyExpiryRecords.length === 0) {
    return {
      canApply: true,
      outputLines: ["No legacy expiry records found in the v1 expires file."],
      trackedItems: [],
    };
  }

  if (readAccount === null) {
    return {
      canApply: false,
      outputLines: [
        "Cannot import legacy expiry records: legacy read_account is missing.",
      ],
      trackedItems: [],
    };
  }

  const tokenResult = await resolveTokenForAccount(options, readAccount, false);
  if (!tokenResult.ok) {
    return {
      canApply: false,
      outputLines: [
        `Cannot import legacy expiry records: ${tokenResult.error}`,
      ],
      trackedItems: [],
    };
  }

  let canApply = true;
  const outputLines: string[] = [];
  const trackedItems: ExpiryTrackedItem[] = [];

  for (const record of legacyExpiryRecords) {
    const itemResult = readOpItemJson(
      tokenResult.value,
      record.itemSelector,
      "Failed to resolve legacy expiry metadata.",
      "Invalid expiry tracking payload.",
    );
    if (!itemResult.ok) {
      canApply = false;
      outputLines.push(
        `Cannot import legacy expiry ${record.vaultName}/${record.itemSelector}: failed to resolve canonical metadata.`,
      );
      continue;
    }

    const trackedItem = parseExpiryTrackedItem(itemResult.value);
    if (typeof trackedItem === "string") {
      canApply = false;
      outputLines.push(
        `Cannot import legacy expiry ${record.vaultName}/${record.itemSelector}: invalid payload.`,
      );
      continue;
    }

    trackedItems.push(trackedItem);
    outputLines.push(
      `Import legacy expiry ${record.vaultName}/${record.itemSelector} -> ${trackedItem.vaultUuid}/${trackedItem.itemUuid} ${trackedItem.vaultTitle} / ${trackedItem.itemTitle}`,
    );
  }

  return {
    canApply,
    outputLines,
    trackedItems,
  };
}

/**
 * Builds the migration plan from legacy config and expiry state.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<RuntimeResult<MigrationPlan>>} Migration plan or a printable error.
 */
export async function buildMigrationPlan(
  options: CliOptions,
): Promise<RuntimeResult<MigrationPlan>> {
  const legacyConfigPath = resolveLegacyConfigPath();

  let legacyConfig: NonNullable<ReturnType<typeof loadLegacyConfig>>;
  try {
    const loadedLegacyConfig = loadLegacyConfig(legacyConfigPath);
    if (loadedLegacyConfig === null) {
      return {
        error: "Legacy v1 config not found.",
        ok: false,
      };
    }

    legacyConfig = loadedLegacyConfig;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `Legacy config ${error.message}`
          : "Legacy config is invalid.",
      ok: false,
    };
  }

  const legacyExpiresPath = resolveLegacyExpiresPath();
  const legacyExpiryRecords = loadLegacyExpires(legacyExpiresPath);
  const outputLines = [
    `Legacy config: ${legacyConfigPath}`,
    `Legacy expires: ${legacyExpiresPath}`,
    `Map ${legacyConfig.readAccount ?? "(missing)"} -> kevin.read`,
    `Map ${legacyConfig.writeAccount ?? "(missing)"} -> kevin.write`,
    `Set defaults.projects_dir -> ${legacyConfig.projectsDir ?? "(missing)"}`,
    `Set defaults.expires_threshold_days -> ${legacyConfig.expiresThreshold ?? "(missing)"}`,
  ];

  const legacyExpiryResolution = await resolveLegacyExpiryRecords(
    options,
    legacyConfig.readAccount,
    legacyExpiryRecords,
  );

  return {
    ok: true,
    value: {
      canApply: legacyExpiryResolution.canApply,
      expiresRecordCount: legacyExpiryRecords.length,
      legacyConfigPath,
      legacyExpiresPath,
      migratedConfigToml: buildMigratedConfigToml(legacyConfig),
      outputLines: [...outputLines, ...legacyExpiryResolution.outputLines],
      trackedItems: legacyExpiryResolution.trackedItems,
    },
  };
}
