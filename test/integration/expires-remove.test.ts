import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";
import { spawnSync } from "node:child_process";

describe("expires remove", () => {
  test("removes one tracked item by canonical vault/item IDs", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const stateDirectoryPath = join(
      homePath,
      ".config",
      "opchain-v2",
      "state",
      "expires",
    );
    const statePath = join(stateDirectoryPath, "human.json");

    mkdirSync(stateDirectoryPath, { recursive: true });
    writeHumanConfig(homePath);
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          identity: "human",
          trackedItems: [
            {
              expiresAt: "2026-12-31T00:00:00Z",
              itemTitle: "OpenAI",
              itemUuid: "item-uuid-1",
              lastCheckedAt: "2026-01-01T00:00:00Z",
              status: "healthy",
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
      [
        "run",
        "src/index.ts",
        "human",
        "expires",
        "remove",
        "vault-uuid-1/item-uuid-1",
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
    expect(result.stdout).toBe(
      "Removed expiry tracking for vault-uuid-1/item-uuid-1.\n",
    );
    expect(result.stderr).toBe("");
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toEqual({
      identity: "human",
      trackedItems: [],
      version: 1,
    });
  });
});
