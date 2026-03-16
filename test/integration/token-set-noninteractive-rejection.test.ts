import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadConfig } from "../helpers/write-opchain-config.ts";

describe("token set non-interactive rejection", () => {
  test("requires --stdin or an interactive TTY", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    writeAutoReadConfig(homePath);

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "token",
        "set",
        "--identity",
        "kevin",
        "--profile",
        "read",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "token set requires --stdin or an interactive TTY.\n",
    );
  });
});
