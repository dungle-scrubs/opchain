import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

describe("expires scan debug json", () => {
  test("emits scan and threshold telemetry without leaking secrets", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const statePath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
      "human.json",
    );
    const expiresAt = new Date(
      Date.now() + 3 * 24 * 60 * 60 * 1000,
    ).toISOString();

    mkdirSync(join(homePath, ".config", "opchain", "state", "expires"), {
      recursive: true,
    });
    writeHumanConfig(homePath);
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          identity: "human",
          trackedItems: [
            {
              itemTitle: "OpenAI",
              itemUuid: "item-uuid-1",
              vaultTitle: "Services",
              vaultUuid: "vault-uuid-1",
            },
          ],
          version: 1,
        },
        null,
        2,
      )}
`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "--debug",
        "--debug-format",
        "json",
        "human",
        "expires",
        "scan",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_HELPER_PATH: join(
            process.cwd(),
            "test/fixtures/bin/opchain-helper",
          ),
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_HELPER_TOKEN: "token-for-human-default",
          OPCHAIN_TEST_OP_ITEM_JSON: JSON.stringify({
            expires_at: expiresAt,
            fields: [
              { label: "api-key", value: "super-secret-value" },
              { label: "region", value: "us-east-1" },
            ],
            id: "item-uuid-1",
            reference: "op://Services/OpenAI/api-key",
            title: "OpenAI",
            vault: { id: "vault-uuid-1", name: "Services" },
          }),
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("expiring vault-uuid-1/item-uuid-1");
    expect(result.stderr).not.toContain("super-secret-value");
    expect(result.stderr).not.toContain("token-for-human-default");
    expect(parseEvents(result.stderr).map((event) => event.name)).toEqual([
      "cli.start",
      "config.load",
      "identity.resolve",
      "token.provider.attempt",
      "token.provider.success",
      "expires.threshold.evaluate",
      "expires.scan.item",
    ]);
  });
});
