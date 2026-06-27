# Changelog

## Unreleased

Initial unreleased baseline built from audit remediation (RFC-01).

### Added

- `opchain doctor` — binary path, config, identities, profiles, vaults, helper
  status.
- `opchain identity list` — list configured identities from `config.toml`.
- `opchain token set --identity <id> --profile <profile> [--stdin]` — store a
  service-account token via `--stdin` or a hidden TTY prompt.
- `opchain token remove --identity <id> --profile <profile> [--yes]` — remove a
  stored token with `--yes` or interactive confirmation.
- `opchain <identity> op vault list` — `auto`-mode and single-profile identity
  read.
- `opchain <identity> --profile <name> op <args...>` — explicit named-profile
  selection.
- `opchain <identity> --read op <args...>` — explicit read-profile selection.
- `opchain <identity> --write op <args...>` — explicit write-profile override.
- `opchain <identity> --allow-env-token op <args...>` — explicit env-token
  override.
- `opchain <identity> secrets list [path]` — list `op://` refs from a `.env.op`
  file.
- `opchain <identity> secrets check [path]` — validate `op://` refs from a
  `.env.op` file.
- `opchain <identity> secrets inspect <ref>` — inspect metadata for one
  `op://` reference without printing the secret value.
- `opchain <identity> secrets validate [path]` — validate refs across one file
  or directory of `.env.op` files.
- `opchain <identity> secrets validate --project-wide` — validate refs across
  all `.env.op` files under `projects_dir`.
- `opchain <identity> expires add <ref>` — track one expiring record by
  canonical vault/item UUIDs.
- `opchain <identity> expires remove <vault-uuid>/<item-uuid>` — remove one
  tracked expiry record.
- `opchain <identity> expires list` — list tracked expiry records.
- `opchain <identity> expires scan` — refresh tracked expiry metadata and
  classify status.
- `opchain migrate-v1 --dry-run` — plan migration from opchain v1 without
  writing files.
- `opchain migrate-v1` — apply v1→v2 migration with all-or-nothing writes and
  rollback.
- `oprun` companion binary for env-template execution through `opchain op run`.
- Redacted debug telemetry (text and JSON newline-delimited output on stderr).

### Security

- Fail-closed `auto` mode limited to `vault list` only.
- Ambient env tokens ignored without `--allow-env-token`.
- Sanitized provider subprocess environments (no ambient `OPCHAIN_TOKEN_OVERRIDE`
  or `OP_SERVICE_ACCOUNT_TOKEN` leakage).
- Sanitized delegated `op` child environments (resolved token only).
- Redacted provider failure messages — no token values, stdout, or stderr in
  errors.
- Provider timeout and oversized-output controls with redacted telemetry.
- Token mutation never accepts secret values through argv.
- Expiry tracking keyed by canonical vault UUID and item UUID.
- Atomic expiry-state writes with same-directory temp file and `wx` exclusive
  lock.
- All-or-nothing migration apply; rollback only removes current-attempt files.
