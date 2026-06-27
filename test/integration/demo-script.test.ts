import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

describe("demo script", () => {
  test("runs the fixture-backed demo successfully", () => {
    const result = spawnSync(join(process.cwd(), "scripts", "demo.sh"), [], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Fixture-backed opchain demo");
    expect(result.stdout).toContain("--- doctor");
    expect(result.stdout).toContain(
      "--- human secrets validate (directory scan)",
    );
    expect(result.stdout).toContain("ok op://Models/Anthropic/api-key");
    expect(result.stdout).toContain(
      "--- primary --write op item edit Stripe --vault Services",
    );
    expect(result.stdout).toContain("item edit ok");
  });
});
