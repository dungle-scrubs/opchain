import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";

describe("auto read-profile op execution", () => {
  test("resolves the read profile for an allowlisted read-safe command", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const securityLogPath = join(homePath, "helper-get.log");
    const opLogPath = join(homePath, "op.log");

    writeAutoReadWriteConfig(homePath);

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "primary", "op", "vault", "list"],
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
          OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-read",
          OPCHAIN_TEST_OP_LOG: opLogPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("vault list ok\n");
    expect(result.stderr).toBe("");
    expect(readFileSync(securityLogPath, "utf8")).toBe(
      `${["service=opchain", "account=opchain:primary:read"].join("\n")}
`,
    );
    expect(readFileSync(opLogPath, "utf8")).toBe(
      `${["args=vault list", "token=token-for-primary-read"].join("\n")}
`,
    );
  });
});
