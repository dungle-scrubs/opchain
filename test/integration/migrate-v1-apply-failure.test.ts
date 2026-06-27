import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("migrate-v1 apply failure", () => {
  test("fails before writing v2 files when legacy expiry records cannot be resolved", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const legacyConfigPath = join(legacyConfigDirectoryPath, "config");
    const legacyExpiresPath = join(legacyConfigDirectoryPath, "expires");
    const v2ConfigPath = join(homePath, ".config", "opchain", "config.toml");
    const v2ExpiresPath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
      "primary.json",
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
          OPCHAIN_SECURITY_PATH: join(
            process.cwd(),
            "test/fixtures/bin/security",
          ),
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
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const legacyConfigPath = join(legacyConfigDirectoryPath, "config");
    const v2ConfigPath = join(homePath, ".config", "opchain", "config.toml");

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

  test("expiry lock failure rolls back a newly written config", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const legacyConfigPath = join(legacyConfigDirectoryPath, "config");
    const v2ConfigPath = join(homePath, ".config", "opchain", "config.toml");
    const v2ExpiresPath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
      "primary.json",
    );
    const v2ExpiresLockPath = `${v2ExpiresPath}.lock`;

    mkdirSync(legacyConfigDirectoryPath, { recursive: true });
    mkdirSync(join(homePath, ".config", "opchain", "state", "expires"), {
      recursive: true,
    });
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
    writeFileSync(v2ExpiresLockPath, "locked\n", "utf8");

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
    expect(result.stderr).toContain("Failed to save expiry state:");
    expect(existsSync(v2ConfigPath)).toBe(false);
    expect(existsSync(v2ExpiresPath)).toBe(false);
    expect(readFileSync(v2ExpiresLockPath, "utf8")).toBe("locked\n");
  });

  test("pre-existing v2 config is preserved when apply is guarded", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const legacyConfigPath = join(legacyConfigDirectoryPath, "config");
    const v2ConfigPath = join(homePath, ".config", "opchain", "config.toml");

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
    writeFileSync(v2ConfigPath, "already-migrated = true\n", "utf8");

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
    expect(readFileSync(v2ConfigPath, "utf8")).toBe(
      "already-migrated = true\n",
    );
  });

  test("pre-existing v2 expiry state is preserved when apply is guarded", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const legacyConfigPath = join(legacyConfigDirectoryPath, "config");
    const v2ConfigPath = join(homePath, ".config", "opchain", "config.toml");
    const v2ExpiresPath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
      "primary.json",
    );

    mkdirSync(legacyConfigDirectoryPath, { recursive: true });
    mkdirSync(join(homePath, ".config", "opchain", "state", "expires"), {
      recursive: true,
    });
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
      v2ExpiresPath,
      '{"identity":"primary","trackedItems":[],"version":1}\n',
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
    expect(existsSync(v2ConfigPath)).toBe(false);
    expect(readFileSync(v2ExpiresPath, "utf8")).toBe(
      '{"identity":"primary","trackedItems":[],"version":1}\n',
    );
  });
});
