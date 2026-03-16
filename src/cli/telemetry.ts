import type { Config } from "../config/load-config.ts";
import {
  createTelemetryEvent,
  type TelemetryEvent,
} from "../telemetry/event.ts";

import type { CliOptions, DebugFormat } from "./options.ts";

/**
 * Resolves a safe command label for telemetry.
 *
 * @param options - Parsed CLI options.
 * @returns {string} Safe command name.
 */
export function resolveCommandName(options: CliOptions): string {
  if (options.help) {
    return "help";
  }

  return options.commandArgs.slice(0, 2).join(" ") || "unknown";
}

/**
 * Renders a telemetry event using the selected output format.
 *
 * @param event - Event to render.
 * @param debugFormat - Selected debug format.
 * @returns {string} Rendered event payload.
 */
function renderTelemetryEvent(
  event: TelemetryEvent,
  debugFormat: DebugFormat,
): string {
  if (debugFormat === "json") {
    return JSON.stringify(event);
  }

  return `${event.timestamp} ${event.name} ${event.status}`;
}

/**
 * Writes a telemetry event to stderr when debug mode is enabled.
 *
 * @param options - Parsed CLI options.
 * @param event - Event to emit.
 * @returns {void} Nothing.
 */
export function writeTelemetry(
  options: CliOptions,
  event: TelemetryEvent,
): void {
  if (!options.debug) {
    return;
  }

  process.stderr.write(`${renderTelemetryEvent(event, options.debugFormat)}\n`);
}

/**
 * Counts configured profiles across all identities.
 *
 * @param config - Loaded runtime config.
 * @returns {number} Total configured profile count.
 */
function countProfiles(config: Config): number {
  return Object.values(config.identities).reduce(
    (total, identity) => total + Object.keys(identity.profiles).length,
    0,
  );
}

/**
 * Emits safe config-loading telemetry.
 *
 * @param options - Parsed CLI options.
 * @param config - Loaded runtime config.
 * @param configPath - Resolved config path.
 * @returns {void} Nothing.
 */
export function emitConfigLoadTelemetry(
  options: CliOptions,
  config: Config,
  configPath: string,
): void {
  writeTelemetry(
    options,
    createTelemetryEvent("config.load", {
      config_path: configPath,
      identity_count: Object.keys(config.identities).length,
      profile_count: countProfiles(config),
    }),
  );
}

/**
 * Emits safe identity-resolution telemetry.
 *
 * @param options - Parsed CLI options.
 * @param config - Loaded runtime config.
 * @returns {void} Nothing.
 */
export function emitIdentityResolveTelemetry(
  options: CliOptions,
  config: Config,
): void {
  writeTelemetry(
    options,
    createTelemetryEvent("identity.resolve", {
      identities: Object.keys(config.identities),
      identity_count: Object.keys(config.identities).length,
    }),
  );
}
