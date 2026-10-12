import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

type PackResult = {
  readonly name: string;
  readonly files: readonly { readonly path: string }[];
};

const requiredPaths = [
  "package.json",
  "LICENSE",
  "README.md",
  "MIGRATION.md",
  "PACKAGING.md",
  "SECURITY.md",
];
const allowedPaths = new Set([...requiredPaths, "dist/opchain", "dist/oprun"]);

describe("npm package", () => {
  test("contains only distribution files under the public package name", () => {
    const packed = spawnSync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(packed.status).toBe(0);
    const result = JSON.parse(packed.stdout) as readonly PackResult[];
    const packageInfo = result[0];
    expect(packageInfo).toBeDefined();
    if (!packageInfo) throw new Error("npm pack returned no package");
    const paths = packageInfo.files.map((file) => file.path);
    for (const path of paths) expect(allowedPaths.has(path)).toBe(true);
    for (const path of requiredPaths) expect(paths).toContain(path);
    expect(packageInfo.name).toBe("@dungle-scrubs/opchain");
  });
});
