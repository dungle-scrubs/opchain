import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveIdentityContext,
  resolveReadIdentityContext,
  resolveTokenForAccount,
} from "../../src/cli/token-context.ts";
import { createCliOptions } from "../helpers/create-cli-options.ts";
import { captureStderr } from "../helpers/capture-stderr.ts";
import { withEnv } from "../helpers/with-env.ts";
import { writeHomeConfig } from "../helpers/write-opchain-config.ts";

function parseEvents(stderr: string): readonly { readonly name: string }[] {
  return stderr
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { readonly name: string });
}

describe("resolveTokenForAccount", () => {
  test("resolves a security-backed token and emits provider telemetry", async () => {
    const { result, stderr } = await withEnv(
      {
        OPCHAIN_SECURITY_PATH: join(
          process.cwd(),
          "test/fixtures/bin/security",
        ),
        OPCHAIN_TEST_SECURITY_TOKEN: "token-from-security",
      },
      async () =>
        captureStderr(async () =>
          resolveTokenForAccount(
            createCliOptions({ debug: true, debugFormat: "json" }),
            "opchain:auto:read",
            false,
          ),
        ),
    );

    expect(result).toEqual({ ok: true, value: "token-from-security" });
    expect(parseEvents(stderr).map((event) => event.name)).toEqual([
      "token.provider.attempt",
      "token.provider.success",
    ]);
  });

  test("returns a printable aggregate error when security fails", async () => {
    const result = await withEnv(
      {
        OPCHAIN_SECURITY_PATH: join(
          process.cwd(),
          "test/fixtures/bin/security",
        ),
        OPCHAIN_TEST_SECURITY_EXIT_CODE: "17",
        OPCHAIN_TEST_SECURITY_STDERR: "security leaked token",
      },
      async () =>
        resolveTokenForAccount(createCliOptions(), "opchain:auto:read", false),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected token resolution to fail.");
    }

    expect(result.error).toBe(
      "Token resolution failed. security provider failed with exit code 17.",
    );
  });
});

describe("identity context helpers", () => {
  test("resolves the read identity context with config, profile, and token", async () => {
    const configPath = writeHomeConfig(
      mkdtempSync(join(tmpdir(), "opchain-home-")),
      {
        identities: {
          auto: {
            defaultMode: "auto",
            profiles: {
              read: "opchain:auto:read",
              write: "opchain:auto:write",
            },
            vaults: ["Services"],
          },
          explicit: {
            defaultMode: "default",
            profiles: {
              admin: "opchain:explicit:admin",
              auditor: "opchain:explicit:auditor",
            },
            vaults: ["Audit"],
          },
        },
      },
    );

    const result = await withEnv(
      {
        OPCHAIN_CONFIG_PATH: configPath,
        OPCHAIN_SECURITY_PATH: join(
          process.cwd(),
          "test/fixtures/bin/security",
        ),
        OPCHAIN_TEST_SECURITY_TOKEN: "token-from-security",
      },
      async () => resolveReadIdentityContext(createCliOptions(), "auto"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.value.configPath).toBe(configPath);
    expect(result.value.resolvedProfile).toEqual({
      accountName: "opchain:auto:read",
      profileName: "read",
    });
    expect(result.value.token).toBe("token-from-security");
  });

  test("returns profile resolution errors without attempting token lookup", async () => {
    const configPath = writeHomeConfig(
      mkdtempSync(join(tmpdir(), "opchain-home-")),
      {
        identities: {
          auto: {
            defaultMode: "auto",
            profiles: {
              read: "opchain:auto:read",
              write: "opchain:auto:write",
            },
            vaults: ["Services"],
          },
          explicit: {
            defaultMode: "default",
            profiles: {
              admin: "opchain:explicit:admin",
              auditor: "opchain:explicit:auditor",
            },
            vaults: ["Audit"],
          },
        },
      },
    );

    const result = await withEnv(
      {
        OPCHAIN_CONFIG_PATH: configPath,
        OPCHAIN_SECURITY_PATH: join(
          process.cwd(),
          "test/fixtures/bin/security",
        ),
      },
      async () =>
        resolveIdentityContext(createCliOptions(), {
          accessOverride: undefined,
          allowEnvToken: false,
          classification: "read_safe",
          explicitProfile: undefined,
          identityName: "explicit",
        }),
    );

    expect(result).toEqual({
      error:
        "Identity explicit requires explicit profile selection, which is not implemented yet.",
      ok: false,
    });
  });
});
