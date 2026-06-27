import { describe, expect, test } from "bun:test";

import type { Config } from "../../src/config/load-config.ts";
import {
  emitConfigLoadTelemetry,
  emitIdentityResolveTelemetry,
  resolveCommandName,
  writeTelemetry,
} from "../../src/cli/telemetry.ts";
import { createCliOptions } from "../helpers/create-cli-options.ts";
import { captureStderr } from "../helpers/capture-stderr.ts";
import { createTelemetryEvent } from "../../src/telemetry/event.ts";

/**
 * Creates one typed config fixture for telemetry tests.
 *
 * @returns {Config} Stable config fixture.
 */
function createConfig(): Config {
  return {
    defaults: {
      enforceVaultAllowlist: true,
      expiresThresholdDays: 14,
      projectsDir: "/Users/example/dev",
    },
    identities: {
      auto: {
        defaultMode: "auto",
        profiles: {
          read: { keychainAccount: "opchain:auto:read" },
          write: { keychainAccount: "opchain:auto:write" },
        },
        vaults: ["Services"],
      },
      human: {
        defaultMode: "default",
        profiles: {
          default: { keychainAccount: "opchain:human:default" },
        },
        vaults: ["Human"],
      },
    },
  };
}

/**
 * Parses newline-delimited JSON telemetry.
 *
 * @param stderr - Raw stderr output.
 * @returns {readonly { readonly attributes: Record<string, unknown>; readonly name: string }[]} Parsed telemetry events.
 */
function parseEvents(stderr: string): readonly {
  readonly attributes: Record<string, unknown>;
  readonly name: string;
}[] {
  return stderr
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map(
      (line) =>
        JSON.parse(line) as {
          readonly attributes: Record<string, unknown>;
          readonly name: string;
        },
    );
}

describe("resolveCommandName", () => {
  test("returns help when help mode is enabled", () => {
    expect(resolveCommandName(createCliOptions({ help: true }))).toBe("help");
  });

  test("returns unknown when no command args are present", () => {
    expect(resolveCommandName(createCliOptions())).toBe("unknown");
  });

  test("returns the first two command tokens otherwise", () => {
    expect(
      resolveCommandName(
        createCliOptions({ commandArgs: ["human", "secrets", "validate"] }),
      ),
    ).toBe("human secrets");
  });
});

describe("writeTelemetry", () => {
  test("does nothing when debug mode is disabled", async () => {
    const { stderr } = await captureStderr(async () =>
      writeTelemetry(
        createCliOptions(),
        createTelemetryEvent("test.event", { answer: 42 }),
      ),
    );

    expect(stderr).toBe("");
  });

  test("renders text telemetry when debug format is text", async () => {
    const { stderr } = await captureStderr(async () =>
      writeTelemetry(
        createCliOptions({ debug: true, debugFormat: "text" }),
        createTelemetryEvent("test.event", { answer: 42 }),
      ),
    );

    expect(stderr).toContain("test.event");
    expect(stderr).toContain("ok");
    expect(stderr).not.toContain('"answer":42');
  });

  test("renders JSON telemetry when debug format is json", async () => {
    const { stderr } = await captureStderr(async () =>
      writeTelemetry(
        createCliOptions({ debug: true, debugFormat: "json" }),
        createTelemetryEvent("test.event", { answer: 42 }),
      ),
    );

    expect(parseEvents(stderr)).toHaveLength(1);
    expect(parseEvents(stderr)[0]).toMatchObject({
      attributes: { answer: 42 },
      name: "test.event",
    });
  });
});

describe("config and identity telemetry", () => {
  test("emits redacted config and identity summary events", async () => {
    const { stderr } = await captureStderr(async () => {
      emitConfigLoadTelemetry(
        createCliOptions({ debug: true, debugFormat: "json" }),
        createConfig(),
        "/tmp/config.toml",
      );
      emitIdentityResolveTelemetry(
        createCliOptions({ debug: true, debugFormat: "json" }),
        createConfig(),
      );
    });

    const events = parseEvents(stderr);

    expect(events.map((event) => event.name)).toEqual([
      "config.load",
      "identity.resolve",
    ]);
    expect(events[0]).toMatchObject({
      attributes: {
        config_path: "/tmp/config.toml",
        identity_count: 2,
        profile_count: 3,
      },
      name: "config.load",
    });
    expect(events[1]).toMatchObject({
      attributes: {
        identities: ["auto", "human"],
        identity_count: 2,
      },
      name: "identity.resolve",
    });
    expect(stderr).not.toContain("opchain:auto:read");
    expect(stderr).not.toContain("opchain:human:default");
  });
});
