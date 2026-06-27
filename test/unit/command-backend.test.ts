import { describe, expect, test } from "bun:test";

import { buildProviderChildEnv } from "../../src/token/command-backend.ts";

describe("buildProviderChildEnv", () => {
  test("removes ambient token-bearing variables and preserves execution basics", () => {
    const env = buildProviderChildEnv({
      HOME: "/tmp/opchain-home",
      OP_SERVICE_ACCOUNT_TOKEN: "ambient-service-token",
      OPCHAIN_TEST_SECURITY_TOKEN: "fixture-token",
      OPCHAIN_TEST_OP_LOG: "/tmp/op-log",
      OPCHAIN_TOKEN_OVERRIDE: "ambient-override-token",
      PATH: "/usr/bin:/bin",
      SHELL: "/bin/zsh",
      TMPDIR: "/tmp",
    });

    expect(env.OPCHAIN_TOKEN_OVERRIDE).toBeUndefined();
    expect(env.OP_SERVICE_ACCOUNT_TOKEN).toBeUndefined();
    expect(env.OPCHAIN_TEST_OP_LOG).toBeUndefined();
    expect(env.OPCHAIN_TEST_SECURITY_TOKEN).toBe("fixture-token");
    expect(env.HOME).toBe("/tmp/opchain-home");
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.SHELL).toBe("/bin/zsh");
    expect(env.TMPDIR).toBe("/tmp");
  });
});
