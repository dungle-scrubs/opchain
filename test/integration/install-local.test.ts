import { describe, expect, test } from "bun:test";
import { readFileSync, mkdtempSync } from "node:fs";
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
      ["-lc", 'HOME="$1" bun run install-local', "--", homePath],
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
      "args=run --env-file .env.op -- npm start",
    );
  });
});
