import type { CliOptions } from "./options.ts";
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

type CommandHandler = (options: CliOptions) => Promise<number>;

type CommandRoute = {
  readonly exactLength?: number;
  readonly handler: CommandHandler;
  readonly offset: number;
  readonly subject: readonly [string, ...string[]];
};

const COMMAND_ROUTES: readonly CommandRoute[] = [
  { handler: runIdentityOp, offset: 1, subject: ["op"] },
  {
    exactLength: 2,
    handler: runIdentityList,
    offset: 0,
    subject: ["identity", "list"],
  },
  { exactLength: 1, handler: runDoctor, offset: 0, subject: ["doctor"] },
  { handler: runSecretsList, offset: 1, subject: ["secrets", "list"] },
  { handler: runSecretsCheck, offset: 1, subject: ["secrets", "check"] },
  {
    handler: runSecretsInspect,
    offset: 1,
    subject: ["secrets", "inspect"],
  },
  {
    handler: runSecretsValidate,
    offset: 1,
    subject: ["secrets", "validate"],
  },
  { handler: runExpiresAdd, offset: 1, subject: ["expires", "add"] },
  { handler: runExpiresList, offset: 1, subject: ["expires", "list"] },
  {
    handler: runExpiresRemove,
    offset: 1,
    subject: ["expires", "remove"],
  },
  { handler: runExpiresScan, offset: 1, subject: ["expires", "scan"] },
  { handler: runTokenSet, offset: 0, subject: ["token", "set"] },
  { handler: runTokenRemove, offset: 0, subject: ["token", "remove"] },
  { handler: runMigrateV1, offset: 0, subject: ["migrate-v1"] },
];

/**
 * Checks whether parsed command tokens match one command route.
 *
 * @param commandArgs - Parsed command tokens.
 * @param route - Candidate command route.
 * @returns {boolean} True when the route matches the current command.
 */
function matchesRoute(
  commandArgs: readonly string[],
  route: CommandRoute,
): boolean {
  if (route.exactLength !== undefined && commandArgs.length !== route.exactLength) {
    return false;
  }

  if (commandArgs.length < route.offset + route.subject.length) {
    return false;
  }

  return route.subject.every(
    (token, index) => commandArgs[route.offset + index] === token,
  );
}

/**
 * Finds the handler for the current parsed command tokens.
 *
 * @param options - Parsed CLI options.
 * @returns {CommandHandler | null} Matching command handler or null when unsupported.
 */
export function findCommandHandler(options: CliOptions): CommandHandler | null {
  const route = COMMAND_ROUTES.find((candidate) =>
    matchesRoute(options.commandArgs, candidate),
  );

  return route?.handler ?? null;
}
