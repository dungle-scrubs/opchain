import { describe, expect, test } from "bun:test";

import { parseFlagArguments } from "../../src/cli/flag-args.ts";

describe("parseFlagArguments", () => {
  test("extracts recognized flags while preserving remaining token order", () => {
    const result = parseFlagArguments(
      ["--debug", "doctor", "--unknown", "value", "--debug-format", "json"],
      {
        booleanFlags: new Set(["--debug"]),
        valueFlags: new Set(["--debug-format"]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect([...result.booleanFlags]).toEqual(["--debug"]);
    expect([...result.valueFlags.entries()]).toEqual([
      ["--debug-format", "json"],
    ]);
    expect(result.unknownOptions).toEqual(["--unknown"]);
    expect(result.positionals).toEqual(["doctor", "value"]);
    expect(result.unparsedTokens).toEqual(["doctor", "--unknown", "value"]);
  });

  test("rejects missing values for recognized value flags", () => {
    const result = parseFlagArguments(["--profile"], {
      booleanFlags: new Set<string>(),
      valueFlags: new Set(["--profile"]),
    });

    expect(result).toEqual({
      error: {
        flag: "--profile",
        message: "Missing value for --profile.",
      },
      ok: false,
    });
  });

  test("rejects value flags followed by another option", () => {
    const result = parseFlagArguments(["--identity", "--profile", "read"], {
      booleanFlags: new Set<string>(),
      valueFlags: new Set(["--identity", "--profile"]),
    });

    expect(result).toEqual({
      error: {
        flag: "--identity",
        message: "Missing value for --identity.",
      },
      ok: false,
    });
  });
});
