import { loadExpiryStateResult } from "../cli/io.ts";
import type { CliOptions } from "../cli/options.ts";
import { resolveExpiryStatePath } from "../cli/paths.ts";

/**
 * Handles `opchain <identity> expires list`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runExpiresList(options: CliOptions): Promise<number> {
  const identityName = options.commandArgs[0];

  if (identityName === undefined) {
    process.stderr.write("Missing identity before expires command.\n");
    return 1;
  }

  const stateResult = loadExpiryStateResult(
    resolveExpiryStatePath(identityName),
    identityName,
  );
  if (!stateResult.ok) {
    process.stderr.write(`${stateResult.error}\n`);
    return 1;
  }

  const lines = stateResult.value.trackedItems.map(
    (item) =>
      `${item.vaultUuid}/${item.itemUuid} ${item.vaultTitle} / ${item.itemTitle}`,
  );

  if (lines.length === 0) {
    return 0;
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
