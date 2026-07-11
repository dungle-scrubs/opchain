import { describe, expect, test } from "bun:test";

import { buildTokenChildEnv } from "../../src/cli/child-env.ts";

describe("buildTokenChildEnv", () => {
  test("injects the resolved service-account token and removes ambient token overrides", () => {
    const env = buildTokenChildEnv("resolved-profile-token", {
      HOME: "/tmp/opchain-home",
      OP_SERVICE_ACCOUNT_TOKEN: "ambient-service-token",
      OPCHAIN_TEST_SECURITY_TOKEN: "provider-fixture-token",
      OPCHAIN_TEST_OP_LOG: "/tmp/op-log",
      OPCHAIN_TOKEN_OVERRIDE: "ambient-override-token",
      PATH: "/usr/bin:/bin",
      TMPDIR: "/tmp",
    });

    expect(env.OP_SERVICE_ACCOUNT_TOKEN).toBe("resolved-profile-token");
    expect(env.OPCHAIN_TOKEN_OVERRIDE).toBeUndefined();
    expect(env.OPCHAIN_TEST_SECURITY_TOKEN).toBeUndefined();
    expect(env.OPCHAIN_TEST_OP_LOG).toBe("/tmp/op-log");
    expect(env.HOME).toBe("/tmp/opchain-home");
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.TMPDIR).toBe("/tmp");
  });

  test("denies non-allowlisted secret vars and near-miss prefixes while passing genuine allowlisted vars", () => {
    const env = buildTokenChildEnv("resolved-profile-token", {
      AWS_SECRET_ACCESS_KEY: "aws-secret-value",
      OPCHAIN_SECRET: "near-miss-secret",
      OPCHAIN_TEST_OP_LOG: "/tmp/op-log",
      PATH: "/usr/bin:/bin",
    });

    // Representative non-allowlisted secret var is stripped.
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    // Near-miss prefix (not OPCHAIN_TEST_OP_) is stripped.
    expect(env.OPCHAIN_SECRET).toBeUndefined();
    // Genuinely allowlisted passthrough var and base var pass through.
    expect(env.OPCHAIN_TEST_OP_LOG).toBe("/tmp/op-log");
    expect(env.PATH).toBe("/usr/bin:/bin");
  });
});
