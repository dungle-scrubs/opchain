import { describe, expect, test } from "bun:test";

import { expandHomePath } from "../../src/config/path-normalization.ts";

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
