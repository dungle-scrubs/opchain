import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("expires list invalid state", () => {
  test("fails cleanly when the expiry state file is malformed", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const stateDirectoryPath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
    );
    const statePath = join(stateDirectoryPath, "human.json");

    mkdirSync(stateDirectoryPath, { recursive: true });
    writeHumanConfig(homePath);
    writeFileSync(statePath, "{\n", "utf8");

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "expires", "list"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Failed to load expiry state:");
    expect(result.stderr).not.toContain("at runExpiresList");
  });

  test("fails cleanly when valid JSON has an invalid expiry state shape", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const stateDirectoryPath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
    );
    const statePath = join(stateDirectoryPath, "human.json");

    mkdirSync(stateDirectoryPath, { recursive: true });
    writeHumanConfig(homePath);
    writeFileSync(
      statePath,
      `${JSON.stringify({ identity: "human", version: 1 }, null, 2)}\n`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "expires", "list"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Failed to load expiry state:");
    expect(result.stderr).toContain("trackedItems must be an array");
    expect(result.stderr).not.toContain("at runExpiresList");
  });

  test("expires remove fails consistently for malformed but parseable state", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const stateDirectoryPath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
    );
    const statePath = join(stateDirectoryPath, "human.json");

    mkdirSync(stateDirectoryPath, { recursive: true });
    writeHumanConfig(homePath);
    writeFileSync(
      statePath,
      `${JSON.stringify({ identity: "human", version: 1 }, null, 2)}\n`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        "run",
        "src/index.ts",
        "human",
        "expires",
        "remove",
        "vault-uuid-1/item-uuid-1",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homePath,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Failed to load expiry state:");
    expect(result.stderr).toContain("trackedItems must be an array");
    expect(result.stderr).not.toContain("at runExpiresRemove");
  });

  test("expires scan fails consistently for malformed but parseable state", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const stateDirectoryPath = join(
      homePath,
      ".config",
      "opchain",
      "state",
      "expires",
    );
    const statePath = join(stateDirectoryPath, "human.json");

    mkdirSync(stateDirectoryPath, { recursive: true });
    writeHumanConfig(homePath);
    writeFileSync(
      statePath,
      `${JSON.stringify({ identity: "human", version: 1 }, null, 2)}\n`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["run", "src/index.ts", "human", "expires", "scan"],
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
          OPCHAIN_TEST_SECURITY_TOKEN: "token-for-human-default",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Failed to load expiry state:");
    expect(result.stderr).toContain("trackedItems must be an array");
    expect(result.stderr).not.toContain("at runExpiresScan");
  });
});
