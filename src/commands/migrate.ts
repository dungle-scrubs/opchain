import { createTelemetryEvent } from "../telemetry/event.ts";

import { parseCommandPath } from "../cli/command-args.ts";
import { parseFlagArguments } from "../cli/flag-args.ts";
import type { CliOptions } from "../cli/options.ts";
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
export async function runMigrateV1(options: CliOptions): Promise<number> {
  const parsedPath = parseCommandPath(options.commandArgs, ["migrate-v1"]);
  if (!parsedPath.ok) {
    process.stderr.write(`${parsedPath.error}\n`);
    return 1;
  }

  const migrateOptions = parseMigrateOptions(parsedPath.trailingArgs);
  if (typeof migrateOptions === "string") {
    process.stderr.write(`${migrateOptions}\n`);
    return 1;
  }

  const planResult = await buildMigrationPlan(options);
  if (!planResult.ok) {
    process.stderr.write(`${planResult.error}\n`);
    return 1;
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
    process.stdout.write(`${planResult.value.outputLines.join("\n")}\n`);
    return 0;
  }

  if (!planResult.value.canApply) {
    process.stderr.write(
      "migrate-v1 apply requires resolving all legacy expiry records before writing v2 files.\n",
    );
    process.stderr.write(`${planResult.value.outputLines.join("\n")}\n`);
    return 1;
  }

  const applyResult = applyMigrationPlan(planResult.value);
  if (!applyResult.ok) {
    process.stderr.write(`${applyResult.error}\n`);
    return 1;
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

  process.stdout.write(
    `${[
      `Applied migration config: ${applyResult.value.v2ConfigPath}`,
      `Applied migration expires: ${applyResult.value.v2ExpiresPath}`,
    ].join("\n")}\n`,
  );
  return 0;
}
