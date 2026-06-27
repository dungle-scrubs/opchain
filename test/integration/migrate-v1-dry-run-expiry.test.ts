import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("migrate-v1 --dry-run expiry import", () => {
  test("resolves legacy expiry records into canonical IDs", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
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
      ["Dev\titem-123\tCached Title"].join("\n"),
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
          OPCHAIN_SECURITY_PATH: join(
            process.cwd(),
            "test/fixtures/bin/security",
          ),
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_SECURITY_TOKEN: "token-from-legacy-read-account",
          OPCHAIN_TEST_OP_ITEM_JSON: JSON.stringify({
            expires_at: "2026-12-31T00:00:00Z",
            fields: [
              { label: "api-key", value: "super-secret-value" },
              { label: "region", value: "us-east-1" },
            ],
            id: "item-uuid-1",
            reference: "op://Services/OpenAI/api-key",
            title: "OpenAI",
            vault: { id: "vault-uuid-1", name: "Services" },
          }),
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Import legacy expiry Dev/item-123 -> vault-uuid-1/item-uuid-1 Services / OpenAI",
    );
    expect(result.stdout).not.toContain("super-secret-value");
    expect(result.stderr).toBe("");
  });
});
