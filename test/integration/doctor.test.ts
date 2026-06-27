import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  writeHumanAndPrimaryConfig,
  writeHumanConfig,
} from "../helpers/write-opchain-config.ts";

describe("doctor", () => {
  test("prints configured identities, profiles, and vault-scope guidance", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    writeHumanAndPrimaryConfig(homePath, {
      primaryVaults: ["Personal", "Services"],
      primaryWriteAccount: "opchain:primary:write",
    });

    const securityPath = join(process.cwd(), "test/fixtures/bin/security");

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "doctor"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
          OPCHAIN_SECURITY_PATH: securityPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Binary path:");
    expect(result.stdout).toContain("Config path:");
    expect(result.stdout).toContain("primary");
    expect(result.stdout).toContain("profiles: read, write");
    expect(result.stdout).toContain("human");
    expect(result.stdout).toContain("profiles: default");
    expect(result.stdout).toContain(
      "Configured vaults are a local allowlist, not the primary security boundary.",
    );
    expect(result.stderr).toBe("");
  });

  test("treats a helper found on PATH as available", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
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
    expect(result.stderr).toBe("");
  });
});
