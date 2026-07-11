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

Profile resolution for `op` commands is fail-closed. A profile resolves
automatically only in these cases:

- The identity defines exactly one profile. That single profile resolves for
  read-safe commands regardless of `default_mode`.
- The identity is in `auto` mode and defines a `read` profile. Read-safe
  commands like `op vault list` resolve the `read` profile automatically.

Everything else requires explicit profile selection (`--read`, `--write`, or
`--profile <name>`). Write and other non-read-safe command shapes are never
auto-resolved: they always require an explicit profile or access override, so
they fail closed until you name one.

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

# Validate every reference in a single file resolves
opchain primary secrets check .env.op

# Validate one file or a whole directory of .env.op files
opchain primary secrets validate .env.op
opchain primary secrets validate --project-wide

# Inspect metadata for one reference (secrets are never printed)
opchain primary secrets inspect op://Services/Stripe/api_key
```

`secrets check` and `secrets validate` run the same reference-resolution
workflow; the difference is scope. `secrets check` requires an explicit file
path and validates only that one file. `secrets validate` validates one file
or, with `--project-wide`, every `.env.op` file under `projects_dir`. Neither
command prints resolved secret values.

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

opchain keeps tokens out of the parent environment. On the resolve-and-inject
path - when opchain pulls a stored token and passes it to an `op` child process
- the token is never placed in the parent shell environment, `ps` output,
shell history, or agent context. It exists only inside the delegated child
process.

There is one deliberate exception, on the write path. `opchain token set`
stores a token by shelling out to `/usr/bin/security add-generic-password`,
which has no stdin mode for the password on this subcommand, so the token is
passed on that child's argv. During the brief lifetime of that `security`
process the token is visible to other processes running as the same macOS user
(for example via `ps`). This is consistent with the threat model in
[SECURITY.md](SECURITY.md), which does not defend against a malicious process
running as the same user. `token set` still never accepts the token on
opchain's own command line: input is read from a hidden TTY prompt or
`--stdin`.

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
