import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("migrate-v1 apply guard", () => {
  test("fails clearly when v2 targets already exist", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const legacyConfigPath = join(legacyConfigDirectoryPath, "config");
    const v2ConfigDirectoryPath = join(homePath, ".config", "opchain");
    const v2ConfigPath = join(v2ConfigDirectoryPath, "config.toml");

    mkdirSync(legacyConfigDirectoryPath, { recursive: true });
    mkdirSync(v2ConfigDirectoryPath, { recursive: true });
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
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "migrate-v1 apply is guarded: target v2 config or expires state already exists.\n",
    );
  });
});
