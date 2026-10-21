import { describe, expect, test } from "bun:test";

import {
  classifyChildFailure,
  RELAY_DEBUG_PREFIX,
  RELAY_FAILURE_LINE_PATTERN,
  RELAY_FAILURE_PREFIX,
  relayOutcomeIdentifier,
  relayOutcomeTelemetryLabel,
  validateRelayCommand,
} from "../../src/op/relay.ts";

function grammarInput(
  opArgs: readonly string[],
  overrides: {
    readonly allowReveal?: boolean;
    readonly hasRead?: boolean;
    readonly passToken?: boolean;
  } = {},
): Parameters<typeof validateRelayCommand>[0] {
  return {
    allowReveal: overrides.allowReveal ?? false,
    hasRead: overrides.hasRead ?? true,
    opArgs,
    passToken: overrides.passToken ?? false,
  };
}

describe("relay command grammar", () => {
  test("accepts exactly two tokens: read plus one op:// reference", () => {
    const result = validateRelayCommand(
      grammarInput(["read", "op://Infra/reflect-intake-restic/password"]),
    );

    expect(result).toEqual({
      reference: "op://Infra/reflect-intake-restic/password",
    });
  });

  test("refuses every out-file spelling in all spellings", () => {
    const refusedArgv: readonly (readonly string[])[] = [
      ["read", "-o", "out.txt", "op://V/I/f"],
      ["read", "-oout.txt", "op://V/I/f"],
      ["read", "-o=out.txt", "op://V/I/f"],
      ["read", "--out-file", "out.txt", "op://V/I/f"],
      ["read", "--out-file=out.txt", "op://V/I/f"],
      ["read", "op://V/I/f", "-o", "out.txt"],
      ["read", "op://V/I/f", "--out-file=out.txt"],
    ];

    for (const opArgs of refusedArgv) {
      expect(validateRelayCommand(grammarInput(opArgs))).toEqual({
        check: "grammar",
      });
    }
  });

  test("refuses every op global flag, any -- separator, and unknown dash tokens", () => {
    const refusedArgv: readonly (readonly string[])[] = [
      ["read", "--account", "acme", "op://V/I/f"],
      ["read", "--account=acme", "op://V/I/f"],
      ["read", "--config", "x", "op://V/I/f"],
      ["read", "--encoding", "x", "op://V/I/f"],
      ["read", "--format", "json", "op://V/I/f"],
      ["read", "--session", "x", "op://V/I/f"],
      ["read", "--cache", "op://V/I/f"],
      ["read", "--debug", "op://V/I/f"],
      ["read", "--no-color", "op://V/I/f"],
      ["read", "-v", "op://V/I/f"],
      ["read", "-h", "op://V/I/f"],
      ["read", "--iso-timestamps", "op://V/I/f"],
      ["read", "--", "op://V/I/f"],
      ["read", "op://V/I/f", "--"],
      ["read", "op://V/I/f", "--future-flag"],
      ["read", "-x", "op://V/I/f"],
      ["read", "op://V/I/f", "-"],
    ];

    for (const opArgs of refusedArgv) {
      expect(validateRelayCommand(grammarInput(opArgs))).toEqual({
        check: "grammar",
      });
    }
  });

  test("refuses zero references, multiple references, and second command words", () => {
    const refusedArgv: readonly (readonly string[])[] = [
      [],
      ["read"],
      ["read", "op://V/I/f", "op://V/J/f"],
      ["read", "op://V/I/f", "get"],
      ["read", "get", "op://V/I/f"],
      ["vault", "list"],
      ["item", "get", "SentinelItem"],
      ["inject", "-i", "t"],
    ];

    for (const opArgs of refusedArgv) {
      expect(validateRelayCommand(grammarInput(opArgs))).toEqual({
        check: "grammar",
      });
    }
  });

  test("refuses a second token that is not an op:// reference", () => {
    expect(
      validateRelayCommand(grammarInput(["read", "not-a-reference"])),
    ).toEqual({ check: "grammar" });
  });

  test("refuses --allow-reveal alongside --value-fd regardless of op argv", () => {
    expect(
      validateRelayCommand(
        grammarInput(["read", "op://V/I/f"], { allowReveal: true }),
      ),
    ).toEqual({ check: "grammar" });
  });

  test("refuses --pass-token alongside --value-fd", () => {
    expect(
      validateRelayCommand(
        grammarInput(["read", "op://V/I/f"], { passToken: true }),
      ),
    ).toEqual({ check: "grammar" });
  });

  test("refuses a missing --read flag as a non-read path", () => {
    expect(
      validateRelayCommand(
        grammarInput(["read", "op://V/I/f"], {
          hasRead: false,
        }),
      ),
    ).toEqual({ check: "grammar" });
  });
});

