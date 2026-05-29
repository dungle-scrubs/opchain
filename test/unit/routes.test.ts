import { describe, expect, test } from "bun:test";

import { findCommandDispatch } from "../../src/cli/routes.ts";
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

describe("findCommandDispatch", () => {
  test("matches identity-scoped op commands by offset", () => {
    const dispatch = findCommandDispatch(
      createCliOptions(["human", "op", "vault", "list"]),
    );

    expect(dispatch?.handler).toBe(runIdentityOp);
    expect(dispatch?.request).toMatchObject({
      identityName: "human",
      kind: "identity",
      trailingArgs: ["vault", "list"],
    });
  });

  test("matches exact-length identity list commands only", () => {
    const dispatch = findCommandDispatch(
      createCliOptions(["identity", "list"]),
    );
    const extraArgDispatch = findCommandDispatch(
      createCliOptions(["identity", "list", "extra"]),
    );

    expect(dispatch?.handler).toBe(runIdentityList);
    expect(extraArgDispatch).toBeNull();
  });

  test("matches nested secrets and expires handlers", () => {
    const secretsDispatch = findCommandDispatch(
      createCliOptions(["human", "secrets", "validate"]),
    );
    const expiresDispatch = findCommandDispatch(
      createCliOptions(["human", "expires", "scan"]),
    );

    expect(secretsDispatch?.handler).toBe(runSecretsValidate);
    expect(expiresDispatch?.handler).toBe(runExpiresScan);
  });

  test("matches top-level token and migration handlers", () => {
    const tokenDispatch = findCommandDispatch(
      createCliOptions(["token", "set"]),
    );
    const migrationDispatch = findCommandDispatch(
      createCliOptions(["migrate-v1", "--dry-run"]),
    );

    expect(tokenDispatch?.handler).toBe(runTokenSet);
    expect(migrationDispatch?.handler).toBe(runMigrateV1);
    expect(migrationDispatch?.request).toMatchObject({
      kind: "top",
      trailingArgs: ["--dry-run"],
    });
  });

  test("returns null for unsupported commands", () => {
    const dispatch = findCommandDispatch(
      createCliOptions(["unknown", "command"]),
    );

    expect(dispatch).toBeNull();
  });
});
