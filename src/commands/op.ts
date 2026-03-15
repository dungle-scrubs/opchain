import { spawnSync } from "node:child_process";

import { createTelemetryEvent } from "../telemetry/event.ts";

import { loadConfigContext } from "../cli/config-context.ts";
import type { CliOptions } from "../cli/options.ts";
import { resolveOpPath } from "../cli/paths.ts";
import { classifyOpCommand, resolveOpProfile } from "../cli/profile.ts";
import { writeTelemetry } from "../cli/telemetry.ts";
import { resolveTokenForAccount } from "../cli/token-context.ts";

/**
 * Handles `opchain <identity> op ...` for the current read-safe slice.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runIdentityOp(options: CliOptions): Promise<number> {
  const identityName = options.commandArgs[0];
  const opArgs = options.commandArgs.slice(2);
  const classification = classifyOpCommand(opArgs);

  if (identityName === undefined) {
    process.stderr.write("Missing identity before op command.\n");
    return 1;
  }

  if (
    classification === null &&
    options.accessOverride === undefined &&
    options.explicitProfile === undefined
  ) {
    process.stderr.write(
      "Unsupported op command shape. Explicit profile selection is required.\n",
    );
    return 1;
  }

  const configContext = await loadConfigContext(options);
  if (!configContext.ok) {
    process.stderr.write(`${configContext.error}\n`);
    return 1;
  }

  writeTelemetry(
    options,
    createTelemetryEvent("op.command.classify", {
      classification: classification ?? "explicit_profile",
      command_name: opArgs.slice(0, 2).join(" "),
      identity: identityName,
    }),
  );

  const resolvedProfile = resolveOpProfile(
    configContext.value.config,
    identityName,
    classification ?? "read_safe",
    options.accessOverride,
    options.explicitProfile,
  );
  if (typeof resolvedProfile === "string") {
    process.stderr.write(`${resolvedProfile}\n`);
    return 1;
  }

  const tokenResult = await resolveTokenForAccount(
    options,
    resolvedProfile.accountName,
    options.allowEnvToken,
  );
  if (!tokenResult.ok) {
    process.stderr.write(`${tokenResult.error}\n`);
    return 1;
  }

  writeTelemetry(
    options,
    createTelemetryEvent("op.exec.start", {
      command_name: opArgs.slice(0, 2).join(" "),
      identity: identityName,
      profile: resolvedProfile.profileName,
    }),
  );

  const opResult = spawnSync(resolveOpPath(), opArgs, {
    encoding: "utf8",
    env: {
      ...process.env,
      OP_SERVICE_ACCOUNT_TOKEN: tokenResult.value,
    },
  });

  if (opResult.stdout.length > 0) {
    process.stdout.write(opResult.stdout);
  }

  if (opResult.stderr.length > 0) {
    process.stderr.write(opResult.stderr);
  }

  if (opResult.error) {
    process.stderr.write(`${opResult.error.message}\n`);
    return 1;
  }

  writeTelemetry(
    options,
    createTelemetryEvent("op.exec.finish", {
      command_name: opArgs.slice(0, 2).join(" "),
      exit_code: opResult.status ?? 1,
      identity: identityName,
      profile: resolvedProfile.profileName,
      stderr_bytes: opResult.stderr.length,
      stdout_bytes: opResult.stdout.length,
    }),
  );

  return opResult.status ?? 1;
}
