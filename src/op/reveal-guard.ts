import { resolve } from "node:path";

/**
 * Result of one reveal-guard evaluation: the refused command shape plus the
 * safe alternative named in the refusal message.
 */
export type RevealForm = {
  /** Stable form id used in refusal messages and telemetry. */
  readonly form: string;
  /** One sentence naming the safe alternative. Never contains argument values. */
  readonly alternative: string;
};

/**
 * op global flags that consume a value token (`--flag value` or `--flag=value`).
 */
const OP_GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--account",
  "--config",
  "--encoding",
  "--format",
  "--session",
]);

/**
 * op global boolean flags, including their `--flag=value` spellings.
 */
const OP_GLOBAL_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--cache",
  "--debug",
  "--iso-timestamps",
  "--no-color",
  "-h",
  "--help",
  "-v",
  "--version",
]);

/**
 * Command paths guarded by the reveal guard, longest first is irrelevant;
 * matching is prefix-based over the canonicalized path tokens.
 */
const GUARDED_PATHS: readonly (readonly string[])[] = [
  ["read"],
  ["inject"],
  ["run"],
  ["signin"],
  ["item", "get"],
  ["item", "create"],
  ["item", "edit"],
  ["document", "get"],
  ["service-account", "create"],
  ["connect", "token", "create"],
  ["events-api", "create"],
];

/**
 * Alternatives for each refused form, keyed by form id.
 */
const REVEAL_ALTERNATIVES: Readonly<Record<string, string>> = {
  "document-get-stdout":
    "Save the document with `op document get <doc> --out-file <file>`.",
  "inject-stdout":
    "Write the result to a file with `op inject -o <file>`, or use `op run`.",
  "item-get-reveal":
    "Use `opchain <identity> item-structure <item> [--vault <vault>]` to see field labels and types without values.",
  "item-write-reveal":
    "Drop --reveal and --format json; the default output conceals sensitive fields.",
  "read-stdout":
    "Pass the value to the program that needs it with `op run`, or write it to a file with `op read -o <file>`.",
  "run-no-masking":
    "Drop --no-masking; masked `op run` still passes the values to the child process.",
  signin: "opchain injects a service-account token; `op signin` is not needed.",
  "token-create":
    "This command prints a new token. Run it from an interactive terminal with --allow-reveal.",
  "unclassifiable-order":
    "Put op flags after the subcommand, for example `op item get <item> --vault <vault>`.",
};

/**
 * Builds one refused reveal form.
 *
 * @param form - Stable form id.
 * @returns {RevealForm} Refusal with its safe alternative.
 */
function revealFormOf(form: string): RevealForm {
  return {
    alternative: REVEAL_ALTERNATIVES[form] ?? "",
    form,
  };
}

/**
 * Splits one flag token into its name and an optional attached value.
 *
 * @param token - Raw dash token, possibly in `--flag=value` form.
 * @returns {string[]} Two-element array of name and attached value ("" when absent).
 */
function splitFlagToken(token: string): readonly [string, string] {
  const equalsIndex = token.indexOf("=");
  if (equalsIndex === -1) {
    return [token, ""];
  }

  return [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)];
}

/**
 * Matches one dash token against op's known global flags.
 *
 * `--name=value` spellings of both value and boolean flags count as the flag.
 *
 * @param token - Raw dash token.
 * @returns {object | undefined} Global flag classification or undefined for non-global tokens.
 */
function matchOpGlobalFlag(
  token: string,
):
  | { readonly attachedValue: string | undefined; readonly name: string }
  | undefined {
  const [name, attachedValue] = splitFlagToken(token);

  if (OP_GLOBAL_VALUE_FLAGS.has(name)) {
    return {
      attachedValue: attachedValue === "" ? undefined : attachedValue,
      name,
    };
  }

  if (OP_GLOBAL_BOOLEAN_FLAGS.has(name)) {
    return { attachedValue: undefined, name };
  }

  return undefined;
}

