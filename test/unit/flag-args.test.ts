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

    expect([...result.booleanFlags]).toEqual(["--debug"]);
    expect([...result.valueFlags.entries()]).toEqual([["--debug-format", "json"]]);
    expect(result.unknownOptions).toEqual(["--unknown"]);
    expect(result.positionals).toEqual(["doctor", "value"]);
    expect(result.unparsedTokens).toEqual(["doctor", "--unknown", "value"]);
  });

  test("accepts missing values for recognized value flags without crashing", () => {
    const result = parseFlagArguments(["--profile"], {
      booleanFlags: new Set<string>(),
      valueFlags: new Set(["--profile"]),
    });

    expect([...result.valueFlags.entries()]).toEqual([["--profile", undefined]]);
    expect(result.positionals).toEqual([]);
    expect(result.unknownOptions).toEqual([]);
    expect(result.unparsedTokens).toEqual([]);
  });
});
