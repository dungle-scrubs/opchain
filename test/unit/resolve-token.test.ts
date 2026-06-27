import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveToken } from "../../src/token/resolve-token.ts";

describe("resolveToken", () => {
  test("uses the explicit env override only when allowEnvToken is enabled", async () => {
    process.env.OPCHAIN_TOKEN_OVERRIDE = "token-from-env";
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "token-from-security";

    const result = await resolveToken({
      accountName: "opchain:primary:read",
      allowEnvToken: true,
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    delete process.env.OPCHAIN_TOKEN_OVERRIDE;
    delete process.env.OPCHAIN_TEST_SECURITY_TOKEN;

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value).toBe("token-from-env");
  });

  test("ignores the env override when allowEnvToken is disabled", async () => {
    process.env.OPCHAIN_TOKEN_OVERRIDE = "token-from-env";
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "token-from-security";

    const result = await resolveToken({
      accountName: "opchain:primary:read",
      allowEnvToken: false,
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    delete process.env.OPCHAIN_TOKEN_OVERRIDE;
    delete process.env.OPCHAIN_TEST_SECURITY_TOKEN;

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value).toBe("token-from-security");
  });

  test("resolves a token from the security backend", async () => {
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "token-from-security";

    const result = await resolveToken({
      accountName: "opchain:primary:read",
      allowEnvToken: false,
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    delete process.env.OPCHAIN_TEST_SECURITY_TOKEN;

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value).toBe("token-from-security");
  });

  test("returns a redacted error when security fails", async () => {
    process.env.OPCHAIN_TEST_SECURITY_EXIT_CODE = "17";
    process.env.OPCHAIN_TEST_SECURITY_STDERR =
      "security leaked token-from-security";

    const result = await resolveToken({
      accountName: "opchain:primary:read",
      allowEnvToken: false,
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    delete process.env.OPCHAIN_TEST_SECURITY_EXIT_CODE;
    delete process.env.OPCHAIN_TEST_SECURITY_STDERR;

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected provider resolution to fail.");
    }

    expect(result.error.message).toBe(
      "Token resolution failed. security provider failed with exit code 17.",
    );
    expect(result.error.message).not.toContain("token-from-security");
  });
});
