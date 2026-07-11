import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";

describe("auto-mode write guard", () => {
  test("refuses a non-read-safe op command without explicit profile selection", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const securityLogPath = join(homePath, "helper-get.log");
    const opLogPath = join(homePath, "op.log");

    writeAutoReadWriteConfig(homePath);

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "primary",
        "op",
        "item",
        "edit",
        "Stripe",
        "--vault",
        "Services",
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
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-primary-write",
          OPCHAIN_TEST_OP_LOG: opLogPath,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Explicit profile selection is required.");
    // The child `op` process must never be spawned, so its log must not exist.
    expect(existsSync(opLogPath)).toBe(false);
    // No token may be resolved, so the security helper must never be invoked.
    expect(existsSync(securityLogPath)).toBe(false);
  });
});
