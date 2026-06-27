import { describe, expect, test } from "bun:test";

import { runCli } from "../helpers/run-cli.ts";

describe("migrate-v1 invalid option", () => {
  test("fails cleanly for unknown trailing options", () => {
    const result = runCli(["migrate-v1", "--bogus"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Unknown migrate-v1 option: --bogus.\n");
  });
});
