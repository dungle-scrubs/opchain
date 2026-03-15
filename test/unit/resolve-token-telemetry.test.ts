import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveToken } from "../../src/token/resolve-token.ts";
import type { TelemetryEvent } from "../../src/telemetry/event.ts";

describe("resolveToken telemetry", () => {
  test("emits redacted provider attempt, failure, and success events", async () => {
    const events: TelemetryEvent[] = [];
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "token-from-security";

    const result = await resolveToken({
      accountName: "opchain-v2:kevin:read",
      allowEnvToken: false,
      emitEvent: (event) => {
        events.push(event);
      },
      helperPath: join(process.cwd(), "test/fixtures/bin/does-not-exist"),
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain-v2",
    });

    delete process.env.OPCHAIN_TEST_SECURITY_TOKEN;

    expect(result.ok).toBe(true);
    expect(events.map((event) => event.name)).toEqual([
      "token.provider.attempt",
      "token.provider.failure",
      "token.provider.attempt",
      "token.provider.success",
    ]);
    expect(JSON.stringify(events)).not.toContain("token-from-security");
    expect(JSON.stringify(events)).not.toContain("OPCHAIN_TEST_SECURITY_TOKEN");
  });
});
