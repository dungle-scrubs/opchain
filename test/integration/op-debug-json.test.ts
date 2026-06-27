import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

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

describe("op debug json", () => {
  test("emits classification and execution telemetry without child output", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    writeHumanConfig(homePath);

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "--debug",
        "--debug-format",
        "json",
        "human",
        "op",
        "vault",
        "list",
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
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("vault list ok\n");
    expect(result.stderr).not.toContain("vault list ok");
    expect(result.stderr).not.toContain("token-for-human-default");

    const eventNames = parseEvents(result.stderr).map((event) => event.name);
    expect(eventNames).toEqual([
      "cli.start",
      "config.load",
      "identity.resolve",
      "op.command.classify",
      "token.provider.attempt",
      "token.provider.success",
      "op.exec.start",
      "op.exec.finish",
    ]);
  });
});
