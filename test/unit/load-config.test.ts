import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig } from "../../src/config/load-config.ts";

describe("loadConfig", () => {
  test("loads a valid config file into typed domain data", async () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-config-"));
    const configPath = join(directoryPath, "config.toml");

    writeFileSync(
      configPath,
      [
        "[defaults]",
        'projects_dir = "/Users/kevin/dev"',
        "expires_threshold_days = 14",
        'keychain_backend = "helper"',
        "enforce_vault_allowlist = true",
        "",
        "[identities.kevin]",
        'default_mode = "auto"',
        'vaults = ["Personal", "Services"]',
        "",
        "[identities.kevin.profiles.read]",
        'keychain_account = "opchain:kevin:read"',
        "",
        "[identities.kevin.profiles.write]",
        'keychain_account = "opchain:kevin:write"',
      ].join("\n"),
      "utf8",
    );

    const result = await loadConfig(configPath);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value.defaults.projectsDir).toBe("/Users/kevin/dev");
    expect(result.value.identities.kevin?.defaultMode).toBe("auto");
    expect(result.value.identities.kevin?.profiles.read?.keychainAccount).toBe(
      "opchain:kevin:read",
    );
    expect(result.value.identities.kevin?.vaults).toEqual([
      "Personal",
      "Services",
    ]);
  });

  test("returns a precise error for an invalid nested profile field", async () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-config-"));
    const configPath = join(directoryPath, "config.toml");

    writeFileSync(
      configPath,
      [
        "[defaults]",
        'projects_dir = "/Users/kevin/dev"',
        "expires_threshold_days = 14",
        'keychain_backend = "helper"',
        "enforce_vault_allowlist = true",
        "",
        "[identities.kevin]",
        'default_mode = "auto"',
        'vaults = ["Personal"]',
        "",
        "[identities.kevin.profiles.read]",
      ].join("\n"),
      "utf8",
    );

    const result = await loadConfig(configPath);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected config loading to fail.");
    }

    expect(result.error.message).toBe(
      "identities.kevin.profiles.read.keychain_account must be a non-empty string.",
    );
  });

  test("rejects identity keys that cannot be used as safe path segments", async () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-config-"));
    const configPath = join(directoryPath, "config.toml");

    writeFileSync(
      configPath,
      [
        "[defaults]",
        'projects_dir = "/Users/kevin/dev"',
        "expires_threshold_days = 14",
        'keychain_backend = "helper"',
        "enforce_vault_allowlist = true",
        "",
        '[identities."../pwn"]',
        'default_mode = "default"',
        'vaults = ["Personal"]',
        "",
        '[identities."../pwn".profiles.default]',
        'keychain_account = "opchain:pwn:default"',
      ].join("\n"),
      "utf8",
    );

    const result = await loadConfig(configPath);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected config loading to fail.");
    }

    expect(result.error.message).toBe(
      "identities.../pwn must contain only letters, numbers, underscores, and hyphens.",
    );
  });
});
