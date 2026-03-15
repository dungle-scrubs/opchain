import { createTelemetryEvent } from "../telemetry/event.ts";

import type { CliOptions } from "../cli/options.ts";
import { writeTelemetry } from "../cli/telemetry.ts";
import { applyMigrationPlan } from "../migrate/apply.ts";
import { buildMigrationPlan } from "../migrate/plan.ts";

/**
 * Handles `opchain migrate-v1 --dry-run`.
 *
 * @param options - Parsed CLI options.
 * @returns {Promise<number>} Process exit code.
 */
export async function runMigrateV1(options: CliOptions): Promise<number> {
  const isDryRun = options.commandArgs.includes("--dry-run");
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
      mode: isDryRun ? "dry_run" : "apply",
    }),
  );

  if (isDryRun) {
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
