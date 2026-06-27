import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanAndPrimaryConfig } from "../helpers/write-opchain-config.ts";
import { spawnSync } from "node:child_process";

describe("identity list", () => {
  test("prints configured identities from config.toml", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    writeHumanAndPrimaryConfig(homePath);

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "identity", "list"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("primary\nhuman\n");
    expect(result.stderr).toBe("");
  });
});
