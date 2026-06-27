import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("secrets validate --project-wide", () => {
  test("scans projects_dir when explicitly requested", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const projectsDirPath = mkdtempSync(join(tmpdir(), "opchain-projects-"));
    const securityLogPath = join(homePath, "helper-get-project-wide.log");
    const opReadLogPath = join(homePath, "op-project-wide.log");

    writeHumanConfig(homePath, { projectsDir: projectsDirPath });
    mkdirSync(join(projectsDirPath, "alpha"), { recursive: true });
    mkdirSync(join(projectsDirPath, "beta", "apps", "web"), {
      recursive: true,
    });
    writeFileSync(
      join(projectsDirPath, "alpha", ".env.op"),
      "A=op://Services/OpenAI/api-key\n",
      "utf8",
    );
    writeFileSync(
      join(projectsDirPath, "beta", "apps", "web", ".env.op"),
      "B=op://Models/Anthropic/api-key\n",
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "secrets", "validate", "--project-wide"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_SECURITY_PATH: join(
            process.cwd(),
            "test/fixtures/bin/security",
          ),
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
          OPCHAIN_TEST_OP_READ_LOG: opReadLogPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n").sort()).toEqual([
      "ok op://Models/Anthropic/api-key",
      "ok op://Services/OpenAI/api-key",
    ]);
    expect(result.stderr).toBe("");
    expect(
      readFileSync(opReadLogPath, "utf8").trim().split("\n").sort(),
    ).toEqual([
      "op://Models/Anthropic/api-key",
      "op://Services/OpenAI/api-key",
    ]);
  });
});
