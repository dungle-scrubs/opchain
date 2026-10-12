import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runOprun(passToken?: string) {
  const tempPath = mkdtempSync(join(tmpdir(), "oprun-pass-token-"));
  const fakePath = join(tempPath, "opchain");
  const logPath = join(tempPath, "argv.log");
  writeFileSync(
    fakePath,
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$OPRUN_TEST_LOG"\nexit 0\n',
  );
  chmodSync(fakePath, 0o755);
  const env = { ...process.env };
  delete env.OPRUN_PASS_TOKEN;
  if (passToken !== undefined) env.OPRUN_PASS_TOKEN = passToken;
  const result = spawnSync(process.execPath, ["run", "src/oprun.ts", "true"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...env,
      OPCHAIN_BIN: fakePath,
      OPRUN_TEST_LOG: logPath,
      OPRUN_IDENTITY: "primary",
      OPRUN_PROFILE: "read",
      OPRUN_ENV_FILE: ".env.op",
    },
  });
  return { result, args: readFileSync(logPath, "utf8") };
}

describe("oprun token opt-in", () => {
  test("passes --pass-token when OPRUN_PASS_TOKEN is 1", () => {
    const { result, args } = runOprun("1");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(args).toBe(
      "primary --pass-token --profile read op run --env-file .env.op -- true\n",
    );
  });
  test("does not opt in when unset", () => {
    const { result, args } = runOprun();
    expect(result.status).toBe(0);
    expect(args).toBe(
      "primary --profile read op run --env-file .env.op -- true\n",
    );
  });

  test("does not opt in when zero", () => {
    const { result, args } = runOprun("0");
    expect(result.status).toBe(0);
    expect(args).toBe(
      "primary --profile read op run --env-file .env.op -- true\n",
    );
  });

  test("does not opt in for other values", () => {
    const { result, args } = runOprun("true");
    expect(result.status).toBe(0);
    expect(args).toBe(
      "primary --profile read op run --env-file .env.op -- true\n",
    );
  });

  test("help documents the token opt-in", () => {
    const result = spawnSync(
      process.execPath,
      ["run", "src/oprun.ts", "--help"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "  OPRUN_PASS_TOKEN Set to 1 for a program that calls op itself.",
    );
  });
});
