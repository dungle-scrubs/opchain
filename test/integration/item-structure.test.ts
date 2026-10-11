import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHomeConfig } from "../helpers/write-opchain-config.ts";

const SENTINEL = "SENTINEL-SECRET-7f3a9c";

const SENTINEL_ITEM_JSON = JSON.stringify({
  category: "LOGIN",
  fields: [
    { label: "api-key", type: "CONCEALED", value: SENTINEL },
    { label: "region", type: "STRING", value: "us-east-1" },
    { label: "note", type: "STRING", value: null },
  ],
  id: "item-uuid-1",
  title: "OpenAI",
  vault: { id: "vault-uuid-1", name: "Services" },
});

const EXPECTED_STRUCTURE_JSON = `${JSON.stringify(
  {
    title: "OpenAI",
    vault: "Services",
    category: "LOGIN",
    fields: [
      {
        label: "api-key",
        type: "CONCEALED",
        has_value: true,
        value_length: 22,
      },
      { label: "region", type: "STRING", has_value: true, value_length: 9 },
      { label: "note", type: "STRING", has_value: false, value_length: 0 },
    ],
  },
  null,
  2,
)}
`;

/**
 * Runs one item-structure invocation against the fixture binaries.
 *
 * @param argv - Arguments after `bun run src/index.ts`.
 * @param envOverrides - Extra environment variables for the child.
 * @returns Spawn result with captured text output.
 */
function runItemStructure(
  argv: readonly string[],
  envOverrides: Record<string, string> = {},
) {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-item-structure-"));

  writeHomeConfig(homePath, {
    identities: {
      human: {
        defaultMode: "default",
        profiles: { default: "opchain:human:default" },
        vaults: ["Human"],
      },
    },
  });

  return spawnSync(process.execPath, ["run", "src/index.ts", ...argv], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homePath,
      OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
      OPCHAIN_SECURITY_PATH: join(process.cwd(), "test/fixtures/bin/security"),
      OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
      ...envOverrides,
    },
  });
}

describe("item-structure", () => {
  test("prints field structure without ever printing the secret value", () => {
    const result = runItemStructure(
      ["human", "item-structure", "SentinelItem"],
      { OPCHAIN_TEST_OP_ITEM_JSON: SENTINEL_ITEM_JSON },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(EXPECTED_STRUCTURE_JSON);
    expect(result.stdout).not.toContain(SENTINEL);
    expect(result.stderr).not.toContain(SENTINEL);
    expect(result.stdout).not.toContain("us-east-1");
  });

  test("passes --vault through to op before the separator", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-item-structure-"));
    const opLogPath = join(homePath, "op.log");

    writeHomeConfig(homePath, {
      identities: {
        human: {
          defaultMode: "default",
          profiles: { default: "opchain:human:default" },
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
        "item-structure",
        "SentinelItem",
        "--vault",
        "SentinelVault",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_SECURITY_PATH: join(
            process.cwd(),
            "test/fixtures/bin/security",
          ),
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
          OPCHAIN_TEST_OP_ITEM_JSON: SENTINEL_ITEM_JSON,
          OPCHAIN_TEST_OP_LOG: opLogPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(opLogPath, "utf8")).toContain(
      "args=item get --format json --vault SentinelVault -- SentinelItem",
    );
  });

  test("accepts the --vault=<value> spelling", () => {
    const result = runItemStructure(
      ["human", "item-structure", "SentinelItem", "--vault=SentinelVault"],
      { OPCHAIN_TEST_OP_ITEM_JSON: SENTINEL_ITEM_JSON },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"title": "OpenAI"');
  });

  test("rejects missing, extra, or unknown arguments without echoing them", () => {
    for (const argv of [
      ["human", "item-structure"],
      ["human", "item-structure", "SentinelItem", "ExtraItem"],
      ["human", "item-structure", "SentinelItem", "--unknown", "x"],
    ]) {
      const result = runItemStructure(argv, {
        OPCHAIN_TEST_OP_ITEM_JSON: SENTINEL_ITEM_JSON,
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "Usage: opchain <identity> item-structure <item> [--vault <vault>]\n",
      );
      expect(result.stderr).not.toContain("SentinelItem");
    }
  });

  test("fails cleanly on malformed item JSON", () => {
    const result = runItemStructure(
      ["human", "item-structure", "SentinelItem"],
      {
        OPCHAIN_TEST_OP_ITEM_JSON: "{",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Invalid item structure payload.\n");
  });

  test("fails cleanly when op fails, without echoing op output", () => {
    const result = runItemStructure(
      ["human", "item-structure", "SentinelItem"],
      {
        OPCHAIN_TEST_OP_ITEM_STDERR: "op network failure detail",
        OPCHAIN_TEST_OP_ITEM_EXIT_CODE: "70",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Failed to read item structure.\n");
    expect(result.stderr).not.toContain("op network failure detail");
  });
});
