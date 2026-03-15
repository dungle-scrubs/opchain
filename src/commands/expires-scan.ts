import type { ExpiryTrackedItem } from "../expires/state.ts";
import { classifyExpiryStatus } from "../expires/status.ts";
import { createTelemetryEvent } from "../telemetry/event.ts";

import { loadExpiryStateResult, saveExpiryStateResult } from "../cli/io.ts";
import type { CliOptions } from "../cli/options.ts";
import { resolveExpiryStatePath } from "../cli/paths.ts";
import { writeTelemetry } from "../cli/telemetry.ts";
import { resolveReadIdentityContext } from "../cli/token-context.ts";
import { readOpItemJson } from "../op/item-json.ts";

import { parseExpiryTrackedItem } from "./item-payload.ts";

/**
 * Handles `opchain <identity> expires scan`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runExpiresScan(options: CliOptions): Promise<number> {
  const identityName = options.commandArgs[0];

  if (identityName === undefined) {
    process.stderr.write("Missing identity before expires command.\n");
    return 1;
  }

  const identityContext = await resolveReadIdentityContext(options, identityName);
  if (!identityContext.ok) {
    process.stderr.write(`${identityContext.error}\n`);
    return 1;
  }

  const statePath = resolveExpiryStatePath(identityName);
  const stateResult = loadExpiryStateResult(statePath, identityName);
  if (!stateResult.ok) {
    process.stderr.write(`${stateResult.error}\n`);
    return 1;
  }

  const currentState = stateResult.value;
  const scannedItems: ExpiryTrackedItem[] = [];
  const outputLines: string[] = [];

  for (const trackedItem of currentState.trackedItems) {
    const itemResult = readOpItemJson(
      identityContext.value.token,
      trackedItem.itemUuid,
      "Failed to load expiry scan item.",
      "Invalid expiry scan payload.",
    );
    if (!itemResult.ok) {
      if (itemResult.reason === "parse") {
        process.stderr.write(`${itemResult.error}\n`);
        return 1;
      }

      const missingItem: ExpiryTrackedItem = {
        ...trackedItem,
        lastCheckedAt: new Date().toISOString(),
        status: "missing",
      };
      scannedItems.push(missingItem);
      outputLines.push(
        `missing ${trackedItem.vaultUuid}/${trackedItem.itemUuid} ${trackedItem.vaultTitle} / ${trackedItem.itemTitle}`,
      );
      continue;
    }

    const parsedItem = parseExpiryTrackedItem(itemResult.value);
    if (typeof parsedItem === "string" || parsedItem.expiresAt === undefined) {
      process.stderr.write("Invalid expiry scan payload.\n");
      return 1;
    }

    const status = classifyExpiryStatus(
      parsedItem.expiresAt,
      identityContext.value.config.defaults.expiresThresholdDays,
    );

    writeTelemetry(
      options,
      createTelemetryEvent("expires.threshold.evaluate", {
        item_uuid: trackedItem.itemUuid,
        status,
        threshold_days: identityContext.value.config.defaults.expiresThresholdDays,
        vault_uuid: trackedItem.vaultUuid,
      }),
    );

    const scannedItem: ExpiryTrackedItem = {
      ...trackedItem,
      expiresAt: parsedItem.expiresAt,
      itemTitle: parsedItem.itemTitle,
      lastCheckedAt: new Date().toISOString(),
      status,
      vaultTitle: parsedItem.vaultTitle,
    };

    writeTelemetry(
      options,
      createTelemetryEvent("expires.scan.item", {
        item_uuid: trackedItem.itemUuid,
        status,
        vault_uuid: trackedItem.vaultUuid,
      }),
    );

    scannedItems.push(scannedItem);
    outputLines.push(
      `${status} ${trackedItem.vaultUuid}/${trackedItem.itemUuid} ${parsedItem.expiresAt} ${parsedItem.vaultTitle} / ${parsedItem.itemTitle}`,
    );
  }

  const stateSaveError = saveExpiryStateResult(statePath, {
    identity: currentState.identity,
    trackedItems: scannedItems,
    version: currentState.version,
  });
  if (stateSaveError !== null) {
    process.stderr.write(`${stateSaveError}\n`);
    return 1;
  }

  if (outputLines.length > 0) {
    process.stdout.write(`${outputLines.join("\n")}\n`);
  }

  return 0;
}
