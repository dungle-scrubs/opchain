import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readOpItemJson } from "../../src/op/item-json.ts";
import { withEnv } from "../helpers/with-env.ts";

describe("readOpItemJson", () => {
  test("loads parsed item JSON and injects the service-account token", async () => {
    const logDirectoryPath = mkdtempSync(join(tmpdir(), "opchain-op-log-"));
    const logPath = join(logDirectoryPath, "op.log");

    const result = await withEnv(
      {
        OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
        OPCHAIN_TEST_OP_ITEM_JSON: JSON.stringify({
          id: "item-uuid-1",
          title: "OpenAI",
          vault: { id: "vault-uuid-1", name: "Services" },
        }),
        OPCHAIN_TEST_OP_LOG: logPath,
      },
      async () =>
        readOpItemJson(
          "token-from-test",
          "item-123",
          "item lookup failed",
          "item payload invalid",
        ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.value).toEqual({
      id: "item-uuid-1",
      title: "OpenAI",
      vault: { id: "vault-uuid-1", name: "Services" },
    });
    expect(readFileSync(logPath, "utf8")).toContain(
      "args=item get --format json -- item-123",
    );
    expect(readFileSync(logPath, "utf8")).toContain("token=token-from-test");
  });

  test("returns an exec failure when op item get exits non-zero", async () => {
    const result = await withEnv(
      {
        OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
        OPCHAIN_TEST_OP_ITEM_EXIT_CODE: "70",
        OPCHAIN_TEST_OP_ITEM_STDERR: "network error",
      },
      async () =>
        readOpItemJson(
          "token-from-test",
          "item-123",
          "item lookup failed",
          "item payload invalid",
        ),
    );

    expect(result).toEqual({
      error: "item lookup failed",
      ok: false,
      reason: "exec",
    });
  });

  test("returns a parse failure when op item get returns malformed JSON", async () => {
    const result = await withEnv(
      {
        OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
        OPCHAIN_TEST_OP_ITEM_JSON: "{",
      },
      async () =>
        readOpItemJson(
          "token-from-test",
          "item-123",
          "item lookup failed",
          "item payload invalid",
        ),
    );

    expect(result).toEqual({
      error: "item payload invalid",
      ok: false,
      reason: "parse",
    });
  });
});
