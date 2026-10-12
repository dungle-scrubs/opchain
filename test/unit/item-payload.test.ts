import { describe, expect, test } from "bun:test";

import {
  parseExpiryTrackedItem,
  parseItemStructure,
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

describe("parseItemStructure", () => {
  const itemPayload = {
    category: "LOGIN",
    fields: [
      { label: "username", type: "STRING", value: "alice" },
      {
        label: "password",
        type: "CONCEALED",
        value: "SENTINEL-SECRET-7f3a9c",
      },
      { label: "otp", type: "OTP", value: null },
      { label: "", type: "", value: "" },
      { type: "STRING", value: "x" },
    ],
    title: "OpenAI",
    vault: { id: "vault-uuid-1", name: "Services" },
  };

  test("extracts field structure without any value content", () => {
    const result = parseItemStructure(itemPayload);

    expect(result).toEqual({
      category: "LOGIN",
      fields: [
        { has_value: true, label: "username", type: "STRING", value_length: 5 },
        {
          has_value: true,
          label: "password",
          type: "CONCEALED",
          value_length: 22,
        },
        { has_value: false, label: "otp", type: "OTP", value_length: 0 },
        { has_value: false, label: "", type: "", value_length: 0 },
        { has_value: true, label: "", type: "STRING", value_length: 1 },
      ],
      title: "OpenAI",
      vault: "Services",
    });
  });

  test("counts unicode code points, not utf-16 units", () => {
    const result = parseItemStructure({
      category: "LOGIN",
      fields: [{ label: "note", type: "STRING", value: "a😀b" }],
      title: "T",
      vault: { id: "v", name: "V" },
    });

    expect(result).not.toBe("string");
    if (typeof result === "string") {
      throw new Error(result);
    }

    expect(result.fields[0]?.value_length).toBe(3);
  });

  test("treats a missing fields array as empty", () => {
    const result = parseItemStructure({
      category: "LOGIN",
      title: "OpenAI",
      vault: { id: "vault-uuid-1", name: "Services" },
    });

    expect(result).toEqual({
      category: "LOGIN",
      fields: [],
      title: "OpenAI",
      vault: "Services",
    });
  });

  test("rejects non-object payloads and non-object field entries", () => {
    expect(parseItemStructure(null)).toBe("Invalid item structure payload.");
    expect(parseItemStructure([])).toBe("Invalid item structure payload.");
    expect(parseItemStructure("text")).toBe("Invalid item structure payload.");

    const base = {
      category: "C",
      fields: [],
      title: "T",
      vault: { name: "V" },
    };
    expect(parseItemStructure({ ...base, fields: ["junk"] })).toBe(
      "Invalid item structure payload.",
    );
  });

  test("rejects missing title, vault name, or category", () => {
    const base = {
      fields: [],
      title: "T",
      vault: { name: "V" },
      category: "C",
    };

    expect(parseItemStructure({ ...base, title: undefined })).toBe(
      "Invalid item structure payload.",
    );
    expect(parseItemStructure({ ...base, vault: { name: 1 } })).toBe(
      "Invalid item structure payload.",
    );
    expect(parseItemStructure({ ...base, category: null })).toBe(
      "Invalid item structure payload.",
    );
    expect(parseItemStructure({ ...base, fields: "no" })).toBe(
      "Invalid item structure payload.",
    );
    expect(
      parseItemStructure({ ...base, fields: [{ label: "x", value: 42 }] }),
    ).toBe("Invalid item structure payload.");
    expect(
      parseItemStructure({
        ...base,
        fields: [{ label: "x", value: "ok" }, "junk"],
      }),
    ).toBe("Invalid item structure payload.");
  });
});
