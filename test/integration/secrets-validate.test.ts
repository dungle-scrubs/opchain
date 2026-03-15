import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("secrets validate", () => {
  test("validates unique refs across the current working directory", () => {
    const repoPath = process.cwd();
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const projectPath = mkdtempSync(join(tmpdir(), "opchain-v2-project-"));
    const nestedProjectPath = join(projectPath, "apps", "demo");
    const helperGetLogPath = join(homePath, "helper-get-secrets-validate.log");
    const opReadLogPath = join(homePath, "op-validate.log");

    writeHumanConfig(homePath);
    mkdirSync(nestedProjectPath, { recursive: true });
    writeFileSync(
      join(projectPath, ".env.op"),
      [
        "OPENAI_API_KEY=op://Services/OpenAI/api-key",
        "DUPLICATE=op://Services/OpenAI/api-key",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(nestedProjectPath, ".env.op"),
      ['ANTHROPIC_API_KEY="op://Models/Anthropic/api-key"'].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", join(repoPath, "src/index.ts"), "human", "secrets", "validate"],
      {
        cwd: projectPath,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_HELPER_PATH: join(
            repoPath,
            "test/fixtures/bin/opchain-helper",
          ),
          OPCHAIN_OP_PATH: join(repoPath, "test/fixtures/bin/op"),
          OPCHAIN_TEST_HELPER_GET_LOG: helperGetLogPath,
          OPCHAIN_TEST_HELPER_TOKEN: "token-for-human-default",
          OPCHAIN_TEST_OP_READ_LOG: opReadLogPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `${[
        "ok op://Services/OpenAI/api-key",
        "ok op://Models/Anthropic/api-key",
      ].join("\n")}
`,
    );
    expect(result.stderr).toBe("");
    expect(readFileSync(opReadLogPath, "utf8")).toBe(
      `${["op://Services/OpenAI/api-key", "op://Models/Anthropic/api-key"].join(
        "\n",
      )}
`,
    );
  });

  test("validates only the explicit file path when one is provided", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const projectPath = mkdtempSync(join(tmpdir(), "opchain-v2-project-"));
    const envOpPath = join(projectPath, ".env.op");
    const helperGetLogPath = join(
      homePath,
      "helper-get-secrets-validate-file.log",
    );
    const opReadLogPath = join(homePath, "op-validate-file.log");

    writeHumanConfig(homePath);
    writeFileSync(
      envOpPath,
      [
        "OPENAI_API_KEY=op://Services/OpenAI/api-key",
        'ANTHROPIC_API_KEY="op://Models/Anthropic/api-key"',
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "secrets", "validate", envOpPath],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_HELPER_PATH: join(
            process.cwd(),
            "test/fixtures/bin/opchain-helper",
          ),
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_HELPER_GET_LOG: helperGetLogPath,
          OPCHAIN_TEST_HELPER_TOKEN: "token-for-human-default",
          OPCHAIN_TEST_OP_READ_LOG: opReadLogPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `${[
        "ok op://Services/OpenAI/api-key",
        "ok op://Models/Anthropic/api-key",
      ].join("\n")}
`,
    );
    expect(result.stderr).toBe("");
    expect(readFileSync(opReadLogPath, "utf8")).toBe(
      `${["op://Services/OpenAI/api-key", "op://Models/Anthropic/api-key"].join(
        "\n",
      )}
`,
    );
  });

  test("fails cleanly when the explicit scan target does not exist", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const missingPath = join(homePath, "does-not-exist");

    writeHumanConfig(homePath);

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "human",
        "secrets",
        "validate",
        missingPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_HELPER_PATH: join(
            process.cwd(),
            "test/fixtures/bin/opchain-helper",
          ),
          OPCHAIN_OP_PATH: join(process.cwd(), "test/fixtures/bin/op"),
          OPCHAIN_TEST_HELPER_TOKEN: "token-for-human-default",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Failed to scan .env.op targets:");
    expect(result.stderr).not.toContain("at runSecretsValidate");
  });
});
