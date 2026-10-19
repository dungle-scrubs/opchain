import { describe, expect, test } from "bun:test";

import { runValueRelay } from "../../src/op/relay-run.ts";
import { commandFailure } from "../../src/cli/result.ts";
import { createCliOptions } from "../helpers/create-cli-options.ts";

describe("runValueRelay orchestration", () => {
  test("refuses a non-read path before touching config or tokens", async () => {
    const result = await runValueRelay({
      identityName: "primary",
      kind: "identity",
      options: createCliOptions({
        commandArgs: ["primary", "op", "vault", "list"],
        valueFd: "3",
      }),
      trailingArgs: ["vault", "list"],
    });

    expect(result).toEqual(
      commandFailure("opchain: relay: grammar\n"),
    );
  });

  test("refuses a closed descriptor before config load", async () => {
    // A high descriptor is guaranteed closed regardless of what streams
    // the test runner itself holds open.
    const result = await runValueRelay({
      identityName: "primary",
      kind: "identity",
      options: createCliOptions({
        accessOverride: "read",
        commandArgs: ["primary", "op", "read", "op://V/I/f"],
        valueFd: "97",
      }),
      trailingArgs: ["read", "op://V/I/f"],
    });

    expect(result).toEqual(
      commandFailure("opchain: relay: descriptor-not-open\n"),
    );
  });
});
