import { upsertExpiryTrackedItem } from "../expires/state.ts";

import { parseIdentityCommandPath } from "../cli/command-args.ts";
import { loadExpiryStateResult, saveExpiryStateResult } from "../cli/io.ts";
import type { CliOptions } from "../cli/options.ts";
import { resolveExpiryStatePath } from "../cli/paths.ts";
import { resolveReadIdentityContext } from "../cli/token-context.ts";
import { readOpItemJson } from "../op/item-json.ts";

import { parseExpiryTrackedItem } from "./item-payload.ts";

/**
 * Handles `opchain <identity> expires add <op://...>`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runExpiresAdd(options: CliOptions): Promise<number> {
  const parsedArgs = parseIdentityCommandPath(options.commandArgs, [
    "expires",
    "add",
  ]);
  if (!parsedArgs.ok) {
    process.stderr.write(`${parsedArgs.error}\n`);
    return 1;
  }

  const { identityName } = parsedArgs;
  const [reference] = parsedArgs.trailingArgs;

  if (reference === undefined) {
    process.stderr.write(
      "expires add currently requires an explicit reference.\n",
    );
    return 1;
  }

  const identityContext = await resolveReadIdentityContext(
    options,
    identityName,
  );
  if (!identityContext.ok) {
    process.stderr.write(`${identityContext.error}\n`);
    return 1;
  }

  const itemResult = readOpItemJson(
    identityContext.value.token,
    reference,
    "Failed to resolve expiry tracking reference.",
    "Invalid expiry tracking payload.",
  );
  if (!itemResult.ok) {
    process.stderr.write(`${itemResult.error}\n`);
    return 1;
  }

  const trackedItem = parseExpiryTrackedItem(itemResult.value);
  if (typeof trackedItem === "string") {
    process.stderr.write(`${trackedItem}\n`);
    return 1;
  }

  const statePath = resolveExpiryStatePath(identityName);
  const stateResult = loadExpiryStateResult(statePath, identityName);
  if (!stateResult.ok) {
    process.stderr.write(`${stateResult.error}\n`);
    return 1;
  }

  const nextState = upsertExpiryTrackedItem(stateResult.value, trackedItem);
  const stateSaveError = saveExpiryStateResult(statePath, nextState);
  if (stateSaveError !== null) {
    process.stderr.write(`${stateSaveError}\n`);
    return 1;
  }

  process.stdout.write(
    `Added expiry tracking for ${trackedItem.vaultUuid}/${trackedItem.itemUuid}.\n`,
  );
  return 0;
}
