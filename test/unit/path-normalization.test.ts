import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import { expandHomePath } from "../../src/config/path-normalization.ts";
import { resolveExpiryStatePath } from "../../src/cli/paths.ts";

describe("expandHomePath", () => {
  test("expands tilde paths and leaves absolute and relative paths deliberate", () => {
    expect(expandHomePath("~/dev", "/Users/tester")).toBe("/Users/tester/dev");
    expect(expandHomePath("~", "/Users/tester")).toBe("/Users/tester");
    expect(expandHomePath("/opt/projects", "/Users/tester")).toBe(
      "/opt/projects",
    );
    expect(expandHomePath("relative/projects", "/Users/tester")).toBe(
      "relative/projects",
    );
  });
});

describe("resolveExpiryStatePath", () => {
  test("returns the per-identity state path for a valid identity name", () => {
    expect(resolveExpiryStatePath("human")).toBe(
      join(homedir(), ".config", "opchain", "state", "expires", "human.json"),
    );
  });

  test("throws for traversal and otherwise unsafe identity names", () => {
    for (const unsafe of ["../../pwn", "a/b", "a.json", "", "."]) {
      expect(() => resolveExpiryStatePath(unsafe)).toThrow(
        "must contain only letters, numbers, underscores, and hyphens.",
      );
    }
  });
});
