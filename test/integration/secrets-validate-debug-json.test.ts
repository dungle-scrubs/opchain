import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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

describe("secrets validate debug json", () => {
  test("emits scan and validation telemetry without leaking refs", () => {
    const repoPath = process.cwd();
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const projectPath = mkdtempSync(join(tmpdir(), "opchain-v2-project-"));
    writeHumanConfig(homePath);
    writeFileSync(
      join(projectPath, ".env.op"),
      "OPENAI_API_KEY=op://Services/OpenAI/api-key\n",
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        "run",
        join(repoPath, "src/index.ts"),
        "--debug",
        "--debug-format",
        "json",
        "human",
        "secrets",
        "validate",
      ],
      {
        cwd: projectPath,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_HELPER_PATH: join(
            repoPath,
            "test/fixtures/bin/opchain-helper",
          ),
          OPCHAIN_OP_PATH: join(repoPath, "test/fixtures/bin/op"),
          OPCHAIN_TEST_HELPER_TOKEN: "token-for-human-default",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("ok op://Services/OpenAI/api-key\n");
    expect(result.stderr).not.toContain("op://Services/OpenAI/api-key");
    expect(result.stderr).not.toContain("token-for-human-default");

    expect(parseEvents(result.stderr).map((event) => event.name)).toEqual([
      "cli.start",
      "config.load",
      "identity.resolve",
      "token.provider.attempt",
      "token.provider.success",
      "envop.scan.file",
      "envop.validate.ref",
    ]);
  });
});
