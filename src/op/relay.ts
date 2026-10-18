/**
 * Pure relay-route pieces for `--value-fd`: the command grammar validated
 * independently of the reveal guard, the ordered child-failure classifier,
 * and the stable failure identifiers fleet recognizes.
 *
 * This module performs no I/O and never sees a token, a value, or child
 * output beyond the private stderr text passed to the classifier.
 */

/** Prefix of the one failure line relay mode writes to stderr. */
export const RELAY_FAILURE_PREFIX = "opchain: relay:";

/**
 * Prefix of optional debug metadata lines. Deliberately distinct from
 * {@link RELAY_FAILURE_PREFIX} so it can never match the anchored
 * recognition pattern.
 */
export const RELAY_DEBUG_PREFIX = "opchain debug: relay:";

/**
 * Anchored pattern fleet uses to recognize the relay failure line: the
 * unique stderr line matching it is the failure identifier, and no
 * matching line means `unknown`.
 */
export const RELAY_FAILURE_LINE_PATTERN =
  /^opchain: relay: [a-z-]+(:[a-z-]+)?$/;

/** Descriptor-check or grammar refusal names. */
export type RelayCheck =
  | "grammar"
  | "descriptor-not-open"
  | "descriptor-standard"
  | "descriptor-not-pipe"
  | "descriptor-alias";

/** Classification of one failed `op` child's private stderr text. */
export type ChildFailureClass = "denied" | "notfound" | "unreachable" | "unknown";

/**
 * Which identity-resolution stage failed. Config and profile failures
 * share the `config` identifier; a token provider that outlived the
 * overall relay deadline reports `deadline` instead of `token`.
 */
export type RelayResolutionStage = "config" | "profile" | "token" | "token-deadline";

/** One terminal relay outcome. Exactly one maps to one identifier. */
export type RelayOutcome =
  | { readonly kind: "written" }
  | { readonly kind: "refused"; readonly check: RelayCheck }
  | {
      readonly kind: "child-failed";
      readonly failureClass: ChildFailureClass;
    }
  | { readonly kind: "child-timeout" }
  | { readonly kind: "write-failed" }
  | { readonly kind: "deadline" }
  | { readonly kind: "spawn" }
  | { readonly kind: "resolution"; readonly resolutionStage: RelayResolutionStage };

/** The accepted relay command: one `op://` reference. */
export type RelayCommand = { readonly reference: string };

/** Grammar refusal sentinel. */
export type RelayGrammarRefusal = { readonly check: "grammar" };

/** Inputs to the relay grammar, all opchain-level flags already parsed. */
export type RelayGrammarInput = {
  readonly allowReveal: boolean;
  readonly hasRead: boolean;
  readonly opArgs: readonly string[];
  readonly passToken: boolean;
};

/**
 * Ordered child-failure classifier rules: first match wins. Permission
 * wording runs first because 1Password hides inaccessible vaults behind
 * existence wording.
 */
const CLASSIFIER_RULES: readonly {
  readonly failureClass: Exclude<ChildFailureClass, "unknown">;
  readonly pattern: RegExp;
}[] = [
  {
    failureClass: "denied",
    pattern:
      /isn't a vault in this account|isn't in this account|access denied|not authorized|forbidden/i,
  },
  {
    failureClass: "notfound",
    pattern:
      /not found|isn't an item|isn't a field|no such(?! host)|doesn't exist/i,
  },
  {
    failureClass: "unreachable",
    pattern:
      /timed out|timeout|unreachable|network|connection|dial tcp|no such host|tls|ssl|temporary failure/i,
  },
];

/**
 * Validates the relay command line.
 *
 * Relay mode validates the op argv on its own, never as an extension of
 * the reveal guard: exactly two tokens, `read` plus one `op://`
 * reference, with no dash token of any kind - every out-file spelling,
 * every global flag, any `--` separator, and any unknown dash token are
 * refused. `--allow-reveal` and `--pass-token` are forbidden
 * combinations on the unattended relay route, and a missing `--read`
 * flag leaves the non-read path.
 *
 * @param input - Parsed opchain-level flags plus the op argv.
 * @returns {RelayCommand | RelayGrammarRefusal} The reference, or the grammar refusal.
 */
export function validateRelayCommand(
  input: RelayGrammarInput,
): RelayCommand | RelayGrammarRefusal {
  if (input.allowReveal || input.passToken || !input.hasRead) {
    return { check: "grammar" };
  }

  if (input.opArgs.length !== 2) {
    return { check: "grammar" };
  }

  for (const token of input.opArgs) {
    if (token.startsWith("-")) {
      return { check: "grammar" };
    }
  }

  const [commandToken, referenceToken] = input.opArgs;
  // Confirmed aliases resolve as today: no alias canonicalizes to `read`,
  // so the first token must be `read` itself.
  if (commandToken !== "read" || referenceToken?.startsWith("op://") !== true) {
    return { check: "grammar" };
  }

  return { reference: referenceToken };
}

/**
 * Classifies one failed child's private stderr text in memory.
 *
 * The matched text is never printed; only the class travels.
 *
 * @param stderrText - The child's captured stderr, or "" when it wrote nothing.
 * @returns {ChildFailureClass} Most specific class, or `unknown`.
 */
export function classifyChildFailure(stderrText: string): ChildFailureClass {
  for (const rule of CLASSIFIER_RULES) {
    if (rule.pattern.test(stderrText)) {
      return rule.failureClass;
    }
  }

  return "unknown";
}

/**
 * Renders one outcome's stable failure identifier suffix.
 *
 * @param outcome - Terminal relay outcome other than a successful write.
 * @returns {string} Identifier such as `descriptor-alias` or `child-failed:denied`.
 */
export function relayOutcomeIdentifier(
  outcome: Exclude<RelayOutcome, { kind: "written" }>,
): string {
  switch (outcome.kind) {
    case "refused":
      return outcome.check;
    case "child-failed":
      return `child-failed:${outcome.failureClass}`;
    case "resolution":
      return outcome.resolutionStage === "token"
        ? "token"
        : outcome.resolutionStage === "token-deadline"
          ? "deadline"
          : "config";
    default:
      return outcome.kind;
  }
}

/**
 * Renders one outcome's telemetry label from the fixed outcome enum.
 *
 * @param outcome - Terminal relay outcome.
 * @returns {string} Label such as `written`, `refused:grammar`, or `child-failed:unknown`.
 */
export function relayOutcomeTelemetryLabel(outcome: RelayOutcome): string {
  if (outcome.kind === "refused") {
    return `refused:${outcome.check}`;
  }

  return outcome.kind === "written"
    ? "written"
    : relayOutcomeIdentifier(outcome);
}
