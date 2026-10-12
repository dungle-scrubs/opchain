import { describe, expect, test } from "bun:test";

import { runCli } from "../helpers/run-cli.ts";

describe("CLI help debug text", () => {
  test("prints help and emits text telemetry", () => {
    const result = runCli(["--debug", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain(
      "<identity> [--profile <name>|--read|--write] [--allow-env-token] [--allow-reveal] [--pass-token] op <args...>",
    );
    expect(result.stdout).toContain("Identity-scoped commands:");
    expect(result.stdout).toContain(
      "--pass-token      Let an op run program see the service-account token (for programs that call op).",
    );
    expect(result.stdout).toContain("opchain human op vault list");
    expect(result.stderr).toContain("cli.start ok");
    expect(result.stderr).not.toContain("SHOULD_NOT_LEAK");
  });
});
