import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("migrate-v1 projects_dir normalization", () => {
  test("migrated ~/dev is usable by project-wide secrets validation", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const projectsDirPath = join(homePath, "dev");
    const projectPath = join(projectsDirPath, "alpha");

    mkdirSync(legacyConfigDirectoryPath, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(
      join(legacyConfigDirectoryPath, "config"),
      [
        "projects_dir=~/dev",
        "read_account=opchain-read",
        "write_account=opchain-write",
        "expires_threshold=14",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(projectPath, ".env.op"),
      "A=op://Services/OpenAI/api-key\n",
      "utf8",
    );

    const migrateResult = spawnSync(
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

    expect(migrateResult.status).toBe(0);
    expect(existsSync(join(legacyConfigDirectoryPath, "config.toml"))).toBe(
      true,
    );

    const validateResult = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "primary",
        "secrets",
        "validate",
        "--project-wide",
      ],
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
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-migrated-config",
        },
      },
    );

    expect(validateResult.status).toBe(0);
    expect(validateResult.stdout).toBe("ok op://Services/OpenAI/api-key\n");
    expect(validateResult.stderr).toBe("");
  });
});
