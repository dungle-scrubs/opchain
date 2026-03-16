import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadConfig } from "../helpers/write-opchain-config.ts";

describe("token set --stdin", () => {
  test("stores a token through the helper backend without argv token input", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const helperWriteLogPath = join(homePath, "helper-write.log");

    writeAutoReadConfig(homePath);

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "token",
        "set",
        "--identity",
        "kevin",
        "--profile",
        "read",
        "--stdin",
      ],
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
          OPCHAIN_TEST_HELPER_WRITE_LOG: helperWriteLogPath,
        },
        input: "token-from-stdin\n",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Stored token for kevin.read.\n");
    expect(result.stdout).not.toContain("token-from-stdin");
    expect(result.stderr).toBe("");
    expect(readFileSync(helperWriteLogPath, "utf8")).toBe(
      `${[
        "service=opchain",
        "account=opchain:kevin:read",
        "token=token-from-stdin",
      ].join("\n")}
`,
    );
  });
});
