import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAutoReadConfig } from "../helpers/write-opchain-config.ts";

interface TelemetryEvent {
  readonly name: string;
}

function parseEvents(stderr: string): readonly TelemetryEvent[] {
  return stderr
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TelemetryEvent);
}

describe("token set debug json", () => {
  test("emits token.set telemetry without leaking the token value", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    writeAutoReadConfig(homePath);

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "--debug",
        "--debug-format",
        "json",
        "token",
        "set",
        "--identity",
        "primary",
        "--profile",
        "read",
        "--stdin",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_SECURITY_PATH: join(
            process.cwd(),
            "test/fixtures/bin/security",
          ),
        },
        input: "secret-debug-token\n",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Stored token for primary.read.\n");
    expect(result.stderr).not.toContain("secret-debug-token");

    const events = parseEvents(result.stderr);
    const eventNames = events.map((event) => event.name);
    expect(eventNames).toContain("token.set");
    // The last event should be token.set (after config.load and identity.resolve)
    expect(eventNames[eventNames.length - 1]).toBe("token.set");
  });
});
