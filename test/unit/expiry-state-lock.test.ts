import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ExpiryStateLockError,
  saveExpiryState,
  type ExpiryState,
} from "../../src/expires/state.ts";

describe("expiry state lock", () => {
  test("fails fast when the state file is already locked", () => {
    const directoryPath = join(tmpdir(), `opchain-expires-lock-${Date.now()}`);
    const statePath = join(directoryPath, "human.json");
    const lockPath = join(directoryPath, "human.json.lock");
    const state: ExpiryState = {
      identity: "human",
      trackedItems: [],
      version: 1,
    };

    mkdirSync(directoryPath, { recursive: true });
    writeFileSync(lockPath, "locked\n", "utf8");

    expect(() => saveExpiryState(statePath, state)).toThrow(
      ExpiryStateLockError,
    );
  });
});
