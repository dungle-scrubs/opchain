import { describe, expect, test } from "bun:test";

import { parseCliOptions } from "../../src/cli/options.ts";

describe("parseCliOptions", () => {
  test("defaults to help text when no argv is provided", () => {
    const result = parseCliOptions([]);

    expect(result).toEqual({
      accessOverride: undefined,
      allowEnvToken: false,
      commandArgs: [],
      debug: false,
      debugFormat: "text",
      explicitProfile: undefined,
      help: true,
    });
  });

  test("parses debug flags and strips them from command args", () => {
    const result = parseCliOptions([
      "--debug",
      "--debug-format",
      "json",
      "identity",
      "list",
    ]);

    expect(result).toEqual({
      accessOverride: undefined,
      allowEnvToken: false,
      commandArgs: ["identity", "list"],
      debug: true,
      debugFormat: "json",
      explicitProfile: undefined,
      help: false,
    });
  });

  test("extracts op-specific overrides only before the op token", () => {
    const result = parseCliOptions([
      "--profile",
      "writer",
      "--write",
      "--allow-env-token",
      "human",
      "op",
      "vault",
      "list",
    ]);

    expect(result).toEqual({
      accessOverride: "write",
      allowEnvToken: true,
      commandArgs: ["human", "op", "vault", "list"],
      debug: false,
      debugFormat: "text",
      explicitProfile: "writer",
      help: false,
    });
  });

  test("does not strip profile flags for non-op commands", () => {
    const result = parseCliOptions(["token", "set", "--profile", "writer"]);

    expect(result).toEqual({
      accessOverride: undefined,
      allowEnvToken: false,
      commandArgs: ["token", "set", "--profile", "writer"],
      debug: false,
      debugFormat: "text",
      explicitProfile: undefined,
      help: false,
    });
  });

  test("falls back to text debug format for invalid input", () => {
    const result = parseCliOptions(["--debug-format", "invalid", "doctor"]);

    expect(result.debugFormat).toBe("text");
    expect(result.commandArgs).toEqual(["doctor"]);
  });
});
