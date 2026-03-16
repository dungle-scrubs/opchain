import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExpiryState } from "../../src/expires/state.ts";
import {
  formatRuntimeError,
  isExecutableAvailable,
  loadExpiryStateResult,
  parseJsonText,
  readTextFile,
  saveExpiryStateResult,
} from "../../src/cli/io.ts";
import { withEnv } from "../helpers/with-env.ts";

describe("formatRuntimeError", () => {
  test("formats Error instances with their message", () => {
    expect(formatRuntimeError("Failed", new Error("boom"))).toBe(
      "Failed: boom",
    );
  });

  test("formats unknown values without leaking internals", () => {
    expect(formatRuntimeError("Failed", "boom")).toBe("Failed.");
  });
});

describe("isExecutableAvailable", () => {
  test("detects absolute executable paths", () => {
    expect(
      isExecutableAvailable(
        join(process.cwd(), "test/fixtures/bin/opchain-helper"),
      ),
    ).toBe(true);
    expect(isExecutableAvailable("/definitely/missing/executable")).toBe(false);
  });

  test("detects executables available through PATH", async () => {
    const result = await withEnv({}, async () => isExecutableAvailable("bun"));

    expect(result).toBe(true);
  });
});

describe("parseJsonText", () => {
  test("parses valid JSON payloads", () => {
    const result = parseJsonText('{"ok":true}', "invalid payload");

    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  test("returns a stable error for malformed JSON", () => {
    const result = parseJsonText("{", "invalid payload");

    expect(result).toEqual({ error: "invalid payload", ok: false });
  });
});

describe("readTextFile", () => {
  test("reads UTF-8 text files", () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-io-"));
    const filePath = join(directoryPath, "example.txt");

    writeFileSync(filePath, "hello\n", "utf8");

    expect(readTextFile(filePath, "Failed to read file")).toEqual({
      ok: true,
      value: "hello\n",
    });
  });

  test("returns a stable error for missing files", () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-io-"));
    const filePath = join(directoryPath, "missing.txt");
    const result = readTextFile(filePath, "Failed to read file");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected missing-file read to fail.");
    }

    expect(result.error).toContain("Failed to read file:");
  });
});

describe("expiry state IO wrappers", () => {
  test("saves and loads expiry state successfully", () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-io-"));
    const statePath = join(directoryPath, "human.json");
    const state: ExpiryState = {
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
    };

    expect(saveExpiryStateResult(statePath, state)).toBeNull();
    expect(loadExpiryStateResult(statePath, "human")).toEqual({
      ok: true,
      value: state,
    });
  });

  test("returns a stable error when the expiry state file is malformed", () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-io-"));
    const statePath = join(directoryPath, "human.json");

    writeFileSync(statePath, "{\n", "utf8");

    const result = loadExpiryStateResult(statePath, "human");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected malformed-state load to fail.");
    }

    expect(result.error).toContain("Failed to load expiry state:");
  });

  test("returns an empty state when the file does not exist yet", () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-io-"));
    const statePath = join(directoryPath, "human.json");

    expect(loadExpiryStateResult(statePath, "human")).toEqual({
      ok: true,
      value: {
        identity: "human",
        trackedItems: [],
        version: 1,
      },
    });
  });
});
