import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("expires list invalid state", () => {
  test("fails cleanly when the expiry state file is malformed", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const stateDirectoryPath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
    );
    const statePath = join(stateDirectoryPath, "human.json");

    mkdirSync(stateDirectoryPath, { recursive: true });
    writeFileSync(statePath, "{\n", "utf8");

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "expires", "list"],
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
    expect(result.stderr).toContain("Failed to load expiry state:");
    expect(result.stderr).not.toContain("at runExpiresList");
  });
});
