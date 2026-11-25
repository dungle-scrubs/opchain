import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readOpItemJson } from "../../src/op/item-json.ts";
import type { ChildFailureClass } from "../../src/op/relay.ts";
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

  test("passes an optional vault filter before the end-of-options separator", async () => {
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
          "Services",
        ),
    );

    expect(result.ok).toBe(true);
    expect(readFileSync(logPath, "utf8")).toContain(
      "args=item get --format json --vault Services -- item-123",
    );
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
      opError: "unreachable",
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

  test("classifies op's failure without copying its text", async () => {
    const cases: readonly (readonly [string, ChildFailureClass])[] = [
      [
        '[ERROR] 2026/11/25 10:00:00 "Nope" isn\'t an item in the "Services" vault. Specify the item with its UUID, name, or domain.',
        "notfound",
      ],
      [
        '[ERROR] 2026/11/25 10:00:00 "Nope" isn\'t a vault in this account. Specify the vault with its ID or name.',
        "denied",
      ],
      [
        "[ERROR] 2026/11/25 10:00:00 dial tcp: lookup my.1password.com: no such host",
        "unreachable",
      ],
      ["[ERROR] 2026/11/25 10:00:00 something else went wrong", "unknown"],
    ];
    for (const [stderr, opError] of cases) {
      const result = await withEnv(
        {
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_OP_ITEM_STDERR: stderr,
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
        opError,
        reason: "exec",
      });
    }
  });

  test("the fake op refuses a whole secret reference, as the real op does", async () => {
    const result = await withEnv(
      { OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op") },
      async () =>
        readOpItemJson(
          "token-from-test",
          "op://Services/OpenAI/api-key",
          "item lookup failed",
          "item payload invalid",
        ),
    );

    expect(result.ok).toBe(false);
  });

  test("reads a spawn timeout as unreachable and another spawn error as unknown", async () => {
    const timedOut = await withEnv(
      {
        OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
        OPCHAIN_OP_TIMEOUT_MS: "100",
        OPCHAIN_TEST_OP_SLEEP_MS: "3000",
      },
      async () =>
        readOpItemJson("t", "item-123", "item lookup failed", "invalid"),
    );
    expect(timedOut).toEqual({
      error: "item lookup failed",
      ok: false,
      opError: "unreachable",
      reason: "exec",
    });

    const missing = await withEnv(
      { OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/no-such-op") },
      async () =>
        readOpItemJson("t", "item-123", "item lookup failed", "invalid"),
    );
    expect(missing).toEqual({
      error: "item lookup failed",
      ok: false,
      opError: "unknown",
      reason: "exec",
    });
  });
});