describe("child-failure classifier", () => {
  test("classifies the spec's synthetic denied example", () => {
    expect(
      classifyChildFailure(
        "[ERROR] 2026/10/19 00:31:02 vault \"Infra\" isn't in this account or you don't have access to it",
      ),
    ).toBe("denied");
  });

  test("classifies permission wording before existence wording", () => {
    expect(classifyChildFailure("access denied: item not found")).toBe(
      "denied",
    );
    expect(classifyChildFailure("not authorized, no such thing")).toBe(
      "denied",
    );
    expect(classifyChildFailure("FORBIDDEN")).toBe("denied");
    expect(classifyChildFailure("vault isn't a vault in this account")).toBe(
      "denied",
    );
  });

  test("classifies the spec's synthetic notfound example", () => {
    expect(
      classifyChildFailure(
        '[ERROR] 2026/10/19 00:31:02 "op://Infra/reflect-intake-restic/password" isn\'t a field in the item "reflect-intake-restic"',
      ),
    ).toBe("notfound");
  });

  test("classifies existence wording", () => {
    expect(classifyChildFailure("item not found")).toBe("notfound");
    expect(classifyChildFailure("that isn't an item in this vault")).toBe(
      "notfound",
    );
    expect(classifyChildFailure("no such file")).toBe("notfound");
    expect(classifyChildFailure("the vault doesn't exist")).toBe("notfound");
  });

  test("classifies transport wording, including no such host", () => {
    expect(
      classifyChildFailure(
        "[ERROR] 2026/10/19 00:31:02 POST: dial tcp: i/o timeout",
      ),
    ).toBe("unreachable");
    expect(classifyChildFailure("dial tcp: no such host")).toBe("unreachable");
    expect(classifyChildFailure("network connection refused")).toBe(
      "unreachable",
    );
    expect(classifyChildFailure("temporary failure in name resolution")).toBe(
      "unreachable",
    );
    expect(classifyChildFailure("SSL handshake failed")).toBe("unreachable");
    expect(classifyChildFailure("request timed out")).toBe("unreachable");
    expect(classifyChildFailure("service unreachable")).toBe("unreachable");
  });

  test("falls back to unknown without guessing", () => {
    expect(classifyChildFailure("something unexpected happened")).toBe(
      "unknown",
    );
    expect(classifyChildFailure("")).toBe("unknown");
  });

  test("prefers notfound over unreachable for shared wording order", () => {
    // "no such host" must reach unreachable even though notfound owns
    // "no such"; anything else with both wordings keeps rule order.
    expect(classifyChildFailure("no such host and not found")).toBe("notfound");
  });
});

