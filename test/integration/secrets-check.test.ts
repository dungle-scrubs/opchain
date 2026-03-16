import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHomeConfig } from "../helpers/write-opchain-config.ts";

describe("secrets check", () => {
  test("validates unique refs once per run", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const projectPath = mkdtempSync(join(tmpdir(), "opchain-project-"));
    const envOpPath = join(projectPath, ".env.op");
    const helperGetLogPath = join(homePath, "helper-get-secrets-check.log");
    const opReadLogPath = join(homePath, "op-read.log");

    writeHomeConfig(homePath, {
      identities: {
        human: {
          defaultMode: "default",
          profiles: { default: "opchain:human:default" },
          vaults: ["Human"],
        },
      },
    });
    writeFileSync(
      envOpPath,
      [
        "OPENAI_API_KEY=op://Services/OpenAI/api-key",
        'ANTHROPIC_API_KEY="op://Models/Anthropic/api-key"',
        "DUPLICATE=op://Services/OpenAI/api-key",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "secrets", "check", envOpPath],
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
    expect(readFileSync(helperGetLogPath, "utf8")).toBe(
      `${["service=opchain", "account=opchain:human:default"].join("\n")}
`,
    );
    expect(readFileSync(opReadLogPath, "utf8")).toBe(
      `${["op://Services/OpenAI/api-key", "op://Models/Anthropic/api-key"].join(
        "\n",
      )}
`,
    );
  });

  test("fails closed when op read returns an operational error", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const projectPath = mkdtempSync(join(tmpdir(), "opchain-project-"));
    const envOpPath = join(projectPath, ".env.op");

    writeHomeConfig(homePath, {
      identities: {
        human: {
          defaultMode: "default",
          profiles: { default: "opchain:human:default" },
          vaults: ["Human"],
        },
      },
    });
    writeFileSync(
      envOpPath,
      ["OPENAI_API_KEY=op://Services/OpenAI/api-key"].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "secrets", "check", envOpPath],
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
          OPCHAIN_TEST_OP_READ_EXIT_CODE: "70",
          OPCHAIN_TEST_OP_READ_STDERR: "network error",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("error op://Services/OpenAI/api-key\n");
    expect(result.stderr).toBe("");
  });
});