/**
 * Canonicalizes one confirmed op alias at a path position.
 *
 * @param token - Raw path token.
 * @param position - Zero-based position inside the command path.
 * @param firstWord - Canonicalized first path word, when already collected.
 * @returns {string} Canonicalized path token.
 */
function canonicalizePathToken(
  token: string,
  position: number,
  firstWord: string | undefined,
): string {
  if (position === 0) {
    if (token === "items") {
      return "item";
    }
    if (token === "documents") {
      return "document";
    }
    if (token === "sa") {
      return "service-account";
    }
    return token;
  }

  if (position === 1 && firstWord === "connect" && token === "tokens") {
    return "token";
  }

  return token;
}

/**
 * Checks whether one guarded path is a prefix of the collected command path.
 *
 * @param path - Canonicalized command path collected so far.
 * @param guarded - Guarded command path.
 * @returns {boolean} True when the command path starts with the guarded path.
 */
function pathStartsWith(
  path: readonly string[],
  guarded: readonly string[],
): boolean {
  if (path.length < guarded.length) {
    return false;
  }

  return guarded.every((token, index) => path[index] === token);
}

/**
 * Checks whether the path collected so far is a proper prefix of any guarded
 * path, including the empty path.
 *
 * The collected path is the shorter side here: an unknown dash token while a
 * longer guarded path could still match means opchain cannot classify the
 * ordering.
 *
 * @param path - Canonicalized command path collected so far.
 * @returns {boolean} True while the final command path is still undetermined.
 */
function isProperPrefixOfGuardedPath(path: readonly string[]): boolean {
  return GUARDED_PATHS.some(
    (guarded) =>
      guarded.length > path.length &&
      path.every((token, index) => guarded[index] === token),
  );
}

/**
 * Parses one dash token as an out-file flag.
 *
 * @param token - Raw dash token.
 * @returns {object | undefined} Out-file flag shape or undefined when absent.
 */
function matchOutFileFlag(
  token: string,
): { readonly attached: string | undefined } | undefined {
  if (token === "-o" || token === "--out-file") {
    return { attached: undefined };
  }

  if (token.startsWith("--out-file=")) {
    return { attached: token.slice("--out-file=".length) };
  }

  if (token.startsWith("-o=")) {
    return { attached: token.slice("-o=".length) };
  }

  if (token.startsWith("-o") && token.length > 2) {
    return { attached: token.slice(2) };
  }

  return undefined;
}

/**
 * Validates one out-file value against the reveal guard rules.
 *
 * @param value - Last out-file value seen, when any.
 * @param cwd - Working directory used to resolve relative values.
 * @returns {boolean} True when the value writes to a real file.
 */
function isValidOutFile(value: string | undefined, cwd: string): boolean {
  if (value === undefined || value === "" || value === "-") {
    return false;
  }

  return !resolve(cwd, value).startsWith("/dev/");
}

/**
 * op boolean flags, global and per-command, that never consume the next
 * token regardless of spelling position. Any other dash flag written
 * without `=` is treated as a value flag that could swallow a following
 * `--` separator.
 */
const KNOWN_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--cache",
  "--debug",
  "--iso-timestamps",
  "--no-color",
  "-h",
  "--help",
  "-v",
  "--version",
  "-f",
  "--force",
  "-n",
  "--no-newline",
  "--no-masking",
  "--reveal",
  "--otp",
  "--include-archive",
  "--share-link",
  "--dry-run",
  "--favorite",
  "--raw",
  "--can-create-vaults",
  "--generate-password",
]);

/**
 * Detects whether one `op` command line prints a secret value to stdout.
 *
 * Pure argv inspection: tokens after the first `--` are ignored, op global
 * flags and their values are skipped, confirmed aliases are canonicalized,
 * and the canonicalized command path is matched against the guarded forms.
 * Unknown dash tokens appearing while the command path is still a proper
 * prefix of a guarded path fail closed as `unclassifiable-order`.
 *
 * @param opArgs - Arguments passed after the `op` marker.
 * @param cwd - Working directory used to resolve out-file values.
 * @returns {RevealForm | null} Refused form with its alternative, or null when allowed.
 */
