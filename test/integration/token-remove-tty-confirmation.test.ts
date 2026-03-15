import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadConfig } from "../helpers/write-opchain-config.ts";

describe("token remove TTY confirmation", () => {
  test("removes a token after interactive confirmation", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const helperRemoveLogPath = join(homePath, "helper-remove-tty.log");

    writeAutoReadConfig(homePath);

    const expectScript = [
      "log_user 1",
      "set timeout 5",
      "spawn $env(BUN_BIN) run src/index.ts token remove --identity kevin --profile read",
      "expect -exact {Remove token for kevin.read? [y/N] }",
      'send -- "y\\r"',
      "expect -exact {Removed token for kevin.read.}",
      "expect eof",
      "catch wait result",
      "exit [lindex $result 3]",
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
        OPCHAIN_TEST_HELPER_REMOVE_LOG: helperRemoveLogPath,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Remove token for kevin.read? [y/N] ");
    expect(result.stdout).toContain("Removed token for kevin.read.");
    expect(readFileSync(helperRemoveLogPath, "utf8")).toBe(
      `${["service=opchain-v2", "account=opchain-v2:kevin:read"].join("\n")}
`,
    );
  });

  test("cancels removal when confirmation is declined", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const helperRemoveLogPath = join(homePath, "helper-remove-cancel.log");

    writeAutoReadConfig(homePath);

    const expectScript = [
      "log_user 1",
      "set timeout 5",
      "spawn $env(BUN_BIN) run src/index.ts token remove --identity kevin --profile read",
      "expect -exact {Remove token for kevin.read? [y/N] }",
      'send -- "n\\r"',
      "expect -exact {Token removal cancelled.}",
      "expect eof",
      "catch wait result",
      "exit [lindex $result 3]",
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
        OPCHAIN_TEST_HELPER_REMOVE_LOG: helperRemoveLogPath,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Remove token for kevin.read? [y/N] ");
    expect(result.stdout).toContain("Token removal cancelled.");
    expect(existsSync(helperRemoveLogPath)).toBe(false);
  });
});
