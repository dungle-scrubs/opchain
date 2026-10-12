import { describe, expect, test } from "bun:test";

import { planRunEnv } from "../../src/op/run-env.ts";

describe("planRunEnv", () => {
  test("strips the token from the run program environment", () => {
    expect(planRunEnv(["run", "--", "node", "app.js"])).toEqual({
      kind: "strip",
      args: [
        "run",
        "--",
        "/usr/bin/env",
        "-u",
        "OP_SERVICE_ACCOUNT_TOKEN",
        "OP_BIOMETRIC_UNLOCK_ENABLED=false",
        "node",
        "app.js",
      ],
    });
  });
  test("inserts after only the first separator, preserving flags and program arguments", () => {
    expect(
      planRunEnv([
        "run",
        "--env-file",
        ".env.op",
        "--",
        "pnpm",
        "dev",
        "--",
        "--port",
        "3000",
      ]),
    ).toEqual({
      kind: "strip",
      args: [
        "run",
        "--env-file",
        ".env.op",
        "--",
        "/usr/bin/env",
        "-u",
        "OP_SERVICE_ACCOUNT_TOKEN",
        "OP_BIOMETRIC_UNLOCK_ENABLED=false",
        "pnpm",
        "dev",
        "--",
        "--port",
        "3000",
      ],
    });
  });
  test("recognizes run after global op flags", () => {
    expect(planRunEnv(["--account", "acme", "run", "--", "true"])).toEqual({
      kind: "strip",
      args: [
        "--account",
        "acme",
        "run",
        "--",
        "/usr/bin/env",
        "-u",
        "OP_SERVICE_ACCOUNT_TOKEN",
        "OP_BIOMETRIC_UNLOCK_ENABLED=false",
        "true",
      ],
    });
  });
  test("requires a separator before the program", () => {
    expect(planRunEnv(["run", "printenv"])).toEqual({ kind: "no-separator" });
  });
  test("does not insert env without a program", () => {
    expect(planRunEnv(["run", "--"])).toEqual({ kind: "no-program" });
  });
  test("leaves vault list alone", () => {
    expect(planRunEnv(["vault", "list"])).toEqual({ kind: "not-run" });
  });
  test("leaves read alone", () => {
    expect(planRunEnv(["read", "op://V/I/f"])).toEqual({ kind: "not-run" });
  });
  test("leaves other commands with separators alone", () => {
    expect(planRunEnv(["item", "get", "X", "--", "y"])).toEqual({
      kind: "not-run",
    });
  });
});
