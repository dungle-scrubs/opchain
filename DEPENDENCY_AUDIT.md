# Dependency Audit

Captured during audit-remediation release-readiness work. Last refreshed
2026-06-27.

## Current Results

`bun audit` reports no vulnerabilities.

`bun outdated` currently reports:

| Package | Current | Latest | Decision |
| --- | --- | --- | --- |
| `commander` | `14.0.3` | `15.0.0` | Defer major upgrade to a separate dependency-upgrade run. |
| `toml` | `3.0.0` | `4.1.1` | Defer major upgrade to a separate dependency-upgrade run. |
| `typescript` | `5.9.3` | `6.0.3` | Defer major upgrade to a separate dependency-upgrade run. |
| `@biomejs/biome` | `2.4.7` | `2.5.1` | Minor bump available (2.4.7→2.5.1); deferred until an explicit dependency update run. |
| `@types/bun` | `1.3.10` | `1.3.14` | Patch bump available; deferred until an explicit dependency update run. |

No dependency versions were changed as part of this audit-remediation plan.
No patch-level updates were auto-applied.
