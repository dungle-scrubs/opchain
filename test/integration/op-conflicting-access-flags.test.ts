import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";

describe("op conflicting access flags", () => {
  test("fails closed when --read and --write are both passed", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    writeAutoReadWriteConfig(homePath);

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "primary",
        "--read",
        "--write",
        "op",
        "vault",
        "list",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_SECURITY_PATH: join(
            process.cwd(),
            "test/fixtures/bin/security",
          ),
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-write",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Cannot pass both --read and --write.\n");
  });
});
