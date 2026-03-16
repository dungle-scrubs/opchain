import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getTokenFromHelper } from "../../src/token/helper-provider.ts";

describe("getTokenFromHelper", () => {
  test("resolves a token through the helper backend", async () => {
    process.env.OPCHAIN_TEST_HELPER_TOKEN = "token-from-helper";

    const result = await getTokenFromHelper({
      accountName: "opchain:kevin:read",
      helperPath: join(process.cwd(), "test/fixtures/bin/opchain-helper"),
      serviceName: "opchain",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value).toBe("token-from-helper");
  });
});
