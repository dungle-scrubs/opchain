import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";

describe("auto read-profile op execution", () => {
  test("resolves the read profile for an allowlisted read-safe command", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const helperGetLogPath = join(homePath, "helper-get.log");
    const opLogPath = join(homePath, "op.log");

    writeAutoReadWriteConfig(homePath);

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "kevin", "op", "vault", "list"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_HELPER_PATH: join(
            process.cwd(),
            "test/fixtures/bin/opchain-helper",
          ),
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_HELPER_GET_LOG: helperGetLogPath,
          OPCHAIN_TEST_HELPER_TOKEN: "token-for-kevin-read",
          OPCHAIN_TEST_OP_LOG: opLogPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("vault list ok\n");
    expect(result.stderr).toBe("");
    expect(readFileSync(helperGetLogPath, "utf8")).toBe(
      `${["service=opchain-v2", "account=opchain-v2:kevin:read"].join("\n")}
`,
    );
    expect(readFileSync(opLogPath, "utf8")).toBe(
      `${["args=vault list", "token=token-for-kevin-read"].join("\n")}
`,
    );
  });
});
