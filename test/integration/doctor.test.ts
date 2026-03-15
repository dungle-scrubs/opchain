import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  writeHumanAndKevinConfig,
  writeHumanConfig,
} from "../helpers/write-opchain-config.ts";

describe("doctor", () => {
  test("prints configured identities, profiles, and vault-scope guidance", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    writeHumanAndKevinConfig(homePath, {
      kevinVaults: ["Personal", "Services"],
      kevinWriteAccount: "opchain-v2:kevin:write",
    });

    const helperPath = join(process.cwd(), "test/fixtures/bin/opchain-helper");

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "doctor"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_HELPER_PATH: helperPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Binary path:");
    expect(result.stdout).toContain("Config path:");
    expect(result.stdout).toContain(`Helper path: ${helperPath}`);
    expect(result.stdout).toContain("Helper status: available");
    expect(result.stdout).toContain("kevin");
    expect(result.stdout).toContain("profiles: read, write");
    expect(result.stdout).toContain("human");
    expect(result.stdout).toContain("profiles: default");
    expect(result.stdout).toContain(
      "Configured vaults are a local allowlist, not the primary security boundary.",
    );
    expect(result.stderr).toBe("");
  });

  test("treats a helper found on PATH as available", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-v2-home-"));
    const helperDirectoryPath = join(process.cwd(), "test/fixtures/bin");

    writeHumanConfig(homePath);

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "doctor"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          PATH: `${helperDirectoryPath}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Helper path: opchain-helper");
    expect(result.stdout).toContain("Helper status: available");
    expect(result.stderr).toBe("");
  });
});
