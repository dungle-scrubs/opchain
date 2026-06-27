import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("expires scan", () => {
  test("updates tracked items from fake op metadata and classifies expiring status", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const statePath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
      "human.json",
    );
    const expiresAt = new Date(
      Date.now() + 3 * 24 * 60 * 60 * 1000,
    ).toISOString();

    mkdirSync(join(homePath, ".config", "opchain", "state", "expires"), {
      recursive: true,
    });
    writeHumanConfig(homePath);
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          identity: "human",
          trackedItems: [
            {
              itemTitle: "OpenAI",
              itemUuid: "item-uuid-1",
              vaultTitle: "Services",
              vaultUuid: "vault-uuid-1",
            },
          ],
          version: 1,
        },
        null,
        2,
      )}
`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "expires", "scan"],
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
          OPCHAIN_TEST_OP_ITEM_JSON: JSON.stringify({
            expires_at: expiresAt,
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
    expect(result.stdout).toBe(
      `expiring vault-uuid-1/item-uuid-1 ${expiresAt} Services / OpenAI\n`,
    );
    expect(result.stderr).toBe("");

    expect(JSON.parse(readFileSync(statePath, "utf8"))).toEqual({
      identity: "human",
      trackedItems: [
        {
          expiresAt,
          itemTitle: "OpenAI",
          itemUuid: "item-uuid-1",
          lastCheckedAt: expect.any(String),
          status: "expiring",
          vaultTitle: "Services",
          vaultUuid: "vault-uuid-1",
        },
      ],
      version: 1,
    });
  });

  test("fails cleanly when op returns malformed item JSON", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const statePath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
      "human.json",
    );

    mkdirSync(join(homePath, ".config", "opchain", "state", "expires"), {
      recursive: true,
    });
    writeHumanConfig(homePath);
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          identity: "human",
          trackedItems: [
            {
              itemTitle: "OpenAI",
              itemUuid: "item-uuid-1",
              vaultTitle: "Services",
              vaultUuid: "vault-uuid-1",
            },
          ],
          version: 1,
        },
        null,
        2,
      )}
`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "expires", "scan"],
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
          OPCHAIN_TEST_OP_ITEM_JSON: "{",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Invalid expiry scan payload.\n");
  });
});
