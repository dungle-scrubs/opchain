import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadExpiryState,
  saveExpiryState,
  type ExpiryState,
} from "../../src/expires/state.ts";

describe("expiry state", () => {
  test("persists one canonical tracked item with atomic writes", () => {
    const directoryPath = mkdtempSync(join(tmpdir(), "opchain-expires-"));
    const statePath = join(directoryPath, "human.json");
    const state: ExpiryState = {
      identity: "human",
      trackedItems: [
        {
          itemUuid: "item-uuid-1",
          itemTitle: "OpenAI",
          vaultTitle: "Services",
          vaultUuid: "vault-uuid-1",
        },
      ],
      version: 1,
    };

    saveExpiryState(statePath, state);
    const loadedState = loadExpiryState(statePath);

    expect(loadedState).toEqual(state);
  });
});
