import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "toml";

import type { CliOptions } from "../../src/cli/options.ts";
import {
  buildMigrationPlan,
  escapeTomlString,
} from "../../src/migrate/plan.ts";
import { withEnv } from "../helpers/with-env.ts";

/**
 * Creates one minimal CLI options object for migration-plan tests.
 *
 * @returns {CliOptions} Stable CLI options fixture.
 */
function createCliOptions(): CliOptions {
  return {
    accessOverride: undefined,
    allowEnvToken: false,
    commandArgs: ["migrate-v1", "--dry-run"],
    debug: false,
    debugFormat: "text",
    explicitProfile: undefined,
    help: false,
  };
}

/**
 * Writes one legacy v1 config file into the provided HOME directory.
 *
 * @param homePath - Temporary HOME directory.
 * @param lines - Config file lines.
 * @returns {string} Legacy config path.
 */
function writeLegacyConfig(homePath: string, lines: readonly string[]): string {
  const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
  const legacyConfigPath = join(legacyConfigDirectoryPath, "config");

  mkdirSync(legacyConfigDirectoryPath, { recursive: true });
  writeFileSync(legacyConfigPath, lines.join("\n"), "utf8");
  return legacyConfigPath;
}

/**
 * Writes one legacy v1 expires file into the provided HOME directory.
 *
 * @param homePath - Temporary HOME directory.
 * @param lines - Expires file lines.
 * @returns {string} Legacy expires path.
 */
function writeLegacyExpires(
  homePath: string,
  lines: readonly string[],
): string {
  const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
  const legacyExpiresPath = join(legacyConfigDirectoryPath, "expires");

  mkdirSync(legacyConfigDirectoryPath, { recursive: true });
  writeFileSync(legacyExpiresPath, lines.join("\n"), "utf8");
  return legacyExpiresPath;
}

describe("escapeTomlString", () => {
  test("round-trips a value containing a quote and a newline", () => {
    const original = 'line-one"with-quote\nline-two\ttabbed';
    const toml = `value = "${escapeTomlString(original)}"`;

    const parsed = parse(toml) as { value: string };

    expect(parsed.value).toBe(original);
  });

  test("round-trips backslashes, carriage returns, and control characters", () => {
    const original = "a\\b\r\x00\x7f end";
    const toml = `value = "${escapeTomlString(original)}"`;

    const parsed = parse(toml) as { value: string };

    expect(parsed.value).toBe(original);
  });

  test("leaves ordinary values unchanged", () => {
    expect(escapeTomlString("opchain-read")).toBe("opchain-read");
  });
});

describe("buildMigrationPlan", () => {
  test("returns an error when the legacy config is missing", async () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigPath = join(homePath, ".config", "opchain", "config");
    const legacyExpiresPath = join(homePath, ".config", "opchain", "expires");

    const result = await withEnv(
      {
        OPCHAIN_LEGACY_CONFIG_PATH: legacyConfigPath,
        OPCHAIN_LEGACY_EXPIRES_PATH: legacyExpiresPath,
      },
      async () => buildMigrationPlan(createCliOptions()),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected migration plan building to fail.");
    }

    expect(result.error).toBe("Legacy v1 config not found.");
  });

  test("builds a migration plan with canonical expiry items", async () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigPath = writeLegacyConfig(homePath, [
      "projects_dir=~/dev",
      "read_account=opchain-read",
      "write_account=opchain-write",
      "expires_threshold=14",
    ]);
    const legacyExpiresPath = writeLegacyExpires(homePath, [
      "Dev\titem-123\tCached Title",
    ]);

    const result = await withEnv(
      {
        HOME: homePath,
        OPCHAIN_SECURITY_PATH: join(
          process.cwd(),
          "test/fixtures/bin/security",
        ),
        OPCHAIN_LEGACY_CONFIG_PATH: legacyConfigPath,
        OPCHAIN_LEGACY_EXPIRES_PATH: legacyExpiresPath,
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
      async () => buildMigrationPlan(createCliOptions()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.value.canApply).toBe(true);
    expect(result.value.expiresRecordCount).toBe(1);
    expect(result.value.legacyConfigPath).toBe(legacyConfigPath);
    expect(result.value.legacyExpiresPath).toBe(legacyExpiresPath);
    expect(result.value.migratedConfigToml).toContain(
      `projects_dir = "${join(homedir(), "dev")}"`,
    );
    expect(result.value.migratedConfigToml).toContain(
      'keychain_account = "opchain-read"',
    );
    expect(result.value.outputLines).toContain(
      "Import legacy expiry Dev/item-123 -> vault-uuid-1/item-uuid-1 Services / OpenAI",
    );
    expect(result.value.outputLines.join("\n")).not.toContain(
      "super-secret-value",
    );
    expect(result.value.trackedItems).toEqual([
      {
        expiresAt: "2026-12-31T00:00:00Z",
        itemTitle: "OpenAI",
        itemUuid: "item-uuid-1",
        vaultTitle: "Services",
        vaultUuid: "vault-uuid-1",
      },
    ]);
  });

  test("escapes hostile legacy values so the generated TOML round-trips", async () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    // A quote-injection attempt on a single line: the legacy loader collapses
    // newlines, so the double-quote is the value that can reach the builder.
    const hostileAccount = 'evil" }\nrogue_table = "injected';
    const projectsDir = '/tmp/quote"and\\backslash';
    const legacyConfigPath = writeLegacyConfig(homePath, [
      `projects_dir=${projectsDir}`,
      `read_account=${hostileAccount}`,
      "write_account=opchain-write",
      "expires_threshold=14",
    ]);
    const legacyExpiresPath = writeLegacyExpires(homePath, []);

    const result = await withEnv(
      {
        HOME: homePath,
        OPCHAIN_LEGACY_CONFIG_PATH: legacyConfigPath,
        OPCHAIN_LEGACY_EXPIRES_PATH: legacyExpiresPath,
      },
      async () => buildMigrationPlan(createCliOptions()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }

    // The generated TOML must be valid and re-parseable with the same parser.
    const parsed = parse(result.value.migratedConfigToml) as {
      defaults: { projects_dir: string };
      identities: {
        primary: { profiles: { read: { keychain_account: string } } };
      };
    };

    // The loader collapses the newline, so the value that reaches the builder
    // is the first physical line's remainder; the double-quote round-trips
    // exactly and injects no additional table or key.
    expect(parsed.identities.primary.profiles.read.keychain_account).toBe(
      'evil" }',
    );
    expect(parsed).not.toHaveProperty("rogue_table");
    expect(parsed.defaults.projects_dir).toBe(projectsDir);
  });

  test("marks the plan as non-applicable when legacy read_account is missing", async () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigPath = writeLegacyConfig(homePath, [
      "projects_dir=~/dev",
      "write_account=opchain-write",
      "expires_threshold=14",
    ]);
    const legacyExpiresPath = writeLegacyExpires(homePath, [
      "Dev\titem-123\tCached Title",
    ]);

    const result = await withEnv(
      {
        OPCHAIN_LEGACY_CONFIG_PATH: legacyConfigPath,
        OPCHAIN_LEGACY_EXPIRES_PATH: legacyExpiresPath,
      },
      async () => buildMigrationPlan(createCliOptions()),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.value.canApply).toBe(false);
    expect(result.value.outputLines).toContain(
      "Cannot import legacy expiry records: legacy read_account is missing.",
    );
    expect(result.value.trackedItems).toEqual([]);
  });
});
