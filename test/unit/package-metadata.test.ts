import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type PackageJson = {
  readonly bin?: Record<string, string>;
  readonly cpu?: readonly string[];
  readonly os?: readonly string[];
  readonly publishConfig?: { readonly access?: string };
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly files?: readonly string[];
  readonly license?: string;
  readonly name?: string;
  readonly private?: boolean;
  readonly repository?: {
    readonly type?: string;
    readonly url?: string;
  };
  readonly version?: string;
};

describe("package metadata", () => {
  test("declares public release metadata with an open-source license", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.name).toBe("@dungle-scrubs/opchain");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/dungle-scrubs/opchain.git",
    });
    expect(packageJson.bin).toEqual({
      opchain: "dist/opchain",
      oprun: "dist/oprun",
    });
    expect(packageJson.os).toEqual(["darwin"]);
    expect(packageJson.cpu).toEqual(["arm64"]);
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.devDependencies?.commander).toBeDefined();
    expect(packageJson.devDependencies?.toml).toBeDefined();
    expect(packageJson.files).toEqual([
      "dist/opchain",
      "dist/oprun",
      "README.md",
      "MIGRATION.md",
      "PACKAGING.md",
      "SECURITY.md",
    ]);
  });
});
