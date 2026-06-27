import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadConfig } from "../helpers/write-opchain-config.ts";

describe("token remove --yes", () => {
  test("removes a token through the helper backend", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const securityRemoveLogPath = join(homePath, "helper-remove.log");

    writeAutoReadConfig(homePath);

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "token",
        "remove",
        "--identity",
        "primary",
        "--profile",
        "read",
        "--yes",
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
          OPCHAIN_TEST_SECURITY_REMOVE_LOG: securityRemoveLogPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Removed token for primary.read.\n");
    expect(result.stderr).toBe("");
    expect(readFileSync(securityRemoveLogPath, "utf8")).toBe(
      `${["service=opchain", "account=opchain:primary:read"].join("\n")}
`,
    );
  });
});
