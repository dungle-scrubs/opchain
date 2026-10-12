# SECURITY

This document defines the trust boundaries and handling rules for opchain.

If a future implementation conflicts with this file, the implementation is
wrong or this file must be updated in the same change.

## Status

The repository now implements the core security-sensitive runtime behavior:
fail-closed profile selection, explicit env-token opt-in, refusal of
secret-printing `op` commands without `--allow-reveal`, sanitized provider
and delegated `op` environments, redacted provider telemetry, stable
expiry-state validation, and all-or-nothing migration apply behavior. This
file remains the source of truth for token, telemetry, subprocess, and
state-file boundaries.

## Security goal

opchain is meant to reduce accidental leakage and accidental misuse.

It is not meant to provide hard isolation between identities that run under the
same macOS user account.

## Real trust boundary

The real remote-access trust boundary is the 1Password service-account token
scope.

The local tooling layer can improve safety, but it cannot grant stronger access
control than the token itself.

## What opchain should protect against well

- accidental token leakage through shell env, `ps`, shell history, or normal
  debugging
- accidental use of the wrong token for the wrong identity
- accidental secret leakage into LLM and agent context during `.env.op`
  workflows
- stale or forgotten expiring records

## What opchain does not protect against

- a malicious process running as the same macOS user
- a same-user agent that can execute arbitrary local commands
- hard separation between identities on one shared macOS login

If hard isolation is required, the identities need separate macOS users,
separate VMs, or separate machines.

## Mandatory security rules

### Ambient env token state is ignored by default

The CLI must not silently accept ambient token env vars.

The only allowed env override path is:

- the current invocation passes `--allow-env-token`
- the process reads `OPCHAIN_TOKEN_OVERRIDE`

Without `--allow-env-token`, env token state must not participate in provider
resolution.

Provider subprocess environments are sanitized so ambient opchain token values
and delegated `op` service-account tokens do not cross into provider children.

### `auto` mode is fail-closed

`auto` is not a write detector.

It is a read-safe allowlist. Only explicitly allowlisted read-safe command
shapes may resolve automatically. Everything else must require explicit profile
selection.

### Secret-printing op commands are refused by default

The CLI must not run an `op` command that prints a secret value to stdout
unless the current invocation explicitly opts in.

Refused forms, detected from the `op` command line before any token
resolution, config loading, or child spawn:

- `op read`, `op inject`, and `op document get` without a valid out-file
  (`-o` / `--out-file` whose value is non-empty, not `-`, and does not
  resolve under `/dev/`)
- `op item get` with `--reveal`, `--otp`, or `--format json`
- `op item create` and `op item edit` with `--reveal` or `--format json`
- `op run --no-masking`
- `op signin` in every form, including `--raw` and `-f`
- `op service-account create`, `op connect token create`, and
  `op events-api create`
- any unknown dash token while the command path is still a prefix of one of
  the forms above (`unclassifiable-order`), which fails closed
- a `--` separator directly preceded by a dash flag that is not a known
  boolean flag (`unclassifiable-order`), because op hands a value flag the
  next token even when that token is `--`, so the separator never reaches
  op and the tokens after it are still parsed as flags

The only override is `--allow-reveal`, accepted before the identity or
between the identity and `op`. It additionally requires an interactive
stdin (a TTY); stdout may stay piped. The refusal message names the safe
alternative and never echoes an argument value.

Known limits of this guard, all within the same-user threat model below:

- the TTY gate is a speed bump, not a boundary: a same-user process can fake
  a pty (`script`, `expect`), which matches the existing threat model
- a value transformed inside masked `op run` (base64, a substring) still
  prints; opchain cannot detect transformations
- a child of `op run` that calls `op` itself, and bare `op` invoked without
  opchain, bypass the guard entirely
- an out-file path that is a symlink to a device is not detected; only
  lexical `/dev/` prefixes are checked
- command aliases are matched from a fixed list (`items`, `documents`, `sa`,
  `connect tokens`), so an alias a future op release adds may not be covered

Structure-only inspection goes through `item-structure`, which prints
labels, types, value presence, and value length - never a value.

### Subprocess output is not telemetry

Debug mode must never capture or emit child stdout or stderr.

This matters because `op` can print secret values by design. If debug mode
mirrors child output, the tool defeats its own purpose.

Allowed telemetry:

- identity and profile selection
- provider attempts and outcomes
- reveal-guard decisions (`op.reveal.refused` / `op.reveal.allowed`) with
  identity, form id, and refusal reason only
- command classification
- exit code
- duration
- byte counts

Disallowed telemetry:

- token values
- resolved secret values
- raw subprocess env payloads
- child stdout
- child stderr
- full environment dumps
- unredacted sensitive arguments

### Token mutation commands must not use argv for secret input

`token set` must never accept the token value on the command line.

Allowed input modes:

- hidden TTY prompt
- `--stdin`

Disallowed input modes:

- `--value <token>`
- positional token arguments
- implicit reads from ambient env

This rule governs opchain's own command line. It does not accept the token on
opchain's argv. Internally, `token set` stores the token by invoking
`/usr/bin/security add-generic-password`, which has no stdin mode for the
password on this subcommand, so the token is passed on that `security` child's
argv. For the brief lifetime of that process the token is visible to other
processes running as the same macOS user. That exposure is in scope of the
threat model above: opchain does not defend against a malicious process
running as the same user. The resolve-and-inject path keeps tokens out of the
parent env, `ps`, shell history, and agent context; this same-user argv
exposure is limited to the `token set` write path.

### Expiry tracking uses canonical IDs

Persist expiry records by:

- vault UUID
- item UUID

Vault titles and item titles are display metadata only.

### Persisted state must be updated atomically

State writes must use:

- temp file in the same directory
- rename into place
- a lock strategy for concurrent writers

Anything weaker invites state corruption under repeated agent use.

## Token resolution

Tokens are resolved through `/usr/bin/security find-generic-password` against
the macOS Keychain, or from the `OPCHAIN_TOKEN_OVERRIDE` env var when
`--allow-env-token` is explicitly passed.

### Configured vault lists

The per-identity vaults list in config.toml records which vaults an identity
is meant to use. opchain shows it in identity list and does not enforce it.
The boundary is the 1Password service-account token scope.

## Human and agent guidance

Before changing token handling, telemetry, subprocess execution, or file-state
behavior:

1. read this file
2. read `MIGRATION.md` and `PACKAGING.md`
3. update all affected docs in the same change

If a proposed change weakens any rule above, call that out directly instead of
quietly redefining the boundary.
