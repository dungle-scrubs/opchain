import { describe, expect, test } from "bun:test";

import {
  parseExpiryTrackedItem,
  parseItemStructure,
  parseSecretInspectMetadata,
} from "../../src/commands/item-payload.ts";

describe("parseSecretInspectMetadata", () => {
  const payload = {
    expires_at: "2026-12-31T00:00:00Z",
    fields: [
      {
        id: "api-key",
        label: "api-key",
        section: { id: "add more", label: "Details" },
        value: "super-secret-value",
      },
      { id: "region", label: "region", value: "us-east-1" },
      { id: "notesPlain", value: "" },
      { id: "k3x9qz", label: "Token", value: "t" },
    ],
    files: [
      {
        id: "file-uuid-1",
        name: "key.pem",
        section: { id: "add more", label: "Details" },
      },
    ],
    title: "OpenAI",
    vault: { id: "vault-uuid-1", name: "Services" },
  };
  const reference = "op://Services/OpenAI/api-key";
  const parsed = {
    field: "api-key",
    item: "OpenAI",
    section: undefined,
    vault: "Services",
  };

  test("extracts sanitized metadata, taking the reference from the caller", () => {
    expect(parseSecretInspectMetadata(payload, reference, parsed)).toEqual({
      kind: "ok",
      metadata: {
        expiresAt: "2026-12-31T00:00:00Z",
        fieldLabels: ["api-key", "region", "", "Token"],
        itemTitle: "OpenAI",
        reference,
        vaultName: "Services",
      },
    });
  });

  test("matches a field by its label when its ID differs", () => {
    expect(
      parseSecretInspectMetadata(payload, reference, {
        ...parsed,
        field: "token",
      }).kind,
    ).toBe("ok");
  });

  test("matches a file attachment by name or ID, within its section", () => {
    for (const wanted of [
      { ...parsed, field: "key.pem" },
      { ...parsed, field: "KEY.PEM", section: "Details" },
      { ...parsed, field: "file-uuid-1", section: "add more" },
    ]) {
      expect(parseSecretInspectMetadata(payload, reference, wanted).kind).toBe(
        "ok",
      );
    }
    expect(
      parseSecretInspectMetadata(payload, reference, {
        ...parsed,
        field: "key.pem",
        section: "Other",
      }),
    ).toEqual({ kind: "field_not_found" });
  });

  test("reports a reference that matches more than one field or file", () => {
    const twoPasswords = {
      ...payload,
      fields: [
        { id: "password", label: "Login password" },
        { id: "x7k2", label: "password" },
      ],
    };
    expect(
      parseSecretInspectMetadata(twoPasswords, reference, {
        ...parsed,
        field: "password",
      }),
    ).toEqual({ kind: "ambiguous" });
    // One field matching on both its ID and its label is one match.
    expect(parseSecretInspectMetadata(payload, reference, parsed).kind).toBe(
      "ok",
    );
  });

  test("reports a field the item does not have", () => {
    for (const wanted of [
      { ...parsed, field: "missing" },
      { ...parsed, section: "Other" },
      { ...parsed, field: "region", section: "Details" },
    ]) {
      expect(parseSecretInspectMetadata(payload, reference, wanted)).toEqual({
        kind: "field_not_found",
      });
    }
  });

  test("fails when the fields payload is malformed", () => {
    for (const fields of [{ label: "api-key" }, [{ label: 7 }], ["x"]]) {
      expect(
        parseSecretInspectMetadata({ ...payload, fields }, reference, parsed),
      ).toEqual({ kind: "invalid" });
    }
    for (const files of [{ name: "key.pem" }, [{ name: 7 }], ["x"]]) {
      expect(
        parseSecretInspectMetadata({ ...payload, files }, reference, parsed),
      ).toEqual({ kind: "invalid" });
    }
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
