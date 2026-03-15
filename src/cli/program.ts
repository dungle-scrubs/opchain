import { Command } from "commander";

/**
 * Builds the `identity` command tree.
 *
 * @returns {Command} Configured identity command.
 */
function buildIdentityCommand(): Command {
  return new Command("identity")
    .description("Identity commands.")
    .addCommand(
      new Command("list").description(
        "List configured identities from config.toml.",
      ),
    );
}

/**
 * Builds the `secrets` command tree.
 *
 * @returns {Command} Configured secrets command.
 */
function buildSecretsCommand(): Command {
  return new Command("secrets")
    .description("Secret-reference commands.")
    .addCommand(
      new Command("list").description("List `op://` refs from a .env.op file."),
    )
    .addCommand(
      new Command("check").description(
        "Validate `op://` refs from a .env.op file.",
      ),
    )
    .addCommand(
      new Command("inspect").description(
        "Inspect metadata for one `op://` reference without printing the secret value.",
      ),
    )
    .addCommand(
      new Command("validate").description(
        "Validate refs across one file or directory of `.env.op` files.",
      ),
    );
}

/**
 * Builds the `expires` command tree.
 *
 * @returns {Command} Configured expires command.
 */
function buildExpiresCommand(): Command {
  return new Command("expires")
    .description("Expiry tracking commands.")
    .addCommand(new Command("add").description("Track one expiring record."))
    .addCommand(
      new Command("remove").description("Remove one tracked expiring record."),
    )
    .addCommand(new Command("list").description("List tracked expiry records."))
    .addCommand(
      new Command("scan").description("Refresh tracked expiry metadata."),
    );
}

/**
 * Builds the `token` command tree.
 *
 * @returns {Command} Configured token command.
 */
function buildTokenCommand(): Command {
  return new Command("token")
    .description("Token commands.")
    .addCommand(
      new Command("set").description(
        "Store a token for an identity/profile using --stdin or a hidden TTY prompt.",
      ),
    )
    .addCommand(
      new Command("remove").description(
        "Remove a token for an identity/profile using --yes or interactive confirmation.",
      ),
    );
}

/**
 * Builds the root command definition used for help rendering.
 *
 * @returns {Command} Configured command instance.
 */
export function buildProgram(): Command {
  return new Command()
    .name("opchain")
    .description(
      "macOS-first 1Password service-account workflows with explicit identities.",
    )
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
    .helpOption("-h, --help", "Display help.")
    .addCommand(buildIdentityCommand())
    .addCommand(buildSecretsCommand())
    .addCommand(buildExpiresCommand())
    .addCommand(buildTokenCommand())
    .addCommand(
      new Command("migrate-v1").description(
        "Plan or apply migration from opchain v1.",
      ),
    )
    .addCommand(
      new Command("doctor").description(
        "Show configured identities, profiles, and vault-scope guidance.",
      ),
    );
}
