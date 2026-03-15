import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfigContext } from "../../src/cli/config-context.ts";
import { createCliOptions } from "../helpers/create-cli-options.ts";
import { captureStderr } from "../helpers/capture-stderr.ts";
import { withEnv } from "../helpers/with-env.ts";
import { writeHomeConfig } from "../helpers/write-opchain-config.ts";

/**
 * Parses newline-delimited JSON telemetry.
 *
 * @param stderr - Raw stderr output.
 * @returns {readonly { readonly name: string }[]} Parsed event names.
 */
function parseEvents(stderr: string): readonly { readonly name: string }[] {
  return stderr
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { readonly name: string });
}

describe("loadConfigContext", () => {
  test("loads config through the explicit config path override and emits telemetry", async () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const configPath = writeHomeConfig(homePath, {
      identities: {
        human: {
          defaultMode: "default",
          profiles: { default: "opchain-v2:human:default" },
          vaults: ["Human"],
        },
      },
    });

    const { result, stderr } = await withEnv(
      { OPCHAIN_CONFIG_PATH: configPath },
      async () =>
        captureStderr(async () =>
          loadConfigContext(
            createCliOptions({
              debug: true,
              debugFormat: "json",
            }),
          ),
        ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.value.configPath).toBe(configPath);
    expect(Object.keys(result.value.config.identities)).toEqual(["human"]);
    expect(parseEvents(stderr).map((event) => event.name)).toEqual([
      "config.load",
      "identity.resolve",
    ]);
    expect(stderr).not.toContain("opchain-v2:human:default");
  });

  test("returns a printable error when the config file is missing", async () => {
    const configPath = join(
      mkdtempSync(join(tmpdir(), "opchain-v2-config-")),
      "missing.toml",
    );

    const result = await withEnv({ OPCHAIN_CONFIG_PATH: configPath }, async () =>
      loadConfigContext(createCliOptions()),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected config loading to fail.");
    }

    expect(result.error).toContain("no such file or directory");
  });
});
