import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHomeConfig } from "../helpers/write-opchain-config.ts";

/** Runs `opchain human secrets inspect <reference>` against the fake op. */
function runInspect(
  reference: string,
  extraEnv: Readonly<Record<string, string>> = {},
) {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));

  writeHomeConfig(homePath, {
    identities: {
      human: {
        defaultMode: "default",
        profiles: { default: "opchain:human:default" },
        vaults: ["Human"],
      },
    },
  });

  return spawnSync(
    process.execPath,
    ["run", "src/index.ts", "human", "secrets", "inspect", reference],
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
        OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
        ...extraEnv,
      },
    },
  );
}

describe("secrets inspect", () => {
  test("prints metadata without printing resolved secret values", () => {
    const logPath = join(
      mkdtempSync(join(tmpdir(), "opchain-op-log-")),
      "op.log",
    );
    const result = runInspect("op://Services/OpenAI/api-key", {
      OPCHAIN_TEST_OP_LOG: logPath,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("reference: op://Services/OpenAI/api-key");
    expect(result.stdout).toContain("vault: Services");
    expect(result.stdout).toContain("item: OpenAI");
    expect(result.stdout).toContain("fields: api-key, region");
    expect(result.stdout).toContain("expires_at: 2026-12-31T00:00:00Z");
    expect(result.stdout).not.toContain("super-secret-value");
    expect(result.stderr).toBe("");
    // op item get takes the item and vault, never the whole reference.
    expect(readFileSync(logPath, "utf8")).toContain(
      "args=item get --format json --vault Services -- OpenAI",
    );
  });

  test("matches the field by ID or label, case-insensitively, and by section", () => {
    for (const reference of [
      "op://Services/OpenAI/API-KEY",
      "op://Services/OpenAI/Details/api-key",
      "op://Services/OpenAI/add more/api-key",
      "op://Services/OpenAI/region?attribute=type",
    ]) {
      const result = runInspect(reference);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`reference: ${reference}`);
    }
  });

  test("reports a field the item does not have", () => {
    for (const reference of [
      "op://Services/OpenAI/missing",
      "op://Services/OpenAI/Other/api-key",
      "op://Services/OpenAI/Details/region",
    ]) {
      const result = runInspect(reference);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "Failed to inspect secret reference: field not found.\n",
      );
    }
  });

  test("names op's failure kind without copying op's text", () => {
    const cases: readonly (readonly [string, string])[] = [
      [
        '[ERROR] "OpenAI" isn\'t an item in the "Services" vault.',
        "Failed to inspect secret reference: item not found.\n",
      ],
      [
        '[ERROR] "Services" isn\'t a vault in this account.',
        "Failed to inspect secret reference: vault not found or not visible to this identity.\n",
      ],
      [
        "[ERROR] dial tcp: lookup my.1password.com: no such host",
        "Failed to inspect secret reference: 1Password could not be reached.\n",
      ],
      [
        '[ERROR] "forbidden" isn\'t an item in the "Services" vault.',
        "Failed to inspect secret reference: item not found.\n",
      ],
      [
        "[ERROR] something else went wrong",
        "Failed to inspect secret reference.\n",
      ],
    ];
    for (const [opStderr, expected] of cases) {
      const result = runInspect("op://Services/OpenAI/api-key", {
        OPCHAIN_TEST_OP_ITEM_STDERR: opStderr,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(expected);
    }
  });

  test("rejects a malformed reference before resolving a token or calling op", () => {
    for (const reference of [
      "op://Services/OpenAI",
      "op://Services/OpenAI/api@key",
    ]) {
      const logDirectory = mkdtempSync(join(tmpdir(), "opchain-op-log-"));
      const opLogPath = join(logDirectory, "op.log");
      const tokenLogPath = join(logDirectory, "token.log");
      const result = runInspect(reference, {
        OPCHAIN_TEST_OP_LOG: opLogPath,
        OPCHAIN_TEST_SECURITY_TOKEN_LOG: tokenLogPath,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "Invalid secret reference. Expected op://<vault>/<item>[/<section>]/<field>.\n",
      );
      expect(() => readFileSync(opLogPath, "utf8")).toThrow();
      expect(() => readFileSync(tokenLogPath, "utf8")).toThrow();
    }
  });

  test("reports a reference that matches more than one field", () => {
    const result = runInspect("op://Services/OpenAI/password", {
      OPCHAIN_TEST_OP_ITEM_JSON: JSON.stringify({
        fields: [
          { id: "password", label: "Login password" },
          { id: "x7k2", label: "password" },
        ],
        id: "item-uuid-1",
        title: "OpenAI",
        vault: { id: "vault-uuid-1", name: "Services" },
      }),
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Failed to inspect secret reference: more than one field matches; use the field's ID.\n",
    );
  });

  test("finds a file attachment by name", () => {
    const result = runInspect("op://Services/OpenAI/key.pem", {
      OPCHAIN_TEST_OP_ITEM_JSON: JSON.stringify({
        fields: [{ id: "notesPlain", label: "notesPlain" }],
        files: [{ id: "file-uuid-1", name: "key.pem" }],
        id: "item-uuid-1",
        title: "OpenAI",
        vault: { id: "vault-uuid-1", name: "Services" },
      }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("reference: op://Services/OpenAI/key.pem");
  });

  test("reports a timed-out op as 1Password unreachable", () => {
    const result = runInspect("op://Services/OpenAI/api-key", {
      OPCHAIN_OP_TIMEOUT_MS: "100",
      OPCHAIN_TEST_OP_SLEEP_MS: "3000",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "Failed to inspect secret reference: 1Password could not be reached.\n",
    );
  });

  test("fails cleanly when op returns malformed item JSON", () => {
    const result = runInspect("op://Services/OpenAI/api-key", {
      OPCHAIN_TEST_OP_ITEM_JSON: "{",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Invalid secret inspection payload.\n");
  });
});
