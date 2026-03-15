const DEBUG_FORMATS = ["json", "text"] as const;

export type DebugFormat = (typeof DEBUG_FORMATS)[number];

export type AccessOverride = "read" | "write";

export type CliOptions = {
  readonly accessOverride: AccessOverride | undefined;
  readonly allowEnvToken: boolean;
  readonly commandArgs: readonly string[];
  readonly debug: boolean;
  readonly debugFormat: DebugFormat;
  readonly explicitProfile: string | undefined;
  readonly help: boolean;
};

/**
 * Parses the current CLI options and strips handled global flags.
 *
 * @param argv - User-provided CLI arguments.
 * @returns {CliOptions} Parsed CLI options.
 */
export function parseCliOptions(argv: readonly string[]): CliOptions {
  const debugFormatIndex = argv.indexOf("--debug-format");
  const debugFormatValue =
    debugFormatIndex >= 0 ? argv[debugFormatIndex + 1] : undefined;
  const debugFormat = DEBUG_FORMATS.includes(debugFormatValue as DebugFormat)
    ? (debugFormatValue as DebugFormat)
    : "text";
  const opIndex = argv.indexOf("op");

  const profileIndex =
    opIndex > 0 ? argv.slice(0, opIndex).indexOf("--profile") : -1;
  const explicitProfile =
    profileIndex >= 0 ? argv[profileIndex + 1] : undefined;

  return {
    accessOverride:
      opIndex > 0 && argv.slice(0, opIndex).includes("--write")
        ? "write"
        : opIndex > 0 && argv.slice(0, opIndex).includes("--read")
          ? "read"
          : undefined,
    allowEnvToken:
      opIndex > 0 && argv.slice(0, opIndex).includes("--allow-env-token"),
    commandArgs: stripGlobalOptions(argv),
    debug: argv.includes("--debug"),
    debugFormat,
    explicitProfile,
    help: argv.includes("--help") || argv.includes("-h") || argv.length === 0,
  };
}

/**
 * Removes handled global flags so command dispatch sees only command tokens.
 *
 * @param argv - User-provided CLI arguments.
 * @returns {readonly string[]} Command tokens after global option removal.
 */
function stripGlobalOptions(argv: readonly string[]): readonly string[] {
  const commandArgs: string[] = [];
  const opIndex = argv.indexOf("op");

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === undefined) {
      continue;
    }

    if (token === "--debug" || token === "--help" || token === "-h") {
      continue;
    }

    if (token === "--debug-format") {
      index += 1;
      continue;
    }

    if (
      opIndex > 0 &&
      index < opIndex &&
      (token === "--read" ||
        token === "--write" ||
        token === "--allow-env-token")
    ) {
      continue;
    }

    if (opIndex > 0 && index < opIndex && token === "--profile") {
      index += 1;
      continue;
    }

    commandArgs.push(token);
  }

  return commandArgs;
}