describe("relay identifiers and telemetry labels", () => {
  test("renders every stable failure identifier and matches the anchor", () => {
    const identifiers = [
      relayOutcomeIdentifier({ check: "grammar", kind: "refused" }),
      relayOutcomeIdentifier({
        check: "descriptor-not-open",
        kind: "refused",
      }),
      relayOutcomeIdentifier({
        check: "descriptor-standard",
        kind: "refused",
      }),
      relayOutcomeIdentifier({
        check: "descriptor-not-pipe",
        kind: "refused",
      }),
      relayOutcomeIdentifier({ check: "descriptor-alias", kind: "refused" }),
      relayOutcomeIdentifier({ kind: "spawn" }),
      relayOutcomeIdentifier({ kind: "resolution", resolutionStage: "config" }),
      relayOutcomeIdentifier({ kind: "resolution", resolutionStage: "token" }),
      relayOutcomeIdentifier({ kind: "child-timeout" }),
      relayOutcomeIdentifier({
        failureClass: "denied",
        kind: "child-failed",
      }),
      relayOutcomeIdentifier({
        failureClass: "notfound",
        kind: "child-failed",
      }),
      relayOutcomeIdentifier({
        failureClass: "unreachable",
        kind: "child-failed",
      }),
      relayOutcomeIdentifier({ failureClass: "unknown", kind: "child-failed" }),
      relayOutcomeIdentifier({ kind: "write-failed" }),
      relayOutcomeIdentifier({ kind: "deadline" }),
    ].map((identifier) => `${RELAY_FAILURE_PREFIX} ${identifier}`);

    for (const line of identifiers) {
      expect(line).toMatch(RELAY_FAILURE_LINE_PATTERN);
    }

    expect(identifiers).toContain("opchain: relay: grammar");
    expect(identifiers).toContain("opchain: relay: descriptor-alias");
    expect(identifiers).toContain("opchain: relay: child-failed:denied");
    expect(identifiers).toContain("opchain: relay: deadline");
  });

  test("never renders the debug prefix inside the anchored pattern", () => {
    expect(`${RELAY_DEBUG_PREFIX} fd=3 deadline_ms=30000`).not.toMatch(
      RELAY_FAILURE_LINE_PATTERN,
    );
  });

  test("maps config and profile resolution failures to config", () => {
    expect(
      relayOutcomeIdentifier({ resolutionStage: "config", kind: "resolution" }),
    ).toBe("config");
    expect(
      relayOutcomeIdentifier({
        resolutionStage: "profile",
        kind: "resolution",
      }),
    ).toBe("config");
    expect(
      relayOutcomeIdentifier({ resolutionStage: "token", kind: "resolution" }),
    ).toBe("token");
    expect(
      relayOutcomeIdentifier({
        resolutionStage: "token-deadline",
        kind: "resolution",
      }),
    ).toBe("deadline");
  });

  test("renders telemetry outcome labels from the fixed enum", () => {
    expect(relayOutcomeTelemetryLabel({ kind: "written" })).toBe("written");
    expect(
      relayOutcomeTelemetryLabel({ check: "grammar", kind: "refused" }),
    ).toBe("refused:grammar");
    expect(
      relayOutcomeTelemetryLabel({
        check: "descriptor-alias",
        kind: "refused",
      }),
    ).toBe("refused:descriptor-alias");
    expect(
      relayOutcomeTelemetryLabel({
        failureClass: "unreachable",
        kind: "child-failed",
      }),
    ).toBe("child-failed:unreachable");
    expect(relayOutcomeTelemetryLabel({ kind: "child-timeout" })).toBe(
      "child-timeout",
    );
    expect(relayOutcomeTelemetryLabel({ kind: "write-failed" })).toBe(
      "write-failed",
    );
    expect(relayOutcomeTelemetryLabel({ kind: "deadline" })).toBe("deadline");
    expect(relayOutcomeTelemetryLabel({ kind: "spawn" })).toBe("spawn");
    expect(
      relayOutcomeTelemetryLabel({
        kind: "resolution",
        resolutionStage: "token",
      }),
    ).toBe("token");
    expect(
      relayOutcomeTelemetryLabel({
        kind: "resolution",
        resolutionStage: "config",
      }),
    ).toBe("config");
  });
});
