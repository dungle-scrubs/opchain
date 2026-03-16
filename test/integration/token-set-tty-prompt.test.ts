import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadConfig } from "../helpers/write-opchain-config.ts";

describe("token set TTY prompt", () => {
  test("prompts for a hidden token on a TTY when --stdin is omitted", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const helperWriteLogPath = join(homePath, "helper-write-tty.log");

    writeAutoReadConfig(homePath);

    const expectScript = [
      "log_user 1",
      "set timeout 5",
      "spawn $env(BUN_BIN) run src/index.ts token set --identity kevin --profile read",
      'expect "Enter token for kevin.read: "',
      'send "token-from-tty\\r"',
      'expect "Stored token for kevin.read."',
      "expect eof",
    ].join("\n");

    const result = spawnSync("expect", ["-c", expectScript], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        BUN_BIN: process.execPath,
        HOME: homePath,
        OPCHAIN_HELPER_PATH: join(
          process.cwd(),
          "test/fixtures/bin/opchain-helper",
        ),
        OPCHAIN_TEST_HELPER_WRITE_LOG: helperWriteLogPath,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Enter token for kevin.read: ");
    expect(result.stdout).toContain("Stored token for kevin.read.");
    expect(result.stdout).not.toContain("token-from-tty");
    expect(readFileSync(helperWriteLogPath, "utf8")).toBe(
      `${[
        "service=opchain",
        "account=opchain:kevin:read",
        "token=token-from-tty",
      ].join("\n")}
`,
    );
  });
});
