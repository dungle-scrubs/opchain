import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("secrets validate .env warning", () => {
  test("warns when a scanned directory contains .env but not .env.op", () => {
    const repoPath = process.cwd();
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const projectPath = mkdtempSync(join(tmpdir(), "opchain-v2-project-"));
    const appPath = join(projectPath, "apps", "demo");

    writeHumanConfig(homePath);
    mkdirSync(appPath, { recursive: true });
    writeFileSync(
      join(projectPath, ".env.op"),
      "A=op://Services/OpenAI/api-key\n",
      "utf8",
    );
    writeFileSync(join(appPath, ".env"), "A=plaintext\n", "utf8");

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
          OPCHAIN_TEST_HELPER_TOKEN: "token-for-human-default",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("ok op://Services/OpenAI/api-key\n");
    expect(result.stderr).toContain("warning ");
    expect(result.stderr).toContain(
      `${join("apps", "demo", ".env")}: .env.op is preferred for secret references.`,
    );
  });
});
