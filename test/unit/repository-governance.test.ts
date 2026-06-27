import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("repository governance", () => {
  test("configures Dependabot for GitHub Actions and npm ecosystem", () => {
    const dependabotPath = join(process.cwd(), ".github", "dependabot.yml");

    expect(existsSync(dependabotPath)).toBe(true);

    const dependabotConfig = readFileSync(dependabotPath, "utf8");
    expect(dependabotConfig).toContain('package-ecosystem: "github-actions"');
    expect(dependabotConfig).toContain('package-ecosystem: "npm"');
    expect(dependabotConfig).toContain('directory: "/"');
  });

  test("hardens CI with explicit permissions and concurrency", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "ci.yml"),
      "utf8",
    );

    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("concurrency:");
    expect(workflow).toContain("cancel-in-progress: true");
  });

  test("documents release automation and manual GitHub settings status", () => {
    const readinessDoc = readFileSync(
      join(process.cwd(), "RELEASE_READINESS.md"),
      "utf8",
    );

    expect(readinessDoc).toContain("Release automation");
    expect(readinessDoc).toContain("intentionally deferred");
    expect(readinessDoc).toContain("Manual GitHub Settings");
    expect(readinessDoc).toContain("secret scanning");
    expect(readinessDoc).toContain("branch protection");
  });

  test("keeps RELEASE_READINESS.md and DEPENDENCY_AUDIT.md tracked", () => {
    expect(existsSync(join(process.cwd(), "RELEASE_READINESS.md"))).toBe(true);
    expect(existsSync(join(process.cwd(), "DEPENDENCY_AUDIT.md"))).toBe(true);
  });

  test("provides community contributor files", () => {
    const contributing = readFileSync(
      join(process.cwd(), "CONTRIBUTING.md"),
      "utf8",
    );
    expect(contributing).toContain("bun install --frozen-lockfile");
    expect(contributing).toContain("SECURITY.md");
    expect(contributing).toContain("TDD");

    expect(existsSync(join(process.cwd(), "CODE_OF_CONDUCT.md"))).toBe(true);
  });

  test("provides a changelog with an Unreleased baseline", () => {
    const changelog = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");

    expect(changelog).toContain("## Unreleased");
    expect(changelog).toContain("opchain doctor");
    expect(changelog).toContain("### Security");
    expect(changelog).toContain("Sanitized provider subprocess environments");
  });

  test("includes issue and pull request templates with security prompts", () => {
    expect(
      existsSync(join(process.cwd(), ".github", "ISSUE_TEMPLATE", "bug.md")),
    ).toBe(true);
    expect(
      existsSync(
        join(process.cwd(), ".github", "ISSUE_TEMPLATE", "feature.md"),
      ),
    ).toBe(true);

    const prTemplate = readFileSync(
      join(process.cwd(), ".github", "PULL_REQUEST_TEMPLATE.md"),
      "utf8",
    );
    expect(prTemplate).toContain("Security checklist");
    expect(prTemplate).toContain("SECURITY.md");
    expect(prTemplate).toContain("CHANGELOG.md");
  });
});
