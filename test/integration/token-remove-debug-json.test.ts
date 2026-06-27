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

describe("token remove debug json", () => {
  test("emits token.remove telemetry without leaking account details", () => {
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
        "remove",
        "--identity",
        "primary",
        "--profile",
        "read",
        "--yes",
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
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Removed token for primary.read.\n");
    // Account details should not leak into telemetry
    expect(result.stderr).not.toContain("opchain:primary:read");

    const events = parseEvents(result.stderr);
    const eventNames = events.map((event) => event.name);
    expect(eventNames).toContain("token.remove");
    expect(eventNames[eventNames.length - 1]).toBe("token.remove");
  });
});
