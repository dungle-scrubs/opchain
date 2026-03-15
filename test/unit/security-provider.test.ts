import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getTokenFromSecurity } from "../../src/token/security-provider.ts";

describe("getTokenFromSecurity", () => {
  test("resolves a token through the security fallback backend", async () => {
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "token-from-security";

    const result = await getTokenFromSecurity({
      accountName: "opchain-v2:kevin:read",
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain-v2",
    });

    delete process.env.OPCHAIN_TEST_SECURITY_TOKEN;

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value).toBe("token-from-security");
  });
});
