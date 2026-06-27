import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getTokenFromSecurity } from "../../src/token/security-provider.ts";

describe("getTokenFromSecurity", () => {
  afterEach(() => {
    delete process.env.OPCHAIN_PROVIDER_TIMEOUT_MS;
    delete process.env.OPCHAIN_TEST_SECURITY_SLEEP_MS;
    delete process.env.OPCHAIN_TEST_SECURITY_TOKEN;
  });

  test("resolves a token through the security fallback backend", async () => {
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "token-from-security";

    const result = await getTokenFromSecurity({
      accountName: "opchain:primary:read",
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

  test("fails with a redacted timeout when the security backend hangs", async () => {
    process.env.OPCHAIN_PROVIDER_TIMEOUT_MS = "50";
    process.env.OPCHAIN_TEST_SECURITY_SLEEP_MS = "120";
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "token-after-sleep";

    const result = await getTokenFromSecurity({
      accountName: "opchain:primary:read",
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected security timeout failure");
    }

    expect(result.error.message).toBe("security provider timed out.");
    expect(result.error.message).not.toContain("token-after-sleep");
  });
});
