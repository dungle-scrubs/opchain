import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("expires remove path traversal", () => {
  test("rejects unconfigured path-like identities before state writes", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    writeHumanConfig(homePath);

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "../../pwn", "expires", "remove", "vault/item"],
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
    expect(result.stderr).toBe("Unknown identity: ../../pwn.\n");
    expect(existsSync(join(homePath, ".config", "opchain", "pwn.json"))).toBe(
      false,
    );
  });
});
