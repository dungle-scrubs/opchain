import { describe, expect, test } from "bun:test";

import { parseTokenRemoveOptions } from "../../src/commands/token-remove.ts";
import { parseTokenSetOptions } from "../../src/commands/token-set.ts";

describe("token command option parsing", () => {
  test("rejects missing token set identity values", () => {
    expect(
      parseTokenSetOptions(["--identity", "--profile", "read", "--stdin"]),
    ).toBe("Missing value for --identity.");
  });

  test("rejects missing token set profile values", () => {
    expect(parseTokenSetOptions(["--identity", "kevin", "--profile"])).toBe(
      "Missing value for --profile.",
    );
  });

  test("rejects missing token remove identity values", () => {
    expect(
      parseTokenRemoveOptions(["--identity", "--profile", "read", "--yes"]),
    ).toBe("Missing value for --identity.");
  });

  test("rejects missing token remove profile values", () => {
    expect(parseTokenRemoveOptions(["--identity", "kevin", "--profile"])).toBe(
      "Missing value for --profile.",
    );
  });
});
