# Packaging and local trust notes

This document covers the current local packaging flow for opchain.

## Current status

Implemented now:

- compiled Bun binary build
- local install into `~/.local/bin/opchain`
- `doctor` reports binary path and config path
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

## Justfile entrypoints

Current packaging-related entrypoints:

```bash
just build
just install-local
```
