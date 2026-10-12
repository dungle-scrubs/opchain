# Dependency Audit

Last refreshed 2026-10-12, after the dependency bumps in #28 and the `toml`
security update.

## Current Results

`bun audit` reports no vulnerabilities. `toml` 4.3.0 includes the fix for
GHSA-82x6-q7mm-w9cf (uncontrolled recursion, fixed in 4.2.0); opchain parses
only its own config file with it.

`bun outdated` currently reports:

| Package | Current | Latest | Decision |
| --- | --- | --- | --- |
| `@biomejs/biome` | `2.5.2` | `2.5.15` | Left for Dependabot's next run. |
| `@types/bun` | `1.3.14` | `1.4.2` | Kept at the Bun runtime version (1.3.14). |
| `toml` | `4.3.0` | `5.0.0` | Left for Dependabot's next run. |
| `typescript` | `6.0.3` | `7.0.2` | Left for Dependabot's next run. |

All dependencies are build-time only: the compiled binaries embed `commander`
and `toml`, so the npm package has no runtime dependencies.
