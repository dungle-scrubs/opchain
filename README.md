# opchain

opchain stores 1Password service-account tokens in the Apple Keychain and
injects them directly into `op` child processes. The parent shell environment
- and anything reading it, including LLM agents - never sees the token value.

opchain also validates `.env.op` files so broken `op://` references don't ship,
and tracks expiring 1Password items by vault and item UUID.

## What it does

A token stored through opchain lives in the macOS Keychain. When you run a
command, opchain pulls the token and passes it to `op` as
`OP_SERVICE_ACCOUNT_TOKEN`. The token exists only in that child process.
`env`, `ps`, shell history, and agent context never contain it.

If `OP_SERVICE_ACCOUNT_TOKEN` is already set in the parent environment, it is
stripped from the child and replaced with the Keychain-resolved token. Ambient
env overrides are only allowed when you explicitly pass `--allow-env-token`.

## How it works

opchain resolves tokens through two providers, tried in order:

1. Environment override, only when `--allow-env-token` is passed and
   `OPCHAIN_TOKEN_OVERRIDE` is set.
2. `/usr/bin/security find-generic-password` against the macOS Keychain.

Provider child processes receive a sanitized environment. They inherit basic
execution vars (`PATH`, `HOME`, `SHELL`, etc.) but never ambient opchain token
values.

Delegated `op` processes receive the resolved token and a minimal set of
inherited environment variables. They do not receive `OPCHAIN_TOKEN_OVERRIDE`
or any pre-existing `OP_SERVICE_ACCOUNT_TOKEN` from the parent.

Configuration lives in `~/.config/opchain/config.toml`. Each identity defines
named profiles, an access mode, and an optional vault allowlist. Profiles map
to Keychain account names. A typical identity has `read` and `write` profiles
backed by separate service-account tokens.

In `auto` mode, read-safe commands like `op vault list` resolve a profile
automatically. Everything else requires explicit profile selection (`--read`,
`--write`, or `--profile <name>`).

## Quick start

### 1. Install

```bash
git clone https://github.com/dungle-scrubs/opchain.git
cd opchain
bun install --frozen-lockfile
bun run build
bun run install-local
```

This places `opchain` and `oprun` in `~/.local/bin`.

### 2. Configure

Create `~/.config/opchain/config.toml`:

```toml
[defaults]
projects_dir = "~/dev"
expires_threshold_days = 14
enforce_vault_allowlist = true

[identities.primary]
default_mode = "auto"
vaults = ["Services"]

[identities.primary.profiles.read]
keychain_account = "opchain:primary:read"

[identities.primary.profiles.write]
keychain_account = "opchain:primary:write"
```

### 3. Store tokens

```bash
opchain token set --identity primary --profile read --stdin < ~/my-read-token
opchain token set --identity primary --profile write --stdin < ~/my-write-token
```

### 4. Run a command

```bash
opchain primary op vault list
```

## Commands

### 1Password CLI

```bash
# Auto mode resolves the read profile for safe commands
opchain primary op vault list

# Explicit write for mutations
opchain primary --write op item edit "Stripe API Key" --vault Services

# One-time env-token override
opchain primary --allow-env-token op user list
```

### `.env.op` validation

```bash
# List every op:// reference in a file
opchain primary secrets list .env.op

# Validate every reference resolves
opchain primary secrets validate .env.op

# Validate all .env.op files under projects_dir
opchain primary secrets validate --project-wide

# Inspect metadata for one reference (secrets are never printed)
opchain primary secrets inspect op://Services/Stripe/api_key
```

### Expiry tracking

```bash
opchain primary expires add op://Services/Stripe/api_key
opchain primary expires list
opchain primary expires scan
```

### Token management

```bash
opchain token set --identity primary --profile read --stdin
opchain token remove --identity primary --profile read
```

### Setup

```bash
opchain doctor
opchain identity list
```

### Migration from the old opchain

```bash
opchain migrate-v1 --dry-run
opchain migrate-v1
```

### Debug output

```bash
opchain --debug primary op vault list
opchain --debug --debug-format json primary expires scan
```

Debug output goes to stderr. It never contains token values, resolved secrets,
or child-process stdout/stderr.

## Security

opchain keeps tokens out of the parent environment. A token stored in the
Keychain and resolved through opchain is never visible to the shell, `ps`,
shell history, or agent context.

opchain does not provide hard isolation between identities under the same macOS
account. The primary boundary is the 1Password service-account token scope
itself.

Read [SECURITY.md](SECURITY.md) for the threat model, provider environment
sanitization, telemetry rules, and state-file guarantees.

## Installing from source

Requirements: [Bun](https://bun.sh) 1.3+.

```bash
bun install --frozen-lockfile
bun run build
bun run install-local
```

Verify:

```bash
opchain --help
opchain doctor
```

## Docs

- [SECURITY.md](SECURITY.md) - threat model, trust boundaries, data-handling rules
- [MIGRATION.md](MIGRATION.md) - v1 migration, dry-run, apply, rollback
- [PACKAGING.md](PACKAGING.md) - build, debug flags, security fallback
- [CONTRIBUTING.md](CONTRIBUTING.md) - setup, TDD workflow, security boundaries
