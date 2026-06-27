import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

type OprunConfig = {
  readonly envFile: string;
  readonly identity: string;
  readonly opchainBin: string;
  readonly profile: string;
};

/**
 * Returns a non-empty environment override or a default value.
 *
 * @param name - Environment variable name.
 * @param fallback - Default value when the variable is unset or empty.
 * @returns Resolved value.
 */
function readEnvOrDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? fallback : value;
}

/**
 * Resolves the sibling `opchain` binary when `oprun` is compiled and installed.
 *
 * @returns Executable path or PATH lookup name for opchain.
 */
function resolveOpchainBin(): string {
  const override = process.env.OPCHAIN_BIN;
  if (override !== undefined && override.length > 0) {
    return override;
  }

  const siblingPath = join(dirname(process.execPath), "opchain");
  return existsSync(siblingPath) ? siblingPath : "opchain";
}

/**
 * Reads wrapper configuration from environment variables.
 *
 * @returns Oprun runtime configuration.
 */
function readConfig(): OprunConfig {
  return {
    envFile: readEnvOrDefault("OPRUN_ENV_FILE", ".env.op"),
    identity: readEnvOrDefault("OPRUN_IDENTITY", "primary"),
    opchainBin: resolveOpchainBin(),
    profile: readEnvOrDefault("OPRUN_PROFILE", "read"),
  };
}

/**
 * Renders help text for the companion env-runner.
 *
 * @returns Help text.
 */
function buildHelpText(): string {
  return [
    "Usage: oprun <command> [args...]",
    "",
    "Run a command through `opchain <identity> --profile <profile> op run`.",
    "",
    "Defaults:",
    "  identity: primary",
    "  profile: read",
    "  env file: .env.op",
    "",
    "Environment overrides:",
    "  OPRUN_IDENTITY   Identity name. Default: primary",
    "  OPRUN_PROFILE    Profile name. Default: read",
    "  OPRUN_ENV_FILE   Env template path. Default: .env.op",
    "  OPCHAIN_BIN      opchain executable path. Default: sibling opchain or PATH lookup",
    "",
    "Examples:",
    "  oprun npm start",
    "  oprun pnpm dev",
    "  OPRUN_ENV_FILE=.env.production.op oprun bun start",
  ].join("\n");
}

/**
 * Runs opchain's `op run` wrapper with inherited stdio.
 *
 * @param argv - Command arguments after the `oprun` executable.
 * @returns Process exit code.
 */
export function runOprun(argv: readonly string[]): number {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`${buildHelpText()}\n`);
    return 0;
  }

  const config = readConfig();
  const result = spawnSync(
    config.opchainBin,
    [
      config.identity,
      "--profile",
      config.profile,
      "op",
      "run",
      "--env-file",
      config.envFile,
      "--",
      ...argv,
    ],
    {
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error !== undefined) {
    process.stderr.write(`Failed to start opchain: ${result.error.message}\n`);
    return 1;
  }

  if (result.signal !== null) {
    process.stderr.write(`opchain exited from signal ${result.signal}.\n`);
    return 1;
  }

  return result.status ?? 1;
}

if (import.meta.main) {
  process.exit(runOprun(Bun.argv.slice(2)));
}
