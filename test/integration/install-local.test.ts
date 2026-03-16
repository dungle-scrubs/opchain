import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { writeHumanConfig } from "../helpers/write-opchain-config.ts";

describe("install-local", () => {
  test("builds and installs a compiled binary into ~/.local/bin", () => {
    const homePath = mkdtempSync(join(tmpdir(), "opchain-home-"));
    const installPath = join(homePath, ".local", "bin", "opchain");
    const helperPath = join(process.cwd(), "test/fixtures/bin/opchain-helper");

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
        OPCHAIN_HELPER_PATH: helperPath,
      },
    });

    expect(doctorResult.status).toBe(0);
    expect(doctorResult.stdout).toContain("Binary path: ");
    expect(doctorResult.stdout).toContain(".local/bin/opchain");
    expect(doctorResult.stdout).toContain(`Helper path: ${helperPath}`);
    expect(doctorResult.stdout).toContain("Helper status: available");
  });
});
