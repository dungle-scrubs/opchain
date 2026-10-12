import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadWriteConfig } from "../helpers/write-opchain-config.ts";

const PRINT_TOKEN = `printf "%s" "\${OP_SERVICE_ACCOUNT_TOKEN:-absent}"`;

function runOpchainOp(argv: readonly string[]) {
  const homePath = mkdtempSync(join(tmpdir(), "opchain-run-token-"));
  writeAutoReadWriteConfig(homePath);
  const opLogPath = join(homePath, "op.log");
  const securityLogPath = join(homePath, "security.log");
  const result = spawnSync(process.execPath, ["run", "src/index.ts", ...argv], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homePath,
      OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
      OPCHAIN_SECURITY_PATH: join(process.cwd(), "test/fixtures/bin/security"),
      OPCHAIN_TEST_SECURITY_TOKEN: "fake-token-123",
      OPCHAIN_TEST_OP_LOG: opLogPath,
      OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
      OPCHAIN_TEST_OP_RUN_EXEC: "1",
    },
  });
  return { result, opLogPath, securityLogPath };
}

describe("op run token environment", () => {
  test("op gets the token but its program does not", () => {
    const { result, opLogPath } = runOpchainOp([
      "primary",
      "--read",
      "op",
      "run",
      "--",
      "sh",
      "-c",
      PRINT_TOKEN,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("absent");
    expect(result.stderr).toBe("");
    expect(readFileSync(opLogPath, "utf8")).toBe(
      `args=run -- /usr/bin/env -u OP_SERVICE_ACCOUNT_TOKEN sh -c ${PRINT_TOKEN}\ntoken=fake-token-123\n`,
    );
  });
  test("passes the token with --pass-token before the identity without a TTY", () => {
    const { result, opLogPath } = runOpchainOp([
      "--pass-token",
      "--read",
      "primary",
      "op",
      "run",
      "--",
      "sh",
      "-c",
      PRINT_TOKEN,
    ]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("fake-token-123");
    expect(readFileSync(opLogPath, "utf8")).toBe(
      `args=run -- sh -c ${PRINT_TOKEN}\ntoken=fake-token-123\n`,
    );
  });
  test("refuses run without a separator before resolving a token", () => {
    const { result, opLogPath, securityLogPath } = runOpchainOp([
      "primary",
      "--read",
      "op",
      "run",
      "printenv",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "op run needs `--` before the program so opchain can keep the service-account token out of its environment: opchain <identity> op run [flags] -- <program>. Pass --pass-token before `op` if the program calls op itself.\n",
    );
    expect(existsSync(opLogPath)).toBe(false);
    expect(existsSync(securityLogPath)).toBe(false);
  });

  test("refuses --pass-token for a non-run command before token resolution", () => {
    const { result, opLogPath, securityLogPath } = runOpchainOp([
      "primary",
      "--read",
      "--pass-token",
      "op",
      "vault",
      "list",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("--pass-token applies only to op run.\n");
    expect(existsSync(opLogPath)).toBe(false);
    expect(existsSync(securityLogPath)).toBe(false);
  });

  test("records the opt-in without recording the token", () => {
    const { result } = runOpchainOp([
      "--debug",
      "--debug-format",
      "json",
      "primary",
      "--read",
      "--pass-token",
      "op",
      "run",
      "--",
      "true",
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('"name":"op.run.token_passed"');
    expect(result.stderr).not.toContain("fake-token-123");
  });

  test("passes token between identity and op", () => {
    const { result, opLogPath } = runOpchainOp([
      "primary",
      "--pass-token",
      "--read",
      "op",
      "run",
      "--",
      "sh",
      "-c",
      PRINT_TOKEN,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("fake-token-123");
    expect(readFileSync(opLogPath, "utf8")).toBe(
      `args=run -- sh -c ${PRINT_TOKEN}\ntoken=fake-token-123\n`,
    );
  });

  test("strips token with global op flags", () => {
    const { result } = runOpchainOp([
      "primary",
      "--read",
      "op",
      "--account",
      "acme",
      "run",
      "--",
      "sh",
      "-c",
      PRINT_TOKEN,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("absent");
  });

  test("propagates the program exit status", () => {
    const { result } = runOpchainOp([
      "primary",
      "--read",
      "op",
      "run",
      "--",
      "sh",
      "-c",
      "exit 7",
    ]);
    expect(result.status).toBe(7);
  });

  test("leaves a missing program for op to report", () => {
    const { result, opLogPath } = runOpchainOp([
      "primary",
      "--read",
      "op",
      "run",
      "--",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("fake op run: missing command\n");
    expect(readFileSync(opLogPath, "utf8")).toBe(
      "args=run --\ntoken=fake-token-123\n",
    );
  });

  test("passes run without a separator unchanged on opt-in", () => {
    const { result, opLogPath } = runOpchainOp([
      "primary",
      "--read",
      "--pass-token",
      "op",
      "run",
      "printenv",
    ]);
    expect(result.status).toBe(2);
    expect(readFileSync(opLogPath, "utf8")).toBe(
      "args=run printenv\ntoken=fake-token-123\n",
    );
  });
});
