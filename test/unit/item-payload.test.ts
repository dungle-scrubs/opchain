import { describe, expect, test } from "bun:test";

import {
  parseExpiryTrackedItem,
  parseSecretInspectMetadata,
} from "../../src/commands/item-payload.ts";

describe("parseSecretInspectMetadata", () => {
  test("extracts sanitized secret metadata", () => {
    const result = parseSecretInspectMetadata({
      expires_at: "2026-12-31T00:00:00Z",
      fields: [
        { label: "api-key", value: "super-secret-value" },
        { label: "region", value: "us-east-1" },
      ],
      reference: "op://Services/OpenAI/api-key",
      title: "OpenAI",
      vault: { id: "vault-uuid-1", name: "Services" },
    });

    expect(result).toEqual({
      expiresAt: "2026-12-31T00:00:00Z",
      fieldLabels: ["api-key", "region"],
      itemTitle: "OpenAI",
      reference: "op://Services/OpenAI/api-key",
      vaultName: "Services",
    });
  });

  test("fails when the fields payload is malformed", () => {
    const result = parseSecretInspectMetadata({
      fields: { label: "api-key" },
      reference: "op://Services/OpenAI/api-key",
      title: "OpenAI",
      vault: { id: "vault-uuid-1", name: "Services" },
    });

    expect(result).toBe("Invalid secret inspection payload.");
  });
});

describe("parseExpiryTrackedItem", () => {
  test("extracts canonical expiry tracking fields", () => {
    const result = parseExpiryTrackedItem({
      expires_at: "2026-12-31T00:00:00Z",
      id: "item-uuid-1",
      title: "OpenAI",
      vault: { id: "vault-uuid-1", name: "Services" },
    });

    expect(result).toEqual({
      expiresAt: "2026-12-31T00:00:00Z",
      itemTitle: "OpenAI",
      itemUuid: "item-uuid-1",
      vaultTitle: "Services",
      vaultUuid: "vault-uuid-1",
    });
  });

  test("fails when required canonical fields are missing", () => {
    const result = parseExpiryTrackedItem({
      id: 123,
      title: "OpenAI",
      vault: { id: "vault-uuid-1", name: "Services" },
    });

    expect(result).toBe("Invalid expiry tracking payload.");
  });
});
