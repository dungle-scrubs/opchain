import { describe, expect, test } from "bun:test";

import type { Config } from "../../src/config/load-config.ts";
import {
  classifyOpCommand,
  resolveConfiguredAccount,
  resolveOpProfile,
} from "../../src/cli/profile.ts";

/**
 * Creates one typed config fixture for profile-resolution tests.
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
      default: {
        defaultMode: "default",
        profiles: {
          default: { keychainAccount: "opchain:default:default" },
        },
        vaults: ["Human"],
      },
      explicit: {
        defaultMode: "default",
        profiles: {
          admin: { keychainAccount: "opchain:explicit:admin" },
          auditor: { keychainAccount: "opchain:explicit:auditor" },
        },
        vaults: ["Audit"],
      },
    },
  };
}

describe("classifyOpCommand", () => {
  test("classifies the read-safe vault list command", () => {
    expect(classifyOpCommand(["vault", "list"])).toBe("read_safe");
  });

  test("rejects unsupported command shapes", () => {
    expect(classifyOpCommand(["item", "list"])).toBeNull();
  });
});

describe("resolveOpProfile", () => {
  test("resolves an explicit profile override", () => {
    expect(
      resolveOpProfile(
        createConfig(),
        "explicit",
        "read_safe",
        undefined,
        "auditor",
      ),
    ).toEqual({
      accountName: "opchain:explicit:auditor",
      profileName: "auditor",
    });
  });

  test("resolves an access override", () => {
    expect(
      resolveOpProfile(createConfig(), "auto", "read_safe", "write", undefined),
    ).toEqual({
      accountName: "opchain:auto:write",
      profileName: "write",
    });
  });

  test("resolves the single configured profile automatically", () => {
    expect(
      resolveOpProfile(
        createConfig(),
        "default",
        "read_safe",
        undefined,
        undefined,
      ),
    ).toEqual({
      accountName: "opchain:default:default",
      profileName: "default",
    });
  });

  test("resolves the auto-mode read profile for read-safe commands", () => {
    expect(
      resolveOpProfile(
        createConfig(),
        "auto",
        "read_safe",
        undefined,
        undefined,
      ),
    ).toEqual({
      accountName: "opchain:auto:read",
      profileName: "read",
    });
  });

  test("fails when an identity requires explicit profile selection", () => {
    expect(
      resolveOpProfile(
        createConfig(),
        "explicit",
        "read_safe",
        undefined,
        undefined,
      ),
    ).toBe(
      "Identity explicit requires explicit profile selection, which is not implemented yet.",
    );
  });

  test("fails when the target identity does not exist", () => {
    expect(
      resolveOpProfile(
        createConfig(),
        "missing",
        "read_safe",
        undefined,
        undefined,
      ),
    ).toBe("Unknown identity: missing.");
  });

  test("fails when the explicit profile does not exist", () => {
    expect(
      resolveOpProfile(
        createConfig(),
        "explicit",
        "read_safe",
        undefined,
        "missing",
      ),
    ).toBe("Identity explicit does not define profile missing.");
  });

  test("fails when the access override profile does not exist", () => {
    expect(
      resolveOpProfile(
        createConfig(),
        "default",
        "read_safe",
        "write",
        undefined,
      ),
    ).toBe("Identity default does not define a write profile.");
  });
});

describe("resolveConfiguredAccount", () => {
  test("resolves a configured keychain account", () => {
    expect(
      resolveConfiguredAccount(createConfig(), "explicit", "admin"),
    ).toEqual({
      accountName: "opchain:explicit:admin",
    });
  });

  test("fails for unknown identities and profiles", () => {
    expect(resolveConfiguredAccount(createConfig(), "missing", "admin")).toBe(
      "Unknown identity: missing.",
    );
    expect(
      resolveConfiguredAccount(createConfig(), "explicit", "missing"),
    ).toBe("Unknown profile for explicit: missing.");
  });
});
