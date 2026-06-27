import { createTelemetryEvent } from "../telemetry/event.ts";

import { loadExpiryStateResult, saveExpiryStateResult } from "../cli/io.ts";
import type { CliOptions } from "../cli/options.ts";
import { resolveExpiryStatePath } from "../cli/paths.ts";
import { writeTelemetry } from "../cli/telemetry.ts";
import { readOpItemJson } from "../op/item-json.ts";
import type { RuntimeResult } from "../cli/result.ts";

import {
  removeExpiryTrackedItem,
  upsertExpiryTrackedItem,
  type ExpiryState,
  type ExpiryTrackedItem,
} from "./state.ts";
import { classifyExpiryStatus } from "./status.ts";
import { parseExpiryTrackedItem } from "../commands/item-payload.ts";

type ExpiryTracker = {
  readonly add: (
    token: string,
    reference: string,
  ) => RuntimeResult<{ readonly item: ExpiryTrackedItem }>;
  readonly list: () => RuntimeResult<{ readonly lines: readonly string[] }>;
  readonly remove: (
    vaultUuid: string,
    itemUuid: string,
  ) => RuntimeResult<{ readonly itemUuid: string; readonly vaultUuid: string }>;
  readonly scan: (
    options: CliOptions,
    token: string,
    thresholdDays: number,
  ) => RuntimeResult<{ readonly lines: readonly string[] }>;
};

/**
 * Creates one expiry tracker bound to an identity's state file.
 *
 * @param identityName - Identity owning expiry state.
 * @returns {ExpiryTracker} Bound tracker operations.
 */
export function createExpiryTracker(identityName: string): ExpiryTracker {
  const statePath = resolveExpiryStatePath(identityName);

  function loadState(): RuntimeResult<ExpiryState> {
    return loadExpiryStateResult(statePath, identityName);
  }

  function saveState(state: ExpiryState): string | null {
    return saveExpiryStateResult(statePath, state);
  }

  return {
    add: (token, reference) => {
      const itemResult = readOpItemJson(
        token,
        reference,
        "Failed to resolve expiry tracking reference.",
        "Invalid expiry tracking payload.",
      );
      if (!itemResult.ok) {
        return {
          error: itemResult.error,
          ok: false,
        };
      }

      const trackedItem = parseExpiryTrackedItem(itemResult.value);
      if (typeof trackedItem === "string") {
        return {
          error: trackedItem,
          ok: false,
        };
      }

      if (trackedItem.expiresAt === undefined) {
        return {
          error:
            "Cannot track expiry: the resolved item has no expires_at date.",
          ok: false,
        };
      }

      const stateResult = loadState();
      if (!stateResult.ok) {
        return stateResult;
      }

      const saveError = saveState(
        upsertExpiryTrackedItem(stateResult.value, trackedItem),
      );
      if (saveError !== null) {
        return {
          error: saveError,
          ok: false,
        };
      }

      return {
        ok: true,
        value: { item: trackedItem },
      };
    },
    list: () => {
      const stateResult = loadState();
      if (!stateResult.ok) {
        return stateResult;
      }

      return {
        ok: true,
        value: {
          lines: stateResult.value.trackedItems.map(
            (item) =>
              `${item.vaultUuid}/${item.itemUuid} ${item.vaultTitle} / ${item.itemTitle}`,
          ),
        },
      };
    },
    remove: (vaultUuid, itemUuid) => {
      const stateResult = loadState();
      if (!stateResult.ok) {
        return stateResult;
      }

      const saveError = saveState(
        removeExpiryTrackedItem(stateResult.value, vaultUuid, itemUuid),
      );
      if (saveError !== null) {
        return {
          error: saveError,
          ok: false,
        };
      }

      return {
        ok: true,
        value: { itemUuid, vaultUuid },
      };
    },
    scan: (options, token, thresholdDays) => {
      const stateResult = loadState();
      if (!stateResult.ok) {
        return stateResult;
      }

      const scannedItems: ExpiryTrackedItem[] = [];
      const outputLines: string[] = [];

      for (const trackedItem of stateResult.value.trackedItems) {
        const itemResult = readOpItemJson(
          token,
          trackedItem.itemUuid,
          "Failed to load expiry scan item.",
          "Invalid expiry scan payload.",
        );
        if (!itemResult.ok) {
          if (itemResult.reason === "parse") {
            return {
              error: itemResult.error,
              ok: false,
            };
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
        if (
          typeof parsedItem === "string" ||
          parsedItem.expiresAt === undefined
        ) {
          return {
            error: "Invalid expiry scan payload.",
            ok: false,
          };
        }

        const status = classifyExpiryStatus(
          parsedItem.expiresAt,
          thresholdDays,
        );

        writeTelemetry(
          options,
          createTelemetryEvent("expires.threshold.evaluate", {
            item_uuid: trackedItem.itemUuid,
            status,
            threshold_days: thresholdDays,
            vault_uuid: trackedItem.vaultUuid,
          }),
        );

        scannedItems.push({
          ...trackedItem,
          expiresAt: parsedItem.expiresAt,
          itemTitle: parsedItem.itemTitle,
          lastCheckedAt: new Date().toISOString(),
          status,
          vaultTitle: parsedItem.vaultTitle,
        });

        writeTelemetry(
          options,
          createTelemetryEvent("expires.scan.item", {
            item_uuid: trackedItem.itemUuid,
            status,
            vault_uuid: trackedItem.vaultUuid,
          }),
        );

        outputLines.push(
          `${status} ${trackedItem.vaultUuid}/${trackedItem.itemUuid} ${parsedItem.expiresAt} ${parsedItem.vaultTitle} / ${parsedItem.itemTitle}`,
        );
      }

      const saveError = saveState({
        identity: stateResult.value.identity,
        trackedItems: scannedItems,
        version: stateResult.value.version,
      });
      if (saveError !== null) {
        return {
          error: saveError,
          ok: false,
        };
      }

      return {
        ok: true,
        value: { lines: outputLines },
      };
    },
  };
}
