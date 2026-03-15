import { loadConfig } from "../config/load-config.ts";
import type { Config } from "../config/load-config.ts";

import type { CliOptions } from "./options.ts";
import { resolveConfigPath } from "./paths.ts";
import {
  emitConfigLoadTelemetry,
  emitIdentityResolveTelemetry,
} from "./telemetry.ts";
import type { RuntimeResult } from "./result.ts";

export type ConfigContext = {
  readonly config: Config;
  readonly configPath: string;
};

/**
 * Loads config and emits the standard telemetry events.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<RuntimeResult<ConfigContext>>} Loaded config context or a printable error.
 */
export async function loadConfigContext(
  options: CliOptions,
): Promise<RuntimeResult<ConfigContext>> {
  const configPath = resolveConfigPath();
  const configResult = await loadConfig(configPath);
  if (!configResult.ok) {
    return {
      error: configResult.error.message,
      ok: false,
    };
  }

  emitConfigLoadTelemetry(options, configResult.value, configPath);
  emitIdentityResolveTelemetry(options, configResult.value);

  return {
    ok: true,
    value: {
      config: configResult.value,
      configPath,
    },
  };
}
