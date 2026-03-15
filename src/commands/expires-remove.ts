import { removeExpiryTrackedItem } from "../expires/state.ts";

import { parseIdentityCommandPath } from "../cli/command-args.ts";
import { loadExpiryStateResult, saveExpiryStateResult } from "../cli/io.ts";
import type { CliOptions } from "../cli/options.ts";
import { resolveExpiryStatePath } from "../cli/paths.ts";

/**
 * Handles `opchain <identity> expires remove <vault-uuid>/<item-uuid>`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runExpiresRemove(options: CliOptions): Promise<number> {
  const parsedArgs = parseIdentityCommandPath(options.commandArgs, [
    "expires",
    "remove",
  ]);
  if (!parsedArgs.ok) {
    process.stderr.write(`${parsedArgs.error}\n`);
    return 1;
  }

  const { identityName } = parsedArgs;
  const [removalTarget] = parsedArgs.trailingArgs;

  if (removalTarget === undefined || !removalTarget.includes("/")) {
    process.stderr.write(
      "expires remove currently requires <vault-uuid>/<item-uuid>.\n",
    );
    return 1;
  }

  const [vaultUuid, itemUuid] = removalTarget.split("/");
  if (vaultUuid === undefined || itemUuid === undefined) {
    process.stderr.write(
      "expires remove currently requires <vault-uuid>/<item-uuid>.\n",
    );
    return 1;
  }

  const statePath = resolveExpiryStatePath(identityName);
  const stateResult = loadExpiryStateResult(statePath, identityName);
  if (!stateResult.ok) {
    process.stderr.write(`${stateResult.error}\n`);
    return 1;
  }

  const nextState = removeExpiryTrackedItem(
    stateResult.value,
    vaultUuid,
    itemUuid,
  );
  const stateSaveError = saveExpiryStateResult(statePath, nextState);
  if (stateSaveError !== null) {
    process.stderr.write(`${stateSaveError}\n`);
    return 1;
  }

  process.stdout.write(
    `Removed expiry tracking for ${vaultUuid}/${itemUuid}.\n`,
  );
  return 0;
}
