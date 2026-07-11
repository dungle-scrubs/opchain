import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("secrets validate", () => {
  test("validates unique refs across the current working directory", () => {
    const repoPath = process.cwd();
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const projectPath = mkdtempSync(join(tmpdir(), "opchain-project-"));
    const nestedProjectPath = join(projectPath, "apps", "demo");
    const securityLogPath = join(homePath, "helper-get-secrets-validate.log");
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
          OPCHAIN_SECURITY_PATH: join(repoPath, "test/fixtures/bin/security"),
          OPCHAIN_OP_PATH: join(repoPath, "test/fixtures/bin/op"),
          OPCHAIN_TEST_SECURITY_TOKEN_LOG: securityLogPath,
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
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
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const projectPath = mkdtempSync(join(tmpdir(), "opchain-project-"));
    const envOpPath = join(projectPath, ".env.op");
    const securityLogPath = join(
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
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const missingPath = join(homePath, "does-not-exist");

    writeHumanConfig(homePath);

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "secrets", "validate", missingPath],
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
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Failed to scan .env.op targets:");
    expect(result.stderr).not.toContain("at runSecretsValidate");
  });

  test("injects only the resolved keychain token into the op read child", () => {
    const repoPath = process.cwd();
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const projectPath = mkdtempSync(join(tmpdir(), "opchain-project-"));
    const opEnvLogPath = join(homePath, "op-read-env.log");

    writeHumanConfig(homePath);
    writeFileSync(
      join(projectPath, ".env.op"),
      ["OPENAI_API_KEY=op://Services/OpenAI/api-key"].join("\n"),
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
          OPCHAIN_SECURITY_PATH: join(repoPath, "test/fixtures/bin/security"),
          OPCHAIN_OP_PATH: join(repoPath, "test/fixtures/bin/op"),
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
          OPCHAIN_TEST_OP_ENV_LOG: opEnvLogPath,
          // An ambient override is present in the parent, but it is only
          // honored with --allow-env-token and must never reach the child.
          OPCHAIN_TOKEN_OVERRIDE: "ambient-override-must-not-leak",
        },
      },
    );

    expect(result.status).toBe(0);
    // The read child receives exactly the resolved keychain token and no
    // ambient override (override= is empty).
    expect(readFileSync(opEnvLogPath, "utf8")).toBe(
      "token=token-for-human-default override=\n",
    );
  });
});
