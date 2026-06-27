import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

describe("token set argv rejection", () => {
  test("rejects token values passed through argv", () => {
    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "token",
        "set",
        "--identity",
        "primary",
        "--profile",
        "read",
        "token-from-argv",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "token set does not accept token values through argv.\n",
    );
    expect(result.stderr).not.toContain("token-from-argv");
  });
});
