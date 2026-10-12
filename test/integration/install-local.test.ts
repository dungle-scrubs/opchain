import { describe, expect, test } from "bun:test";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  writeAutoReadConfig,
  writeHumanConfig,
} from "../helpers/write-opchain-config.ts";

describe("install-local", () => {
  test("builds and installs a compiled binary into ~/.local/bin", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const installPath = join(homePath, ".local", "bin", "opchain");
    const oprunInstallPath = join(homePath, ".local", "bin", "oprun");
    const securityPath = join(process.cwd(), "test/fixtures/bin/security");
    const opPath = join(process.cwd(), "test/fixtures/bin/op");
    const opLogPath = join(homePath, "oprun-op.log");

    const installResult = spawnSync(
      "bash",
      [
        "-lc",
        'PATH="$2:$PATH" HOME="$1" bun run install-local',
        "--",
        homePath,
        join(process.cwd(), "test/fixtures/bin"),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(installResult.status).toBe(0);
    expect(installResult.stdout).toContain(
      `Installed opchain to ${installPath}`,
    );
    expect(installResult.stdout).toContain(
      `Installed oprun to ${oprunInstallPath}`,
    );

    const helpResult = spawnSync(installPath, ["--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(helpResult.status).toBe(0);
    expect(helpResult.stdout).toContain("Usage: opchain [options] [command]");
    expect(helpResult.stdout).toContain("migrate-v1");

    writeHumanConfig(homePath);

    const doctorResult = spawnSync(installPath, ["doctor"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homePath,
        OPCHAIN_SECURITY_PATH: securityPath,
      },
    });

    expect(doctorResult.status).toBe(0);
    expect(doctorResult.stdout).toContain("Binary path: ");
    expect(doctorResult.stdout).toContain(".local/bin/opchain");

    writeAutoReadConfig(homePath, { identityName: "primary" });

    const oprunResult = spawnSync(oprunInstallPath, ["npm", "start"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homePath,
        OPCHAIN_SECURITY_PATH: securityPath,
        OPCHAIN_OP_PATH: opPath,
        OPCHAIN_TEST_SECURITY_TOKEN: "token-from-helper",
        OPCHAIN_TEST_OP_LOG: opLogPath,
      },
    });

    expect(oprunResult.status).toBe(0);
    expect(oprunResult.stdout).toContain("run ok");
    expect(readFileSync(opLogPath, "utf8")).toContain(
      "args=run --env-file .env.op -- /usr/bin/env -u OP_SERVICE_ACCOUNT_TOKEN OP_BIOMETRIC_UNLOCK_ENABLED=false npm start",
    );
  });

  test("replaces installed binaries by rename and leaves no staged files", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    mkdirSync(join(homePath, ".local", "bin"), { recursive: true });
    const installPath = join(homePath, ".local", "bin", "opchain");
    writeFileSync(installPath, "old-opchain\n");
    const oldLinkPath = join(homePath, "old-opchain-link");
    linkSync(installPath, oldLinkPath);

    const installResult = spawnSync(
      "bash",
      [
        "-lc",
        'PATH="$2:$PATH" HOME="$1" bun run install-local',
        "--",
        homePath,
        join(process.cwd(), "test/fixtures/bin"),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(installResult.status).toBe(0);
    expect(readFileSync(oldLinkPath, "utf8")).toBe("old-opchain\n");
    expect(statSync(installPath).ino).not.toBe(statSync(oldLinkPath).ino);
    expect(statSync(installPath).mode & 0o111).not.toBe(0);
    expect(
      readdirSync(join(homePath, ".local", "bin")).filter((name) =>
        name.startsWith("."),
      ),
    ).toEqual([]);
  });
});
