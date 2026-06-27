import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("op allow-env-token", () => {
  test("uses OPCHAIN_TOKEN_OVERRIDE when --allow-env-token is passed", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const securityLogPath = join(homePath, "helper-get-override.log");
    const opLogPath = join(homePath, "op-override.log");

    writeHumanConfig(homePath);

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "human",
        "--allow-env-token",
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
          OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
          OPCHAIN_TOKEN_OVERRIDE: "token-from-env-override",
          OPCHAIN_TEST_OP_LOG: opLogPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("vault list ok\n");
    expect(result.stderr).toBe("");
    expect(existsSync(securityLogPath)).toBe(false);
    expect(readFileSync(opLogPath, "utf8")).toBe(
      `${["args=vault list", "token=token-from-env-override"].join("\n")}
`,
    );
  });
});