export function detectRevealForm(
  opArgs: readonly string[],
  cwd: string,
): RevealForm | null {
  const separatorIndex = opArgs.indexOf("--");

  // pflag hands a value flag written `--flag value` the next token even when
  // that token is `--`, so such a separator never reaches op. When the token
  // right before it is a dash flag that could be a value flag, fail closed.
  const tokenBeforeSeparator =
    separatorIndex > 0 ? opArgs[separatorIndex - 1] : undefined;
  if (
    tokenBeforeSeparator?.startsWith("-") &&
    !tokenBeforeSeparator.includes("=") &&
    !KNOWN_BOOLEAN_FLAGS.has(tokenBeforeSeparator)
  ) {
    return revealFormOf("unclassifiable-order");
  }

  const tokens =
    separatorIndex === -1 ? opArgs : opArgs.slice(0, separatorIndex);

  const path: string[] = [];
  const markerTokens: string[] = [];
  let formatIsJson = false;
  let helpRequested = false;
  let outFileValue: string | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }

    if (!token.startsWith("-") || token === "-") {
      path.push(canonicalizePathToken(token, path.length, path[0]));
      continue;
    }

    const globalFlag = matchOpGlobalFlag(token);
    if (globalFlag !== undefined) {
      if (OP_GLOBAL_VALUE_FLAGS.has(globalFlag.name)) {
        let value = globalFlag.attachedValue;
        if (value === undefined) {
          value = tokens[index + 1];
          if (value !== undefined) {
            index += 1;
          }
        }

        if (globalFlag.name === "--format" && value?.toLowerCase() === "json") {
          formatIsJson = true;
        }
        continue;
      }

      if (token === "--help" || token === "-h") {
        helpRequested = true;
      }
      continue;
    }

    if (isProperPrefixOfGuardedPath(path)) {
      return revealFormOf("unclassifiable-order");
    }

    const outFileFlag = matchOutFileFlag(token);
    if (outFileFlag !== undefined) {
      if (outFileFlag.attached !== undefined) {
        outFileValue = outFileFlag.attached;
        continue;
      }

      const nextToken = tokens[index + 1];
      if (nextToken !== undefined && !nextToken.startsWith("-")) {
        outFileValue = nextToken;
        index += 1;
      } else {
        outFileValue = undefined;
      }
      continue;
    }

    markerTokens.push(token);
  }

  if (helpRequested) {
    return null;
  }

  const hasMarker = (name: string): boolean =>
    markerTokens.some(
      (marker) => marker === name || marker.startsWith(`${name}=`),
    );

  const validOutFile = isValidOutFile(outFileValue, cwd);

  if (pathStartsWith(path, ["read"])) {
    return validOutFile ? null : revealFormOf("read-stdout");
  }

  if (pathStartsWith(path, ["inject"])) {
    return validOutFile ? null : revealFormOf("inject-stdout");
  }

  if (pathStartsWith(path, ["document", "get"])) {
    return validOutFile ? null : revealFormOf("document-get-stdout");
  }

  if (pathStartsWith(path, ["item", "get"])) {
    return hasMarker("--reveal") || hasMarker("--otp") || formatIsJson
      ? revealFormOf("item-get-reveal")
      : null;
  }

  if (pathStartsWith(path, ["item", "create"])) {
    return hasMarker("--reveal") || formatIsJson
      ? revealFormOf("item-write-reveal")
      : null;
  }

  if (pathStartsWith(path, ["item", "edit"])) {
    return hasMarker("--reveal") || formatIsJson
      ? revealFormOf("item-write-reveal")
      : null;
  }

  if (pathStartsWith(path, ["run"])) {
    return hasMarker("--no-masking") ? revealFormOf("run-no-masking") : null;
  }

  if (pathStartsWith(path, ["signin"])) {
    return revealFormOf("signin");
  }

  if (
    pathStartsWith(path, ["service-account", "create"]) ||
    pathStartsWith(path, ["connect", "token", "create"]) ||
    pathStartsWith(path, ["events-api", "create"])
  ) {
    return revealFormOf("token-create");
  }

  return null;
}
