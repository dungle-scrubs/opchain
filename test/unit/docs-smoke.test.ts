import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readDoc(fileName: string): string {
  return readFileSync(join(process.cwd(), fileName), "utf8");
}

describe("documentation smoke checks", () => {
  test("README states the core value and contains no V2 branding", () => {
    const readme = readDoc("README.md");

    expect(readme).not.toContain("opchainV2");
    expect(readme).toContain("Apple Keychain");
    expect(readme).toContain("never sees the token value");
  });

  test("README provides install, config, and run steps in quick start", () => {
    const readme = readDoc("README.md");

    expect(readme).toContain("git clone");
    expect(readme).toContain("~/.config/opchain/config.toml");
    expect(readme).toContain("opchain primary op vault list");
  });

  test("README does not contain implementation trivia", () => {
    const readme = readDoc("README.md");

    expect(readme).not.toContain("Bun + TypeScript project baseline");
    expect(readme).not.toContain("Biome 2.4.7");
    expect(readme).not.toContain("Implemented so far:");
    expect(readme).not.toContain("Current repository contents:");
    expect(readme).not.toContain("Hard rules for implementation");
    expect(readme).not.toContain("Read order");
    expect(readme).not.toContain("Still planned:");
  });

  test("security and packaging docs contain no V2 branding", () => {
    const security = readDoc("SECURITY.md");
    const packaging = readDoc("PACKAGING.md");

    expect(security).not.toContain("opchainV2");
    expect(security).toContain(
      "Provider subprocess environments are sanitized",
    );
    expect(packaging).not.toContain("opchainV2");
    expect(packaging).toContain("release-readiness review");
    expect(packaging).not.toContain("helper versus");
  });
});
