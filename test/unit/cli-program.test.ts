import { describe, expect, test } from "bun:test";
import type { Command } from "commander";

import { buildProgram } from "../../src/cli/program.ts";

/**
 * Returns one named direct child command from the root program.
 *
 * @param name - Command name to find.
 * @returns {ReturnType<typeof buildProgram>["commands"][number]} Matching child command.
 */
function getCommand(name: string): Command {
  const command = buildProgram().commands.find(
    (entry) => entry.name() === name,
  );
  if (command === undefined) {
    throw new Error(`Missing command: ${name}`);
  }

  return command;
}

describe("buildProgram", () => {
  test("builds the expected root command metadata and options", () => {
    const program = buildProgram();

    expect(program.name()).toBe("opchain");
    expect(program.description()).toBe(
      "macOS-first 1Password service-account workflows with explicit identities.",
    );
    expect(program.options.map((option) => option.long)).toEqual([
      "--debug",
      "--debug-format",
      "--profile",
      "--read",
      "--write",
      "--allow-env-token",
    ]);
  });

  test("builds the expected top-level command tree", () => {
    const program = buildProgram();

    expect(program.commands.map((command) => command.name())).toEqual([
      "identity",
      "secrets",
      "expires",
      "token",
      "migrate-v1",
      "doctor",
    ]);
  });

  test("builds the expected nested subcommands", () => {
    expect(
      getCommand("identity").commands.map((command) => command.name()),
    ).toEqual(["list"]);
    expect(
      getCommand("secrets").commands.map((command) => command.name()),
    ).toEqual(["list", "check", "inspect", "validate"]);
    expect(
      getCommand("expires").commands.map((command) => command.name()),
    ).toEqual(["add", "remove", "list", "scan"]);
    expect(
      getCommand("token").commands.map((command) => command.name()),
    ).toEqual(["set", "remove"]);
  });

  test("includes key command descriptions in help output", () => {
    const helpText = buildProgram().helpInformation();

    expect(helpText).toContain("Identity commands.");
    expect(helpText).toContain("Secret-reference commands.");
    expect(helpText).toContain("Expiry tracking commands.");
    expect(helpText).toContain("Token commands.");
    expect(helpText).toContain("Plan or apply migration from opchain v1.");
    expect(helpText).toContain(
      "Show configured identities, profiles, and vault-scope",
    );
    expect(helpText).toContain("guidance.");
  });

  test("documents identity-prefixed command shapes in help output", () => {
    const helpText = buildProgram().helpInformation();

    expect(helpText).toContain(
      "<identity> [--profile <name>|--read|--write] [--allow-env-token] op <args...>",
    );
    expect(helpText).toContain("Identity-scoped commands:");
    expect(helpText).toContain(
      "opchain <identity> secrets <list|check|inspect|validate>",
    );
    expect(helpText).toContain(
      "opchain <identity> expires <add|remove|list|scan>",
    );
    expect(helpText).toContain("Examples:");
    expect(helpText).toContain("opchain human op vault list");
    expect(helpText).toContain(
      "opchain kevin --write op item edit Stripe --vault Services",
    );
  });
});
