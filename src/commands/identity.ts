import type { Config } from "../config/load-config.ts";

import type { CommandRequest } from "../cli/command-request.ts";
import { isExecutableAvailable } from "../cli/io.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import { resolveHelperPath } from "../cli/paths.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";

/**
 * Renders the current doctor report.
 *
 * @param config - Loaded runtime config.
 * @param configPath - Resolved config path.
 * @returns {string} Human-readable doctor output.
 */
function renderDoctorOutput(config: Config, configPath: string): string {
  const helperPath = resolveHelperPath();
  const identityLines = Object.entries(config.identities).flatMap(
    ([identityName, identity]) => [
      `- ${identityName}`,
      `  default mode: ${identity.defaultMode}`,
      `  profiles: ${Object.keys(identity.profiles).join(", ")}`,
      `  vaults: ${identity.vaults.join(", ")}`,
    ],
  );

  return [
    `Binary path: ${process.execPath}`,
    `Config path: ${configPath}`,
    `Helper path: ${helperPath}`,
    `Helper status: ${isExecutableAvailable(helperPath) ? "available" : "missing"}`,
    "",
    "Identities:",
    ...identityLines,
    "",
    "Configured vaults are a local allowlist, not the primary security boundary.",
  ].join("\n");
}

/**
 * Handles the `identity list` command.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runIdentityList(
  request: CommandRequest,
): Promise<CommandResult> {
  const { options } = request;
  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    return commandFailure(`${configContext.error}\n`);
  }

  return commandSuccess(
    `${Object.keys(configContext.value.config.identities).join("\n")}\n`,
  );
}

/**
 * Handles the `doctor` command.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runDoctor(
  request: CommandRequest,
): Promise<CommandResult> {
  const { options } = request;
  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    return commandFailure(`${configContext.error}\n`);
  }

  return commandSuccess(
    `${renderDoctorOutput(configContext.value.config, configContext.value.configPath)}\n`,
  );
}
