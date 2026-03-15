import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("migrate-v1 --dry-run", () => {
  test("prints planned token mappings and detected legacy inputs", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const legacyConfigPath = join(legacyConfigDirectoryPath, "config");
    const legacyExpiresPath = join(legacyConfigDirectoryPath, "expires");

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
      ["run", "src/index.ts", "migrate-v1", "--dry-run"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Legacy config: ");
    expect(result.stdout).toContain("Legacy expires: ");
    expect(result.stdout).toContain("Map opchain-read -> kevin.read");
    expect(result.stdout).toContain("Map opchain-write -> kevin.write");
    expect(result.stdout).toContain("Set defaults.projects_dir -> ~/dev");
    expect(result.stdout).toContain(
      "Set defaults.expires_threshold_days -> 14",
    );
    expect(result.stdout).toContain(
      "Cannot import legacy expiry records:",
    );
    expect(result.stderr).toBe("");
  });
});
