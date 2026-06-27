import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("single-profile op execution", () => {
  test("runs an allowlisted read-safe op command for a single-profile identity", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const securityLogPath = join(homePath, "helper-get.log");
    const opLogPath = join(homePath, "op.log");

    writeHumanConfig(homePath);

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "op", "vault", "list"],
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
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
          OPCHAIN_TEST_OP_LOG: opLogPath,
          OPCHAIN_TEST_OP_LOG_ENV: "1",
          OPCHAIN_TOKEN_OVERRIDE: "ambient-token-should-not-leak",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("vault list ok\n");
    expect(result.stdout).not.toContain("token-for-human-default");
    expect(result.stderr).toBe("");
    expect(readFileSync(securityLogPath, "utf8")).toBe(
      `${["service=opchain", "account=opchain:human:default"].join("\n")}
`,
    );
    expect(readFileSync(opLogPath, "utf8")).toBe(
      `${["args=vault list", "token=token-for-human-default", "override="].join(
        "\n",
      )}
`,
    );
  });

  test("fails when delegated op command times out", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));

    writeHumanConfig(homePath);

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "op", "vault", "list"],
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
          OPCHAIN_OP_TIMEOUT_MS: "50",
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
          OPCHAIN_TEST_OP_SLEEP_MS: "200",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "1Password CLI command timed out after 50ms",
    );
  });
});
