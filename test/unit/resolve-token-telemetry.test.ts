import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveToken } from "../../src/token/resolve-token.ts";
import type { TelemetryEvent } from "../../src/telemetry/event.ts";

describe("resolveToken telemetry", () => {
  afterEach(() => {
    delete process.env.OPCHAIN_PROVIDER_STDOUT_MAX_BYTES;
    delete process.env.OPCHAIN_PROVIDER_TIMEOUT_MS;
    delete process.env.OPCHAIN_TEST_SECURITY_SLEEP_MS;
    delete process.env.OPCHAIN_TEST_SECURITY_TOKEN;
  });

  test("emits redacted provider attempt and success events", async () => {
    const events: TelemetryEvent[] = [];
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "token-from-security";

    const result = await resolveToken({
      accountName: "opchain:primary:read",
      allowEnvToken: false,
      emitEvent: (event) => {
        events.push(event);
      },
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    delete process.env.OPCHAIN_TEST_SECURITY_TOKEN;

    expect(result.ok).toBe(true);
    expect(events.map((event) => event.name)).toEqual([
      "token.provider.attempt",
      "token.provider.success",
    ]);
    expect(JSON.stringify(events)).not.toContain("token-from-security");
    expect(JSON.stringify(events)).not.toContain("OPCHAIN_TEST_SECURITY_TOKEN");
  });

  test("emits redacted provider failure telemetry for timeout", async () => {
    const events: TelemetryEvent[] = [];
    process.env.OPCHAIN_PROVIDER_TIMEOUT_MS = "50";
    process.env.OPCHAIN_TEST_SECURITY_SLEEP_MS = "120";
    process.env.OPCHAIN_TEST_SECURITY_TOKEN = "secret-timeout-token";

    const result = await resolveToken({
      accountName: "opchain:primary:read",
      allowEnvToken: false,
      emitEvent: (event) => {
        events.push(event);
      },
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    expect(result.ok).toBe(false);

    const failureMessages = events
      .filter((event) => event.name === "token.provider.failure")
      .map((event) => event.attributes.error_message);

    expect(failureMessages).toContain("security provider timed out.");
    expect(JSON.stringify(events)).not.toContain("secret-timeout-token");
    expect(JSON.stringify(events)).not.toContain("OPCHAIN_TEST_SECURITY_TOKEN");
  });

  test("emits redacted provider failure telemetry for oversized output", async () => {
    const events: TelemetryEvent[] = [];
    process.env.OPCHAIN_PROVIDER_STDOUT_MAX_BYTES = "24";
    process.env.OPCHAIN_TEST_SECURITY_TOKEN =
      "secret-oversized-token-with-extra-bytes";

    const result = await resolveToken({
      accountName: "opchain:primary:read",
      allowEnvToken: false,
      emitEvent: (event) => {
        events.push(event);
      },
      securityPath: join(process.cwd(), "test/fixtures/bin/security"),
      serviceName: "opchain",
    });

    expect(result.ok).toBe(false);

    const failureMessages = events
      .filter((event) => event.name === "token.provider.failure")
      .map((event) => event.attributes.error_message);

    expect(failureMessages).toContain(
      "security provider returned too much output.",
    );
    expect(JSON.stringify(events)).not.toContain("secret-oversized-token");
    expect(JSON.stringify(events)).not.toContain("OPCHAIN_TEST_SECURITY_TOKEN");
  });
});
