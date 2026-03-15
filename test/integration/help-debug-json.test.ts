import { describe, expect, test } from "bun:test";

import { runCli } from "../helpers/run-cli.ts";

interface TelemetryEvent {
  readonly attributes: Record<string, unknown>;
  readonly duration_ms: number;
  readonly name: string;
  readonly parent_span_id: string | null;
  readonly span_id: string;
  readonly status: string;
  readonly timestamp: string;
  readonly trace_id: string;
}

/**
 * Parses newline-delimited JSON telemetry from stderr.
 *
 * @param stderr - Raw stderr text emitted by the CLI.
 * @returns Parsed telemetry events.
 */
function parseEvents(stderr: string): readonly TelemetryEvent[] {
  return stderr
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TelemetryEvent);
}

describe("CLI help debug JSON", () => {
  test("prints help and emits redacted JSON telemetry", () => {
    const result = runCli(["--debug", "--debug-format", "json", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stderr).not.toContain("SHOULD_NOT_LEAK");

    const events = parseEvents(result.stderr);
    const firstEvent = events[0];

    expect(firstEvent).toBeDefined();
    expect(firstEvent).toHaveProperty("timestamp");
    expect(firstEvent).toHaveProperty("trace_id");
    expect(firstEvent).toHaveProperty("span_id");
    expect(firstEvent).toHaveProperty("parent_span_id");
    expect(firstEvent).toHaveProperty("name");
    expect(firstEvent).toHaveProperty("status");
    expect(firstEvent).toHaveProperty("duration_ms");
    expect(firstEvent).toHaveProperty("attributes");
  });
});
