import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ExpiryStateError,
  loadExpiryState,
  parseExpiryState,
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

  test("rejects invalid version and identity fields", () => {
    expect(() =>
      parseExpiryState({
        identity: "human",
        trackedItems: [],
        version: 2,
      }),
    ).toThrow(ExpiryStateError);

    expect(() =>
      parseExpiryState({
        identity: 42,
        trackedItems: [],
        version: 1,
      }),
    ).toThrow("Invalid expiry state: identity must be a non-empty string.");
  });

  test("rejects identity names that could traverse the state directory", () => {
    for (const unsafe of ["../../pwn", "a/b", "a.json", "."]) {
      expect(() =>
        parseExpiryState({
          identity: unsafe,
          trackedItems: [],
          version: 1,
        }),
      ).toThrow(
        "Invalid expiry state: identity must contain only letters, numbers, underscores, and hyphens.",
      );
    }
  });

  test("rejects invalid tracked item canonical fields", () => {
    expect(() =>
      parseExpiryState({
        identity: "human",
        trackedItems: [
          {
            itemTitle: "OpenAI",
            itemUuid: "",
            vaultTitle: "Services",
            vaultUuid: "vault-uuid-1",
          },
        ],
        version: 1,
      }),
    ).toThrow(
      "Invalid expiry state: trackedItems[0].itemUuid must be a non-empty string.",
    );
  });

  test("validates optional status and timestamp fields", () => {
    expect(() =>
      parseExpiryState({
        identity: "human",
        trackedItems: [
          {
            itemTitle: "OpenAI",
            itemUuid: "item-uuid-1",
            status: "stale",
            vaultTitle: "Services",
            vaultUuid: "vault-uuid-1",
          },
        ],
        version: 1,
      }),
    ).toThrow("Invalid expiry state: trackedItems[0].status is invalid.");

    expect(() =>
      parseExpiryState({
        identity: "human",
        trackedItems: [
          {
            expiresAt: 123,
            itemTitle: "OpenAI",
            itemUuid: "item-uuid-1",
            vaultTitle: "Services",
            vaultUuid: "vault-uuid-1",
          },
        ],
        version: 1,
      }),
    ).toThrow(
      "Invalid expiry state: trackedItems[0].expiresAt must be a string when present.",
    );
  });
});
