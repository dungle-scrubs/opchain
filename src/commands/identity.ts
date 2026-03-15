import type { Config } from "../config/load-config.ts";

import { isExecutableAvailable } from "../cli/io.ts";
import { loadConfigContext } from "../cli/config-context.ts";
import type { CliOptions } from "../cli/options.ts";
import { resolveHelperPath } from "../cli/paths.ts";

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
export async function runIdentityList(options: CliOptions): Promise<number> {
  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    process.stderr.write(`${configContext.error}\n`);
    return 1;
  }

  process.stdout.write(
    `${Object.keys(configContext.value.config.identities).join("\n")}\n`,
  );
  return 0;
}

/**
 * Handles the `doctor` command.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runDoctor(options: CliOptions): Promise<number> {
  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    process.stderr.write(`${configContext.error}\n`);
    return 1;
  }

  process.stdout.write(
    `${renderDoctorOutput(configContext.value.config, configContext.value.configPath)}\n`,
  );
  return 0;
}
