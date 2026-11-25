import { resolveReadIdentityContext } from "../cli/token-context.ts";
import type { CommandRequest } from "../cli/command-request.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";
import { readOpItemJson } from "../op/item-json.ts";
import type { ChildFailureClass } from "../op/relay.ts";
import { parseSecretReference } from "../op/secret-reference.ts";

import {
  formatSecretInspectOutput,
  parseSecretInspectMetadata,
} from "./item-payload.ts";

/**
 * Handles `opchain <identity> secrets inspect <ref>`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runSecretsInspect(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "identity") {
    return commandFailure("Invalid command shape for secrets inspect.\n");
  }

  const { identityName, options } = request;
  const [reference] = request.trailingArgs;

  if (reference === undefined) {
    return commandFailure(
      "secrets inspect currently requires an explicit reference.\n",
    );
  }

  const parsed = parseSecretReference(reference);
  if (parsed === undefined) {
    return commandFailure(
      "Invalid secret reference. Expected op://<vault>/<item>[/<section>]/<field>.\n",
    );
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
    parsed.item,
    INSPECT_FAILED,
    INVALID_PAYLOAD,
    parsed.vault,
  );
  if (!itemResult.ok) {
    return commandFailure(
      `${itemResult.reason === "exec" ? inspectFailureMessage(itemResult.opError) : itemResult.error}\n`,
    );
  }

  const inspected = parseSecretInspectMetadata(
    itemResult.value,
    reference,
    parsed,
  );
  switch (inspected.kind) {
    case "ambiguous":
      return commandFailure(
        `${INSPECT_FAILED_PREFIX}: more than one field matches; use the field's ID.\n`,
      );
    case "field_not_found":
      return commandFailure(`${INSPECT_FAILED_PREFIX}: field not found.\n`);
    case "invalid":
      return commandFailure(`${INVALID_PAYLOAD}\n`);
    case "ok":
      return commandSuccess(
        `${formatSecretInspectOutput(inspected.metadata)}\n`,
      );
  }
}

const INSPECT_FAILED_PREFIX = "Failed to inspect secret reference";
const INSPECT_FAILED = `${INSPECT_FAILED_PREFIX}.`;
const INVALID_PAYLOAD = "Invalid secret inspection payload.";

/**
 * One fixed message per kind of op failure. op's own text is never printed:
 * it echoes the selector.
 *
 * @param opError - The classified failure.
 * @returns {string} Printable message.
 */
function inspectFailureMessage(opError: ChildFailureClass): string {
  switch (opError) {
    case "notfound":
      return `${INSPECT_FAILED_PREFIX}: item not found.`;
    case "denied":
      // 1Password words a vault the identity cannot see as a missing one.
      return `${INSPECT_FAILED_PREFIX}: vault not found or not visible to this identity.`;
    case "unreachable":
      return `${INSPECT_FAILED_PREFIX}: 1Password could not be reached.`;
    case "unknown":
      return INSPECT_FAILED;
  }
}
