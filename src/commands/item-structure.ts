import { parseFlagArguments } from "../cli/flag-args.ts";
import type { CommandRequest } from "../cli/command-request.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";
import { resolveReadIdentityContext } from "../cli/token-context.ts";
import { parseItemStructure } from "./item-payload.ts";
import { readOpItemJson } from "../op/item-json.ts";

const ITEM_STRUCTURE_USAGE =
  "Usage: opchain <identity> item-structure <item> [--vault <vault>]\n";

const ITEM_STRUCTURE_BOOLEAN_FLAGS: ReadonlySet<string> = new Set();
const ITEM_STRUCTURE_VALUE_FLAGS: ReadonlySet<string> = new Set(["--vault"]);

/**
 * Normalizes `--vault=<value>` spellings into separate flag and value tokens.
 *
 * @param args - Raw trailing arguments.
 * @returns {string[]} Arguments with attached-value spellings split.
 */
function normalizeVaultArg(args: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("--vault=")) {
      normalized.push("--vault", arg.slice("--vault=".length));
      continue;
    }

    normalized.push(arg);
  }

  return normalized;
}

/**
 * Parses item-structure arguments into one selector and an optional vault.
 *
 * @param args - Raw trailing arguments after the command name.
 * @returns {object | null} Parsed arguments or null when the shape is invalid.
 */
function parseItemStructureArgs(
  args: readonly string[],
): { readonly selector: string; readonly vault: string | undefined } | null {
  const parsed = parseFlagArguments(normalizeVaultArg(args), {
    booleanFlags: ITEM_STRUCTURE_BOOLEAN_FLAGS,
    valueFlags: ITEM_STRUCTURE_VALUE_FLAGS,
  });
  if (
    !parsed.ok ||
    parsed.positionals.length !== 1 ||
    parsed.unknownOptions.length > 0
  ) {
    return null;
  }

  return {
    selector: parsed.positionals[0] ?? "",
    vault: parsed.valueFlags.get("--vault"),
  };
}

/**
 * Handles `opchain <identity> item-structure <item> [--vault <vault>]`.
 *
 * Prints an item's field structure - labels, types, value presence, and value
 * length in Unicode code points - without ever printing a field value.
 *
 * @param request - Parsed command request.
 * @returns {Promise<CommandResult>} Command output.
 */
export async function runItemStructure(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for item-structure.\n");
  }

  const { identityName, options } = request;
  const parsedArgs = parseItemStructureArgs(request.trailingArgs);
  if (parsedArgs === null) {
    return commandFailure(ITEM_STRUCTURE_USAGE);
  }

  const identityContext = await resolveReadIdentityContext(
    options,
    identityName,
  );
  if (!identityContext.ok) {
    return commandFailure(`${identityContext.error}\n`);
  }

  const itemResult = readOpItemJson(
    identityContext.value.token,
    parsedArgs.selector,
    "Failed to read item structure.",
    "Invalid item structure payload.",
    parsedArgs.vault,
  );
  if (!itemResult.ok) {
    return commandFailure(`${itemResult.error}\n`);
  }

  const structure = parseItemStructure(itemResult.value);
  if (typeof structure === "string") {
    return commandFailure(`${structure}\n`);
  }

  return commandSuccess(`${JSON.stringify(structure, null, 2)}\n`);
}
