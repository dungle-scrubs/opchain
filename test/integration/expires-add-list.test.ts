import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("expires add/list", () => {
  test("persists canonical IDs and lists tracked items", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const statePath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
      "human.json",
    );

    writeHumanConfig(homePath);

    const addResult = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "human",
        "expires",
        "add",
        "op://Services/OpenAI/api-key",
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
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
        },
      },
    );

    expect(addResult.status).toBe(0);
    expect(addResult.stdout).toBe(
      "Added expiry tracking for vault-uuid-1/item-uuid-1.\n",
    );
    expect(addResult.stderr).toBe("");
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toEqual({
      identity: "human",
      trackedItems: [
        {
          expiresAt: "2026-12-31T00:00:00Z",
          itemTitle: "OpenAI",
          itemUuid: "item-uuid-1",
          vaultTitle: "Services",
          vaultUuid: "vault-uuid-1",
        },
      ],
      version: 1,
    });

    const listResult = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "expires", "list"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
        },
      },
    );

    expect(listResult.status).toBe(0);
    expect(listResult.stdout).toBe(
      "vault-uuid-1/item-uuid-1 Services / OpenAI\n",
    );
    expect(listResult.stderr).toBe("");
  });

  test("rejects expires add when the resolved item has no expires_at", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const statePath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
      "human.json",
    );

    writeHumanConfig(homePath);

    const addResult = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "human",
        "expires",
        "add",
        "op://Services/NoExpiryItem/key",
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
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
          // Supply a fake item payload with no expires_at
          OPCHAIN_TEST_OP_ITEM_JSON: JSON.stringify({
            id: "item-uuid-no-expiry",
            reference: "op://Services/NoExpiryItem/key",
            vault: { id: "vault-uuid-1", name: "Services" },
            title: "NoExpiryItem",
            fields: [{ label: "key", value: "val" }],
          }),
        },
      },
    );

    expect(addResult.status).toBe(1);
    expect(addResult.stderr).toBe(
      "Cannot track expiry: the resolved item has no expires_at date.\n",
    );
    // State file must not be created for the failed add
    expect(existsSync(statePath)).toBe(false);
  });
});
