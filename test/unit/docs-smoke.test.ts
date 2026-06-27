import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readDoc(fileName: string): string {
  return readFileSync(join(process.cwd(), fileName), "utf8");
}

describe("documentation smoke checks", () => {
  test("README does not contain stale repository or command-surface claims", () => {
    const readme = readDoc("README.md");

    expect(readme).not.toContain("this folder is not a Git repo yet");
    expect(readme).toContain("opchain <identity> --profile <name> op ...");
    expect(readme).toContain("opchain <identity> --read op ...");
    expect(readme).toContain("opchain <identity> --allow-env-token op ...");
    expect(readme).not.toContain("Still planned:");
  });

  test("security and release docs reflect current runtime behavior", () => {
    const security = readDoc("SECURITY.md");
    const packaging = readDoc("PACKAGING.md");

    expect(security).not.toContain(
      "most security-sensitive behavior is still planned",
    );
    expect(security).toContain(
      "Provider subprocess environments are sanitized",
    );
    expect(packaging).toContain("release-readiness review");
  });
});
