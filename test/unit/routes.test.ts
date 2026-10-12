import { describe, expect, test } from "bun:test";

import {
  describeUnmatchedCommand,
  findCommandDispatch,
} from "../../src/cli/routes.ts";
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
    allowReveal: false,
    passToken: false,
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

  test("matches identity list commands and lets handlers reject extra args", () => {
    const dispatch = findCommandDispatch(
      createCliOptions(["identity", "list"]),
    );
    const extraArgDispatch = findCommandDispatch(
      createCliOptions(["identity", "list", "extra"]),
    );

    expect(dispatch?.handler).toBe(runIdentityList);
    expect(dispatch?.request?.trailingArgs).toEqual([]);
    // Extra args are now validated in the handler, not the route matcher
    expect(extraArgDispatch?.handler).toBe(runIdentityList);
    expect(extraArgDispatch?.request?.trailingArgs).toEqual(["extra"]);
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

describe("describeUnmatchedCommand", () => {
  test("names a boolean op-execution flag after the command word", () => {
    expect(
      describeUnmatchedCommand([
        "primary",
        "--pass-token",
        "item-structure",
        "x",
      ]),
    ).toBe(
      "--pass-token applies only to op commands: opchain <identity> --pass-token op <args...>\n",
    );
  });

  test("names the first op-execution flag even before the command word", () => {
    expect(
      describeUnmatchedCommand(["--write", "primary", "token", "list"]),
    ).toBe(
      "--write applies only to op commands: opchain <identity> --write op <args...>\n",
    );
  });

  test("names --profile with its value placeholder", () => {
    expect(
      describeUnmatchedCommand([
        "primary",
        "--profile",
        "read",
        "item-structure",
        "x",
      ]),
    ).toBe(
      "--profile applies only to op commands: opchain <identity> --profile <name> op <args...>\n",
    );
  });

  test("gives a generic reason without echoing arguments", () => {
    const description = describeUnmatchedCommand([
      "primary",
      "bogus",
      "s3cr3t-value",
    ]);

    expect(description).toBe("No command matches these arguments.\n");
    expect(description).not.toContain("s3cr3t-value");
  });

  test("gives a generic reason when the op marker is present", () => {
    expect(describeUnmatchedCommand(["primary", "--read", "op"])).toBe(
      "No command matches these arguments.\n",
    );
  });
});
