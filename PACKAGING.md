# Packaging and local trust notes

This document covers the current local packaging flow for opchainV2.

## Current status

Implemented now:

- compiled Bun binary build
- local install into `~/.local/bin/opchain`
- `doctor` reports binary path and helper status
- package metadata for release-readiness review

Not implemented yet:

- code signing
- notarization
- release automation
- public npm publishing

Release-readiness and manual GitHub settings are tracked in
`RELEASE_READINESS.md`.

## Build a local binary

```bash
bun run build
```

That writes compiled binaries to:

```text
dist/opchain
dist/oprun
```

## Install locally

```bash
bun run install-local
```

That installs the binaries to:

```text
~/.local/bin/opchain
~/.local/bin/oprun
```

## Verify the install

```bash
~/.local/bin/opchain --help
~/.local/bin/opchain doctor
~/.local/bin/oprun --help
```

`doctor` should report:

- the current binary path
- the config path
- the helper path
- helper status as `available` or `missing`

## Distribution dry run

The package metadata is present for release-readiness checks. The package is
MIT-licensed; review the build contents below before publishing.

After building binaries, inspect the package contents with:

```bash
bun run build
bun run pack:dry-run
```

The dry run should include the compiled `dist/opchain` and `dist/oprun`
entrypoints declared in `package.json#bin`.

## Helper versus `security` fallback

The current runtime order is:

1. `OPCHAIN_TOKEN_OVERRIDE` when `--allow-env-token` is explicitly passed
2. helper backend
3. `/usr/bin/security` fallback

The helper path is preferred because the repo is designed around a tighter
macOS trust story than plain shell-outs to `security`.

The `security` fallback is still useful, but it is weaker and should not be
presented as equivalent.

## Helper build steps

There is no native helper build in this repository yet.

Current expectation:

- point `OPCHAIN_HELPER_PATH` at an existing helper binary
- or allow the runtime to fall back to `/usr/bin/security`

That means helper build and signing are still external to this repo today.

## Debug flags and JSON events

Supported debug flags:

```bash
--debug
--debug-format text
--debug-format json
```

JSON debug output uses newline-delimited event objects on stderr.

Current event families include:

- config loading and identity resolution
- token provider attempt, success, and failure
- `op` command classification and execution
- `.env.op` scan and validation
- expiry scan and threshold evaluation
- migration planning and apply

The event shape stays OTEL-compatible at a structural level:

- `timestamp`
- `trace_id`
- `span_id`
- `parent_span_id`
- `name`
- `status`
- `duration_ms`
- `attributes`

## Local trust notes

This repo currently produces an unsigned local binary.

That is acceptable for local development, but it is not a polished public
trust story.

Current practical guidance:

- install under a user-owned path like `~/.local/bin`
- inspect the source before building
- prefer the helper when available
- do not pretend fallback mode is equally strong

## Justfile entrypoints

Current packaging-related entrypoints:

```bash
just build
just install-local
```
