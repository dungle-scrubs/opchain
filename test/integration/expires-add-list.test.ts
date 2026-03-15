import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("expires add/list", () => {
  test("persists canonical IDs and lists tracked items", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const statePath = join(
      homePath,
      ".config",
      "opchain-v2",
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
          OPCHAIN_HELPER_PATH: join(
            process.cwd(),
            "test/fixtures/bin/opchain-helper",
          ),
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_HELPER_TOKEN: "token-for-human-default",
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
});
