import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

interface TelemetryEvent {
  readonly attributes: Record<string, unknown>;
  readonly name: string;
}

/**
 * Parses newline-delimited JSON telemetry.
 *
 * @param stderr - Raw stderr output from the CLI.
 * @returns {readonly TelemetryEvent[]} Parsed telemetry events.
 */
function parseEvents(stderr: string): readonly TelemetryEvent[] {
  return stderr
    .trim()
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as TelemetryEvent);
}

describe("migrate-v1 debug json", () => {
  test("emits migration.plan telemetry for dry-run", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const legacyConfigPath = join(legacyConfigDirectoryPath, "config");

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

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "--debug",
        "--debug-format",
        "json",
        "migrate-v1",
        "--dry-run",
      ],
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
    expect(result.stderr).not.toContain("opchain-read");
    const migrationPlanEvent = parseEvents(result.stderr).find(
      (event) => event.name === "migration.plan",
    );
    expect(migrationPlanEvent?.attributes.projects_dir_home_expanded).toBe(
      true,
    );
    expect(JSON.stringify(migrationPlanEvent)).not.toContain(homePath);
  });

  test("emits migration.apply telemetry for apply mode", () => {
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
      "Dev\titem-123\tTracked API Key\n",
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "--debug",
        "--debug-format",
        "json",
        "migrate-v1",
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
    expect(result.stderr).not.toContain("opchain-read");
    const migrationApplyEvent = parseEvents(result.stderr).find(
      (event) => event.name === "migration.apply",
    );
    expect(migrationApplyEvent?.attributes.outcome).toBe("success");
    expect(JSON.stringify(migrationApplyEvent)).not.toContain(
      "token-from-legacy-read-account",
    );
  });

  test("emits redacted migration.apply telemetry for apply failure", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const legacyConfigDirectoryPath = join(homePath, ".config", "opchain");
    const legacyConfigPath = join(legacyConfigDirectoryPath, "config");
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
    writeFileSync(`${v2ExpiresPath}.lock`, "locked\n", "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "--debug",
        "--debug-format",
        "json",
        "migrate-v1",
      ],
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
    const migrationApplyEvent = parseEvents(result.stderr).find(
      (event) => event.name === "migration.apply",
    );
    expect(migrationApplyEvent?.attributes.outcome).toBe("failure");
    expect(migrationApplyEvent?.attributes.rollback_performed).toBe(true);
    expect(JSON.stringify(migrationApplyEvent)).not.toContain(homePath);
  });
});
