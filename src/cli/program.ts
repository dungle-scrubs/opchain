import { Command } from "commander";

import {
  CLI_COMMAND_DEFINITIONS,
  type CliCommandDefinition,
} from "./manifest.ts";

/**
 * Builds the multiline root usage block from identity-scoped command metadata.
 *
 * @returns {string} Root usage text.
 */
function buildRootUsage(): string {
  const usageLines = CLI_COMMAND_DEFINITIONS.filter(
    (definition) => definition.identityScoped,
  ).map((definition) => `       ${definition.invocation ?? definition.name}`);

  return ["[options] [command]", ...usageLines].join("\n");
}

/**
 * Collects unique identity-scoped examples in manifest order.
 *
 * @returns {readonly string[]} Example command lines.
 */
function collectIdentityExamples(): readonly string[] {
  const seen = new Set<string>();
  const examples: string[] = [];

  for (const definition of CLI_COMMAND_DEFINITIONS) {
    for (const example of definition.examples ?? []) {
      if (seen.has(example)) {
        continue;
      }

      seen.add(example);
      examples.push(example);
    }
  }

  return examples;
}

/**
 * Builds the identity-scoped help appendix from shared manifest data.
 *
 * @returns {string} Help appendix text.
 */
function buildIdentityHelpText(): string {
  const commandLines = CLI_COMMAND_DEFINITIONS.filter(
    (definition) => definition.identityScoped,
  ).map(
    (definition) => `  opchain ${definition.invocation ?? definition.name}`,
  );
  const exampleLines = collectIdentityExamples().map(
    (example) => `  ${example}`,
  );

  return [
    "Identity-scoped commands:",
    ...commandLines,
    "",
    "Examples:",
    ...exampleLines,
  ].join("\n");
}

/**
 * Builds one top-level Commander command from one manifest definition.
 *
 * @param definition - Shared command definition.
 * @returns {Command | null} Commander command or null when hidden.
 */
function buildTopLevelCommand(
  definition: CliCommandDefinition,
): Command | null {
  if (!definition.includeInTopLevel) {
    return null;
  }

  const description = definition.identityScoped
    ? `${definition.description} Invoke as: opchain ${definition.invocation}`
    : definition.description;

  if (definition.kind === "command") {
    return new Command(definition.name).description(description);
  }

  return definition.children.reduce(
    (command, child) =>
      command.addCommand(
        new Command(child.name).description(child.description),
      ),
    new Command(definition.name).description(description),
  );
}

/**
 * Builds the root command definition used for help rendering.
 *
 * @returns {Command} Configured command instance.
 */
export function buildProgram(): Command {
  const program = new Command()
    .name("opchain")
    .description(
      "macOS-first 1Password service-account workflows with explicit identities.",
    )
    .usage(buildRootUsage())
    .option("--debug", "Emit local redacted debug telemetry to stderr.")
    .option(
      "--debug-format <format>",
      "Select the debug telemetry format: text or json.",
      "text",
    )
    .option(
      "--profile <name>",
      "Force an explicitly named profile for op execution.",
    )
    .option("--read", "Force the read profile for op execution.")
    .option("--write", "Force the write profile for op execution.")
    .option(
      "--allow-env-token",
      "Allow OPCHAIN_TOKEN_OVERRIDE for this invocation.",
    )
    .helpOption("-h, --help", "Display help.");

  for (const definition of CLI_COMMAND_DEFINITIONS) {
    const command = buildTopLevelCommand(definition);
    if (command === null) {
      continue;
    }

    program.addCommand(command);
  }

  const renderHelp = program.helpInformation.bind(program);
  program.helpInformation = (): string =>
    `${renderHelp()}\n${buildIdentityHelpText()}\n`;
  return program;
}
