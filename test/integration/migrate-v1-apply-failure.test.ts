import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("migrate-v1 apply failure", () => {
  test("fails before writing v2 files when legacy expiry records cannot be resolved", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const legacyConfigPath = join(legacyConfigDirectoryPath, "config");
    const legacyExpiresPath = join(legacyConfigDirectoryPath, "expires");
    const v2ConfigPath = join(homePath, ".config", "opchain-v2", "config.toml");
    const v2ExpiresPath = join(
      homePath,
      ".config",
      "opchain-v2",
      "state",
      "expires",
      "kevin.json",
    );

    mkdirSync(legacyConfigDirectoryPath, { recursive: true });
    writeFileSync(
      legacyConfigPath,
      [
        "projects_dir=~/dev",
        "read_account=opchain-read",
        "write_account=opchain-write",
        "expires_threshold=14",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      legacyExpiresPath,
      ["Dev\titem-123\tTracked API Key"].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "migrate-v1"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_HELPER_PATH: join(
            process.cwd(),
            "test/fixtures/bin/opchain-helper",
          ),
          OPCHAIN_SECURITY_PATH: join(
            process.cwd(),
            "test/fixtures/bin/security",
          ),
          OPCHAIN_TEST_HELPER_EXIT_CODE: "1",
          OPCHAIN_TEST_HELPER_STDERR: "helper unavailable",
          OPCHAIN_TEST_SECURITY_EXIT_CODE: "1",
          OPCHAIN_TEST_SECURITY_STDERR: "security unavailable",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "migrate-v1 apply requires resolving all legacy expiry records before writing v2 files.",
    );
    expect(result.stderr).toContain("Cannot import legacy expiry records:");
    expect(existsSync(v2ConfigPath)).toBe(false);
    expect(existsSync(v2ExpiresPath)).toBe(false);
  });

  test("rejects an invalid legacy expires_threshold before writing v2 files", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const legacyConfigPath = join(legacyConfigDirectoryPath, "config");
    const v2ConfigPath = join(homePath, ".config", "opchain-v2", "config.toml");

    mkdirSync(legacyConfigDirectoryPath, { recursive: true });
    writeFileSync(
      legacyConfigPath,
      [
        "projects_dir=~/dev",
        "read_account=opchain-read",
        "write_account=opchain-write",
        "expires_threshold=abc",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "migrate-v1"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Legacy config expires_threshold must be a positive integer.\n",
    );
    expect(existsSync(v2ConfigPath)).toBe(false);
  });
});
