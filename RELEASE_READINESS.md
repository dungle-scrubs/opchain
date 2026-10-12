# Release Readiness

This repository is prepared for release-readiness review. Public publishing is
intentionally deferred because npm trusted-publisher setup has not been
completed. Package metadata is present and passes local package-metadata
checks; `package.json` is not marked as private.

## Release Automation

Release automation in `.github/workflows/release.yml` builds, signs, notarizes,
and publishes macOS arm64 binaries to GitHub Releases when a `v*` tag is pushed
(see `PACKAGING.md`).
There is still no release-please workflow, manifest, or npm publishing. Those
stay deferred until publishing to npm is in scope.

## Dependency Automation

Dependabot is configured for:

- GitHub Actions
- npm dependencies through the Bun/npm ecosystem metadata

The current dependency audit and deferred upgrade decisions are recorded in
`DEPENDENCY_AUDIT.md`.

## Manual GitHub Settings

These settings require repository admin access and are documented as manual
checks, not local automation:

- enable Dependabot alerts and security updates
- enable secret scanning and push protection
- configure branch protection or repository rulesets for the default branch
- require the CI workflow before merge
- choose merge policy defaults such as squash-only and delete branch on merge
- keep Actions default token permissions restricted, with workflow-level
  permissions declared in `.github/workflows/ci.yml`
