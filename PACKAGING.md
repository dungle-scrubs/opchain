# Packaging and local trust notes

This document covers the current local packaging flow for opchain.

## Current status

Implemented now:

- compiled Bun binary build
- local install into `~/.local/bin/opchain`
- `doctor` reports binary path and config path
- package metadata for release-readiness review
- hardened-runtime code signing through `scripts/sign-macos.sh`
- Apple notarization through `scripts/notarize-macos.sh`
- release automation in `.github/workflows/release.yml` on `v*` tags;
  `workflow_dispatch` is a dry run that signs, notarizes, and uploads artifacts
  without publishing

Not implemented yet:

- public npm publishing
- stapling: a bare Mach-O binary cannot be stapled, so Gatekeeper checks the
  notarization ticket online on first run

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

## Signing and notarization

The release signs both binaries with a Developer ID Application identity, the
hardened runtime, and a secure timestamp, then notarizes them with an App Store
Connect API key.

Configure these repository secrets:

- `MACOS_SIGNING_CERT_P12_BASE64`: the Developer ID Application certificate and
  its private key exported from Keychain Access as `.p12`, base64-encoded
- `MACOS_SIGNING_CERT_PASSWORD`: the password for that `.p12`
- `APPLE_API_KEY_P8_BASE64`: the API key's `.p8`, base64-encoded
- `APPLE_API_KEY_ID`: the API key ID
- `APPLE_API_ISSUER_ID`: the API issuer ID

Configure these repository variables:

- `MACOS_SIGNING_IDENTITY`: for example `Developer ID Application: Name (TEAMID)`
- `APPLE_TEAM_ID`: the Apple team ID

Without these secrets and variables the release fails before publishing anything.

Entitlements: none. The binaries run under the hardened runtime with no
exceptions. This turns off Bun's JIT: measured on an M5 Max with Bun 1.3.14, a
3e8-iteration loop took 6.2 s instead of 1.8 s, while `opchain --help` startup
stayed at 21 to 27 ms. opchain's commands are short and wait on `op`, so no
exception is taken. If a future Bun needs it, add only
`com.apple.security.cs.allow-jit`, which restored full speed in the same
measurement.

For local signed installs:

```bash
OPCHAIN_CODESIGN_IDENTITY="Developer ID Application: <Name> (<TEAMID>)" bun run install-local
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

Local installs are ad-hoc signed unless a signing identity is present. Release
binaries are Developer ID signed and notarized.

Current practical guidance:

- install under a user-owned path like `~/.local/bin`
- inspect the source before building

## Justfile entrypoints

Current packaging-related entrypoints:

```bash
just build
just install-local
```
