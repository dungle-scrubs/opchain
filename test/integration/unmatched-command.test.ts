import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("unmatched command", () => {
  test("explains an op-execution flag rejected by a non-op command", () => {
    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "primary", "--read", "item-structure", "x"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: mkdtempSync(join(tmpdir(), "opchain-home-")),
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(
      result.stderr.startsWith(
        "--read applies only to op commands: opchain <identity> --read op <args...>\nUsage: opchain",
      ),
    ).toBe(true);
  });

  test("prints a generic reason for other unmatched commands", () => {
    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "primary", "bogus"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: mkdtempSync(join(tmpdir(), "opchain-home-")),
        },
      },
    );

    expect(result.status).toBe(1);
    expect(
      result.stderr.startsWith(
        "No command matches these arguments.\nUsage: opchain",
      ),
    ).toBe(true);
  });
});
