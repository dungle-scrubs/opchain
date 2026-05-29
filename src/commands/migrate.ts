import { createTelemetryEvent } from "../telemetry/event.ts";

import type { CommandRequest } from "../cli/command-request.ts";
import { parseFlagArguments } from "../cli/flag-args.ts";
import {
  commandFailure,
  commandSuccess,
  type CommandResult,
} from "../cli/result.ts";
import { writeTelemetry } from "../cli/telemetry.ts";
import { applyMigrationPlan } from "../migrate/apply.ts";
import { buildMigrationPlan } from "../migrate/plan.ts";

const MIGRATE_BOOLEAN_FLAGS = new Set(["--dry-run"]);

type MigrateOptions = {
  readonly dryRun: boolean;
};

/**
 * Parses trailing `migrate-v1` arguments.
 *
 * @param trailingArgs - Arguments after the `migrate-v1` path.
 * @returns {MigrateOptions | string} Parsed options or an error message.
 */
function parseMigrateOptions(
  trailingArgs: readonly string[],
): MigrateOptions | string {
  const parsedArgs = parseFlagArguments(trailingArgs, {
    booleanFlags: MIGRATE_BOOLEAN_FLAGS,
    valueFlags: new Set<string>(),
  });

  if (parsedArgs.unknownOptions.length > 0) {
    return `Unknown migrate-v1 option: ${parsedArgs.unknownOptions[0]}.`;
  }

  if (parsedArgs.positionals.length > 0) {
    return `Unknown migrate-v1 option: ${parsedArgs.positionals[0]}.`;
  }

  return {
    dryRun: parsedArgs.booleanFlags.has("--dry-run"),
  };
}

/**
 * Handles `opchain migrate-v1 --dry-run`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runMigrateV1(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.kind !== "top") {
    return commandFailure("Invalid command shape for migrate-v1.\n");
  }

  const { options } = request;
  const migrateOptions = parseMigrateOptions(request.trailingArgs);
  if (typeof migrateOptions === "string") {
    return commandFailure(`${migrateOptions}\n`);
  }

  const planResult = await buildMigrationPlan(options);
  if (!planResult.ok) {
    return commandFailure(`${planResult.error}\n`);
  }

  writeTelemetry(
    options,
    createTelemetryEvent("migration.plan", {
      expires_record_count: planResult.value.expiresRecordCount,
      legacy_config_found: true,
      mode: migrateOptions.dryRun ? "dry_run" : "apply",
    }),
  );

  if (migrateOptions.dryRun) {
    return commandSuccess(`${planResult.value.outputLines.join("\n")}\n`);
  }

  if (!planResult.value.canApply) {
    return commandFailure(
      `${[
        "migrate-v1 apply requires resolving all legacy expiry records before writing v2 files.",
        ...planResult.value.outputLines,
      ].join("\n")}\n`,
    );
  }

  const applyResult = applyMigrationPlan(planResult.value);
  if (!applyResult.ok) {
    return commandFailure(`${applyResult.error}\n`);
  }

  writeTelemetry(
    options,
    createTelemetryEvent("migration.apply", {
      expires_record_count: planResult.value.trackedItems.length,
      mode: "apply",
      wrote_expires_state: true,
      wrote_v2_config: true,
    }),
  );

  return commandSuccess(
    `${[
      `Applied migration config: ${applyResult.value.v2ConfigPath}`,
      `Applied migration expires: ${applyResult.value.v2ExpiresPath}`,
    ].join("\n")}\n`,
  );
}
