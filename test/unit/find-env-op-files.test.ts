import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanEnvOpTargets } from "../../src/secrets/find-env-op-files.ts";

describe("scanEnvOpTargets symlink and ignore gating", () => {
  test("returns only real in-scope files, skipping symlinks and ignored dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "opchain-scan-root-"));
    const outside = mkdtempSync(join(tmpdir(), "opchain-scan-outside-"));

    // Real, in-scope files that must be returned.
    writeFileSync(join(root, ".env.op"), "A=op://Vault/Item/field\n", "utf8");
    const realDirectory = join(root, "realdir");
    mkdirSync(realDirectory);
    writeFileSync(
      join(realDirectory, "nested.env.op"),
      "B=op://Vault/Item/field\n",
      "utf8",
    );

    // Ignored directories: node_modules and .git are never walked.
    const nodeModules = join(root, "node_modules");
    mkdirSync(nodeModules);
    writeFileSync(
      join(nodeModules, ".env.op"),
      "C=op://Vault/Item/field\n",
      "utf8",
    );
    const gitDirectory = join(root, ".git");
    mkdirSync(gitDirectory);
    writeFileSync(
      join(gitDirectory, ".env.op"),
      "D=op://Vault/Item/field\n",
      "utf8",
    );

    // (a) A symlinked subdirectory inside the root must be skipped, so its
    // .env.op is not double-counted through the symlink.
    symlinkSync(realDirectory, join(root, "linked-inside"));

    // (b) A symlink whose target lives outside the root must not be followed.
    writeFileSync(
      join(outside, ".env.op"),
      "E=op://Vault/Item/field\n",
      "utf8",
    );
    symlinkSync(outside, join(root, "linked-outside"));

    const result = scanEnvOpTargets(undefined, root);

    expect([...result.files].sort()).toEqual(
      [join(root, ".env.op"), join(realDirectory, "nested.env.op")].sort(),
    );
    expect(result.warnings).toEqual([]);
  });
});
