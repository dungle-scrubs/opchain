import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHomeConfig } from "../helpers/write-opchain-config.ts";

describe("secrets list", () => {
  test("lists unique op:// refs from a .env.op file", () => {
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
      [
        "OPENAI_API_KEY=op://Services/OpenAI/api-key",
        'ANTHROPIC_API_KEY="op://Models/Anthropic/api-key"',
        "DUPLICATE=op://Services/OpenAI/api-key",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "secrets", "list", envOpPath],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `${["op://Services/OpenAI/api-key", "op://Models/Anthropic/api-key"].join(
        "\n",
      )}
`,
    );
    expect(result.stderr).toBe("");
  });
});
