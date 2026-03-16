import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanAndKevinConfig } from "../helpers/write-opchain-config.ts";

interface TelemetryEvent {
  readonly name: string;
}

/**
 * Parses newline-delimited JSON telemetry.
 *
 * @param stderr - Raw stderr output from the CLI.
 * @returns {readonly TelemetryEvent[]} Parsed telemetry events.
 */
function parseEvents(stderr: string): readonly TelemetryEvent[] {
  return stderr
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TelemetryEvent);
}

describe("identity list debug json", () => {
  test("emits redacted config and identity events", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    writeHumanAndKevinConfig(homePath);

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "--debug",
        "--debug-format",
        "json",
        "identity",
        "list",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          SHOULD_NOT_LEAK: "SHOULD_NOT_LEAK",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("kevin\nhuman\n");
    expect(result.stderr).not.toContain("SHOULD_NOT_LEAK");
    expect(result.stderr).not.toContain("opchain:kevin:read");
    expect(result.stderr).not.toContain("Personal");

    const events = parseEvents(result.stderr);
    expect(events.map((event) => event.name)).toEqual([
      "cli.start",
      "config.load",
      "identity.resolve",
    ]);
  });
});
