import { describe, expect, test } from "bun:test";

import { findCommandHandler } from "../../src/cli/routes.ts";
import type { CliOptions } from "../../src/cli/options.ts";
import { runExpiresScan } from "../../src/commands/expires-scan.ts";
import { runIdentityList } from "../../src/commands/identity.ts";
import { runMigrateV1 } from "../../src/commands/migrate.ts";
import { runIdentityOp } from "../../src/commands/op.ts";
import { runSecretsValidate } from "../../src/commands/secrets-validate.ts";
import { runTokenSet } from "../../src/commands/token-set.ts";

/**
 * Creates one minimal CLI options object for route tests.
 *
 * @param commandArgs - Parsed command tokens.
 * @returns {CliOptions} Stable CLI options fixture.
 */
function createCliOptions(commandArgs: readonly string[]): CliOptions {
  return {
    accessOverride: undefined,
    allowEnvToken: false,
    commandArgs,
    debug: false,
    debugFormat: "text",
    explicitProfile: undefined,
    help: false,
  };
}

describe("findCommandHandler", () => {
  test("matches identity-scoped op commands by offset", () => {
    const handler = findCommandHandler(
      createCliOptions(["human", "op", "vault", "list"]),
    );

    expect(handler).toBe(runIdentityOp);
  });

  test("matches exact-length identity list commands only", () => {
    const handler = findCommandHandler(createCliOptions(["identity", "list"]));
    const extraArgHandler = findCommandHandler(
      createCliOptions(["identity", "list", "extra"]),
    );

    expect(handler).toBe(runIdentityList);
    expect(extraArgHandler).toBeNull();
  });

  test("matches nested secrets and expires handlers", () => {
    const secretsHandler = findCommandHandler(
      createCliOptions(["human", "secrets", "validate"]),
    );
    const expiresHandler = findCommandHandler(
      createCliOptions(["human", "expires", "scan"]),
    );

    expect(secretsHandler).toBe(runSecretsValidate);
    expect(expiresHandler).toBe(runExpiresScan);
  });

  test("matches top-level token and migration handlers", () => {
    const tokenHandler = findCommandHandler(createCliOptions(["token", "set"]));
    const migrationHandler = findCommandHandler(
      createCliOptions(["migrate-v1", "--dry-run"]),
    );

    expect(tokenHandler).toBe(runTokenSet);
    expect(migrationHandler).toBe(runMigrateV1);
  });

  test("returns null for unsupported commands", () => {
    const handler = findCommandHandler(createCliOptions(["unknown", "command"]));

    expect(handler).toBeNull();
  });
});
