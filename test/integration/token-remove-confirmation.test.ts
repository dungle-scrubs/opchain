import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

describe("token remove confirmation", () => {
  test("requires --yes or an interactive TTY", () => {
    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "token",
        "remove",
        "--identity",
        "kevin",
        "--profile",
        "read",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "token remove requires --yes or an interactive TTY.\n",
    );
  });
});
