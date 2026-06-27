import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("op missing profile value", () => {
  test("fails before config loading, token lookup, or op execution", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "kevin", "--profile", "op", "vault", "list"],
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
          OPCHAIN_TEST_SECURITY_TOKEN: "token-that-must-not-be-read",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Missing value for --profile.\n");
    expect(result.stderr).not.toContain("config");
    expect(result.stderr).not.toContain("token-that-must-not-be-read");
  });
});
