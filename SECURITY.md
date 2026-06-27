# SECURITY

This document defines the trust boundaries and handling rules for opchain.

If a future implementation conflicts with this file, the implementation is
wrong or this file must be updated in the same change.

## Status

The repository now implements the core security-sensitive runtime behavior:
fail-closed profile selection, explicit env-token opt-in, sanitized provider
and delegated `op` environments, redacted provider telemetry, stable
expiry-state validation, and all-or-nothing migration apply behavior. This file
remains the source of truth for token, telemetry, subprocess, and state-file
boundaries.

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

### Subprocess output is not telemetry

Debug mode must never capture or emit child stdout or stderr.

This matters because `op` can print secret values by design. If debug mode
mirrors child output, the tool defeats its own purpose.

Allowed telemetry:

- identity and profile selection
- provider attempts and outcomes
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

### Config allowlists

Configured vault lists are local policy hints and guardrails.

They may narrow expected behavior, but they do not expand real 1Password
permissions and they are not the primary boundary.

## Human and agent guidance

Before changing token handling, telemetry, subprocess execution, or file-state
behavior:

1. read this file
2. read `MIGRATION.md` and `PACKAGING.md`
3. update all affected docs in the same change

If a proposed change weakens any rule above, call that out directly instead of
quietly redefining the boundary.
