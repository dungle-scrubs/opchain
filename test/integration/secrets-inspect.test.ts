import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHomeConfig } from "../helpers/write-opchain-config.ts";

describe("secrets inspect", () => {
  test("prints metadata without printing resolved secret values", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));

    writeHomeConfig(homePath, {
      identities: {
        human: {
          defaultMode: "default",
          profiles: { default: "opchain-v2:human:default" },
          vaults: ["Human"],
        },
      },
    });

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "human",
        "secrets",
        "inspect",
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

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("reference: op://Services/OpenAI/api-key");
    expect(result.stdout).toContain("vault: Services");
    expect(result.stdout).toContain("item: OpenAI");
    expect(result.stdout).toContain("fields: api-key, region");
    expect(result.stdout).toContain("expires_at: 2026-12-31T00:00:00Z");
    expect(result.stdout).not.toContain("super-secret-value");
    expect(result.stderr).toBe("");
  });

  test("fails cleanly when op returns malformed item JSON", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));

    writeHomeConfig(homePath, {
      identities: {
        human: {
          defaultMode: "default",
          profiles: { default: "opchain-v2:human:default" },
          vaults: ["Human"],
        },
      },
    });

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "human",
        "secrets",
        "inspect",
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
          OPCHAIN_TEST_OP_ITEM_JSON: "{",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Invalid secret inspection payload.\n");
  });
});
