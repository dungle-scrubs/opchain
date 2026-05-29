import type { CommandRequest } from "./command-request.ts";
import type { CommandResult } from "./result.ts";
import { runExpiresAdd } from "../commands/expires-add.ts";
import { runExpiresList } from "../commands/expires-list.ts";
import { runExpiresRemove } from "../commands/expires-remove.ts";
import { runExpiresScan } from "../commands/expires-scan.ts";
import { runDoctor, runIdentityList } from "../commands/identity.ts";
import { runMigrateV1 } from "../commands/migrate.ts";
import { runIdentityOp } from "../commands/op.ts";
import { runSecretsCheck } from "../commands/secrets-check.ts";
import { runSecretsInspect } from "../commands/secrets-inspect.ts";
import { runSecretsList } from "../commands/secrets-list.ts";
import { runSecretsValidate } from "../commands/secrets-validate.ts";
import { runTokenRemove } from "../commands/token-remove.ts";
import { runTokenSet } from "../commands/token-set.ts";

export type CommandHandler = (
  request: CommandRequest,
) => Promise<CommandResult>;

type CliSubcommandDefinition = {
  readonly description: string;
  readonly exactLength?: number;
  readonly handler: CommandHandler;
  readonly name: string;
};

export type CliCommandDefinition =
  | {
      readonly children: readonly CliSubcommandDefinition[];
      readonly description: string;
      readonly examples?: readonly string[];
      readonly identityScoped: boolean;
      readonly includeInTopLevel: boolean;
      readonly invocation: string;
      readonly kind: "group";
      readonly name: string;
    }
  | {
      readonly description: string;
      readonly exactLength?: number;
      readonly examples?: readonly string[];
      readonly identityScoped: boolean;
      readonly includeInTopLevel: boolean;
      readonly invocation?: string;
      readonly kind: "command";
      readonly handler: CommandHandler;
      readonly name: string;
    };

/**
 * Shared CLI manifest used by both help rendering and route dispatch.
 *
 * `includeInTopLevel` controls whether a definition appears in Commander help.
 * Identity-scoped `op` remains hidden from the Commands section because
 * `opchain op ...` is not a valid invocation shape.
 */
export const CLI_COMMAND_DEFINITIONS: readonly CliCommandDefinition[] = [
  {
    children: [
      {
        description: "List configured identities from config.toml.",
        exactLength: 2,
        handler: runIdentityList,
        name: "list",
      },
    ],
    description: "Identity commands.",
    identityScoped: false,
    includeInTopLevel: true,
    invocation: "identity <list>",
    kind: "group",
    name: "identity",
  },
  {
    description: "Execute one 1Password CLI command for the selected identity.",
    examples: [
      "opchain human op vault list",
      "opchain kevin --write op item edit Stripe --vault Services",
    ],
    handler: runIdentityOp,
    identityScoped: true,
    includeInTopLevel: false,
    invocation:
      "<identity> [--profile <name>|--read|--write] [--allow-env-token] op <args...>",
    kind: "command",
    name: "op",
  },
  {
    children: [
      {
        description: "List `op://` refs from a .env.op file.",
        handler: runSecretsList,
        name: "list",
      },
      {
        description: "Validate `op://` refs from a .env.op file.",
        handler: runSecretsCheck,
        name: "check",
      },
      {
        description:
          "Inspect metadata for one `op://` reference without printing the secret value.",
        handler: runSecretsInspect,
        name: "inspect",
      },
      {
        description:
          "Validate refs across one file or directory of `.env.op` files.",
        handler: runSecretsValidate,
        name: "validate",
      },
    ],
    description: "Secret-reference commands.",
    examples: ["opchain human secrets validate"],
    identityScoped: true,
    includeInTopLevel: true,
    invocation:
      "<identity> secrets <list|check|inspect|validate> [path-or-ref]",
    kind: "group",
    name: "secrets",
  },
  {
    children: [
      {
        description: "Track one expiring record.",
        handler: runExpiresAdd,
        name: "add",
      },
      {
        description: "Remove one tracked expiring record.",
        handler: runExpiresRemove,
        name: "remove",
      },
      {
        description: "List tracked expiry records.",
        handler: runExpiresList,
        name: "list",
      },
      {
        description: "Refresh tracked expiry metadata.",
        handler: runExpiresScan,
        name: "scan",
      },
    ],
    description: "Expiry tracking commands.",
    examples: ["opchain human expires scan"],
    identityScoped: true,
    includeInTopLevel: true,
    invocation: "<identity> expires <add|remove|list|scan> [args...]",
    kind: "group",
    name: "expires",
  },
  {
    children: [
      {
        description:
          "Store a token for an identity/profile using --stdin or a hidden TTY prompt.",
        handler: runTokenSet,
        name: "set",
      },
      {
        description:
          "Remove a token for an identity/profile using --yes or interactive confirmation.",
        handler: runTokenRemove,
        name: "remove",
      },
    ],
    description: "Token commands.",
    identityScoped: false,
    includeInTopLevel: true,
    invocation: "token <set|remove>",
    kind: "group",
    name: "token",
  },
  {
    description: "Plan or apply migration from opchain v1.",
    handler: runMigrateV1,
    identityScoped: false,
    includeInTopLevel: true,
    kind: "command",
    name: "migrate-v1",
  },
  {
    description:
      "Show configured identities, profiles, and vault-scope guidance.",
    exactLength: 1,
    handler: runDoctor,
    identityScoped: false,
    includeInTopLevel: true,
    kind: "command",
    name: "doctor",
  },
] as const;
