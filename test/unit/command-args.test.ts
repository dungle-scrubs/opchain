import { describe, expect, test } from "bun:test";

import {
  parseCommandPath,
  parseIdentityCommandPath,
} from "../../src/cli/command-args.ts";

describe("parseIdentityCommandPath", () => {
  test("extracts the identity and trailing args for one matched subcommand path", () => {
    const result = parseIdentityCommandPath(
      ["human", "secrets", "inspect", "op://Services/OpenAI/api-key"],
      ["secrets", "inspect"],
    );

    expect(result).toEqual({
      identityName: "human",
      ok: true,
      trailingArgs: ["op://Services/OpenAI/api-key"],
    });
  });

  test("fails cleanly when the identity is missing", () => {
    const result = parseIdentityCommandPath([], ["expires", "scan"]);

    expect(result).toEqual({
      error: "Missing identity before expires command.",
      ok: false,
    });
  });

  test("fails cleanly when the expected command path is missing", () => {
    const result = parseIdentityCommandPath(["human", "unexpected"], ["op"]);

    expect(result).toEqual({
      error: "Invalid command shape for op.",
      ok: false,
    });
  });
});

describe("parseCommandPath", () => {
  test("extracts trailing args for top-level commands", () => {
    const result = parseCommandPath(
      ["token", "set", "--identity", "human"],
      ["token", "set"],
    );

    expect(result).toEqual({
      ok: true,
      trailingArgs: ["--identity", "human"],
    });
  });

  test("fails cleanly when the expected top-level path is missing", () => {
    const result = parseCommandPath(["doctor"], ["token", "remove"]);

    expect(result).toEqual({
      error: "Invalid command shape for token remove.",
      ok: false,
    });
  });
});
