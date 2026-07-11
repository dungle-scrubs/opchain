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

  test("extracts op-specific overrides in documented identity-first order", () => {
    const result = parseCliOptions([
      "human",
      "--profile",
      "writer",
      "--write",
      "--allow-env-token",
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

  test("forwards root-name flags appearing after the op marker to the child", () => {
    const result = parseCliOptions([
      "human",
      "op",
      "read",
      "--debug",
      "secret",
    ]);

    expect(result).toEqual({
      accessOverride: undefined,
      allowEnvToken: false,
      commandArgs: ["human", "op", "read", "--debug", "secret"],
      debug: false,
      debugFormat: "text",
      explicitProfile: undefined,
      help: false,
    });
  });

  test("does not treat --help after the op marker as opchain help", () => {
    const result = parseCliOptions(["human", "op", "item", "get", "--help"]);

    expect(result).toEqual({
      accessOverride: undefined,
      allowEnvToken: false,
      commandArgs: ["human", "op", "item", "get", "--help"],
      debug: false,
      debugFormat: "text",
      explicitProfile: undefined,
      help: false,
    });
  });

  test("forwards --debug-format and its value after the op marker", () => {
    const result = parseCliOptions([
      "human",
      "op",
      "read",
      "--debug-format",
      "json",
      "secret",
    ]);

    expect(result).toEqual({
      accessOverride: undefined,
      allowEnvToken: false,
      commandArgs: ["human", "op", "read", "--debug-format", "json", "secret"],
      debug: false,
      debugFormat: "text",
      explicitProfile: undefined,
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

  test("does not extract op-specific flags from malformed identity envelopes", () => {
    const result = parseCliOptions([
      "human",
      "unexpected",
      "--write",
      "op",
      "vault",
      "list",
    ]);

    expect(result).toEqual({
      accessOverride: undefined,
      allowEnvToken: false,
      commandArgs: ["human", "unexpected", "--write", "op", "vault", "list"],
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

  test("rejects conflicting read and write overrides", () => {
    const result = parseCliOptions([
      "human",
      "--read",
      "--write",
      "op",
      "vault",
      "list",
    ]);

    expect(result).toEqual({
      accessOverride: undefined,
      allowEnvToken: false,
      commandArgs: ["human", "op", "vault", "list"],
      debug: false,
      debugFormat: "text",
      explicitProfile: undefined,
      help: false,
      parseError: "Cannot pass both --read and --write.",
    });
  });

  test("rejects missing debug format values", () => {
    const result = parseCliOptions(["--debug-format"]);

    expect(result.parseError).toBe("Missing value for --debug-format.");
    expect(result.commandArgs).toEqual([]);
  });

  test("rejects missing op profile values without consuming the op marker", () => {
    const result = parseCliOptions([
      "human",
      "--profile",
      "op",
      "vault",
      "list",
    ]);

    expect(result).toEqual({
      accessOverride: undefined,
      allowEnvToken: false,
      commandArgs: ["human", "op", "vault", "list"],
      debug: false,
      debugFormat: "text",
      explicitProfile: undefined,
      help: false,
      parseError: "Missing value for --profile.",
    });
  });
});
