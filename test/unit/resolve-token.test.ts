import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveToken } from "../../src/token/resolve-token.ts";

describe("resolveToken", () => {
  test("uses the explicit env override only when allowEnvToken is enabled", async () => {
    process.env.OPCHAIN_TOKEN_OVERRIDE = "token-from-env";
    process.env.OPCHAIN_TEST_HELPER_TOKEN = "token-from-helper";
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "token-from-security";

    const result = await resolveToken({
      accountName: "opchain:kevin:read",
      allowEnvToken: true,
      helperPath: join(process.cwd(), "test/fixtures/bin/opchain-helper"),
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    delete process.env.OPCHAIN_TOKEN_OVERRIDE;
    delete process.env.OPCHAIN_TEST_HELPER_TOKEN;
    delete process.env.OPCHAIN_TEST_SECURITY_TOKEN;

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value).toBe("token-from-env");
  });

  test("ignores the env override when allowEnvToken is disabled", async () => {
    process.env.OPCHAIN_TOKEN_OVERRIDE = "token-from-env";
    process.env.OPCHAIN_TEST_HELPER_TOKEN = "token-from-helper";

    const result = await resolveToken({
      accountName: "opchain:kevin:read",
      allowEnvToken: false,
      helperPath: join(process.cwd(), "test/fixtures/bin/opchain-helper"),
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    delete process.env.OPCHAIN_TOKEN_OVERRIDE;
    delete process.env.OPCHAIN_TEST_HELPER_TOKEN;

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value).toBe("token-from-helper");
  });

  test("prefers the helper backend before the security fallback", async () => {
    process.env.OPCHAIN_TEST_HELPER_TOKEN = "token-from-helper";
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "token-from-security";

    const result = await resolveToken({
      accountName: "opchain:kevin:read",
      allowEnvToken: false,
      helperPath: join(process.cwd(), "test/fixtures/bin/opchain-helper"),
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    delete process.env.OPCHAIN_TEST_HELPER_TOKEN;
    delete process.env.OPCHAIN_TEST_SECURITY_TOKEN;

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value).toBe("token-from-helper");
  });

  test("falls back to security when the helper backend is unavailable", async () => {
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "token-from-security";

    const result = await resolveToken({
      accountName: "opchain:kevin:read",
      allowEnvToken: false,
      helperPath: join(process.cwd(), "test/fixtures/bin/does-not-exist"),
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

  test("returns a precise redacted error when helper and security both fail", async () => {
    process.env.OPCHAIN_TEST_HELPER_EXIT_CODE = "17";
    process.env.OPCHAIN_TEST_HELPER_STDERR = "helper leaked token-from-helper";
    process.env.OPCHAIN_TEST_SECURITY_EXIT_CODE = "44";
    process.env.OPCHAIN_TEST_SECURITY_STDERR =
      "security leaked token-from-security";

    const result = await resolveToken({
      accountName: "opchain:kevin:read",
      allowEnvToken: false,
      helperPath: join(process.cwd(), "test/fixtures/bin/opchain-helper"),
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    delete process.env.OPCHAIN_TEST_HELPER_EXIT_CODE;
    delete process.env.OPCHAIN_TEST_HELPER_STDERR;
    delete process.env.OPCHAIN_TEST_SECURITY_EXIT_CODE;
    delete process.env.OPCHAIN_TEST_SECURITY_STDERR;

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected provider resolution to fail.");
    }

    expect(result.error.message).toBe(
      "Token resolution failed. helper provider failed with exit code 17. security provider failed with exit code 44.",
    );
    expect(result.error.message).not.toContain("token-from-helper");
    expect(result.error.message).not.toContain("token-from-security");
  });
});
