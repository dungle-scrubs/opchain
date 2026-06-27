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
        'projects_dir = "/Users/example/dev"',
        "expires_threshold_days = 14",
        "enforce_vault_allowlist = true",
        "",
        "[identities.primary]",
        'default_mode = "auto"',
        'vaults = ["Personal", "Services"]',
        "",
        "[identities.primary.profiles.read]",
        'keychain_account = "opchain:primary:read"',
        "",
        "[identities.primary.profiles.write]",
        'keychain_account = "opchain:primary:write"',
      ].join("\n"),
      "utf8",
    );

    const result = await loadConfig(configPath);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value.defaults.projectsDir).toBe("/Users/example/dev");
    expect(result.value.identities.primary?.defaultMode).toBe("auto");
    expect(
      result.value.identities.primary?.profiles.read?.keychainAccount,
    ).toBe("opchain:primary:read");
    expect(result.value.identities.primary?.vaults).toEqual([
      "Personal",
      "Services",
    ]);
  });

  test("expands home-relative projects_dir values", async () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-config-"));
    const configPath = join(directoryPath, "config.toml");

    writeFileSync(
      configPath,
      [
        "[defaults]",
        'projects_dir = "~/dev"',
        "expires_threshold_days = 14",
        "enforce_vault_allowlist = true",
        "",
        "[identities.primary]",
        'default_mode = "auto"',
        'vaults = ["Personal", "Services"]',
        "",
        "[identities.primary.profiles.read]",
        'keychain_account = "opchain:primary:read"',
      ].join("\n"),
      "utf8",
    );

    const result = await loadConfig(configPath);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value.defaults.projectsDir).toBe(
      join(process.env.HOME ?? "", "dev"),
    );
  });

  test("returns a precise error for an invalid nested profile field", async () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-config-"));
    const configPath = join(directoryPath, "config.toml");

    writeFileSync(
      configPath,
      [
        "[defaults]",
        'projects_dir = "/Users/example/dev"',
        "expires_threshold_days = 14",
        "enforce_vault_allowlist = true",
        "",
        "[identities.primary]",
        'default_mode = "auto"',
        'vaults = ["Personal"]',
        "",
        "[identities.primary.profiles.read]",
      ].join("\n"),
      "utf8",
    );

    const result = await loadConfig(configPath);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected config loading to fail.");
    }

    expect(result.error.message).toBe(
      "identities.primary.profiles.read.keychain_account must be a non-empty string.",
    );
  });

  test("rejects identity keys that cannot be used as safe path segments", async () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-config-"));
    const configPath = join(directoryPath, "config.toml");

    writeFileSync(
      configPath,
      [
        "[defaults]",
        'projects_dir = "/Users/example/dev"',
        "expires_threshold_days = 14",
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
