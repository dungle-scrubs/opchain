# Migration from opchain v1

This document covers the current v1 to v2 migration behavior.

## Current status

Implemented now:

- `opchain migrate-v1 --dry-run`
- `opchain migrate-v1`

Both commands look for legacy inputs at:

- `~/.config/opchain/config`
- `~/.config/opchain/expires`

## What dry-run does

`opchain migrate-v1 --dry-run` does not write anything.

It reports:

- detected legacy config path
- detected legacy expires path
- read-account to `primary.read` mapping
- write-account to `primary.write` mapping
- planned `projects_dir` import, with `~` and `~/...` expanded to the current
  home directory
- planned `expires_threshold_days` import
- legacy expiry records resolved into canonical v2 vault and item UUIDs when
  helper and `op` access are available
- explicit reasons when expiry import cannot proceed yet, such as missing
  legacy `read_account`, token resolution failure, or unresolved item metadata

If legacy expiry records cannot be resolved during dry-run, the output stays
explicit and non-destructive.

## What apply does

`opchain migrate-v1` writes:

- `~/.config/opchain/config.toml`
- `~/.config/opchain/state/expires/primary.json`

The current apply path is intentionally narrow:

- imports the single-machine `primary` read/write mapping
- imports legacy expiry records into canonical v2 IDs only after every legacy
  record resolves cleanly
- writes v2 config for the current documented single-machine setup
- writes `state/expires/primary.json` even when the imported expiry set is empty

If any legacy expiry record cannot be resolved, apply mode fails before writing
v2 files.

Apply writes current-attempt files through same-directory temporary files. If a
later write fails, such as an expiry-state lock failure, apply rolls back files
created by that attempt and leaves no half-migrated `config.toml`.

## Apply guard

Apply mode is guarded.

It fails instead of overwriting when either target already exists:

- `~/.config/opchain/config.toml`
- `~/.config/opchain/state/expires/primary.json`

That guard exists to stop silent data loss and sloppy repeated migrations.
Guarded failures do not remove pre-existing v2 config or expiry state files.

## Imported values

Current config import covers:

- legacy `projects_dir`
- legacy `expires_threshold`
- legacy `read_account`
- legacy `write_account`

`projects_dir` values of `~` and `~/...` are normalized to absolute home paths
in migrated v2 config. Absolute and relative legacy paths are preserved as
written.

Current expiry import covers:

- legacy expires records from the v1 expires file
- canonical `vaultUuid` and `itemUuid`
- cached titles updated from current `op item get --format json` metadata

## Remaining limits

Still missing:

- broader identity migration beyond the current `primary` mapping
- richer conflict handling than the current fail-fast guard

## Debug telemetry

With `--debug --debug-format json`, migration emits redacted `migration.plan`
and `migration.apply` events. These events report safe counts and outcomes,
including whether `projects_dir` used home expansion, whether apply succeeded,
and whether rollback ran. They do not include token values, resolved secret
values, raw child output, or full local paths.

## Recommended workflow

```bash
opchain migrate-v1 --dry-run
opchain migrate-v1
opchain doctor
opchain primary op vault list
opchain primary expires list
```
