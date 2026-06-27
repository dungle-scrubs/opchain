import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type PackageJson = {
  readonly bin?: Record<string, string>;
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

    expect(packageJson.name).toBe("opchain");
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
    expect(packageJson.files).toEqual([
      "dist/",
      "README.md",
      "MIGRATION.md",
      "PACKAGING.md",
      "SECURITY.md",
    ]);
  });
});
