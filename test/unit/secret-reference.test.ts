import { describe, expect, test } from "bun:test";

import { parseSecretReference } from "../../src/op/secret-reference.ts";

describe("parseSecretReference", () => {
  test("splits vault, item and field", () => {
    expect(parseSecretReference("op://Services/OpenAI/api-key")).toEqual({
      field: "api-key",
      item: "OpenAI",
      section: undefined,
      vault: "Services",
    });
  });

  test("splits a section when the reference has four segments", () => {
    expect(
      parseSecretReference("op://Services/OpenAI/Details/api-key"),
    ).toEqual({
      field: "api-key",
      item: "OpenAI",
      section: "Details",
      vault: "Services",
    });
  });

  test("drops a query such as ?attribute=otp from the field", () => {
    expect(
      parseSecretReference(
        "op://Services/GitHub/one-time password?attribute=otp",
      ),
    ).toEqual({
      field: "one-time password",
      item: "GitHub",
      section: undefined,
      vault: "Services",
    });
  });

  test("rejects references that are not op:// with three or four segments", () => {
    for (const reference of [
      "",
      "Services/OpenAI/api-key",
      "op://Services/OpenAI",
      "op://Services/OpenAI/a/b/c",
      "op://Services//api-key",
      "op:///OpenAI/api-key",
      "op://Services/OpenAI/",
      "op://Services/OpenAI/?attribute=otp",
    ]) {
      expect(parseSecretReference(reference)).toBeUndefined();
    }
  });
});
