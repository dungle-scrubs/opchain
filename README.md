# opchain

[![CI](https://github.com/dungle-scrubs/opchain/actions/workflows/ci.yml/badge.svg)](https://github.com/dungle-scrubs/opchain/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Dual-token 1Password wrapper with automatic least-privilege token selection and secrets management. Picks a read-only or read-write service account token from macOS Keychain based on the `op` subcommand being run.

## Requirements

- macOS (uses Keychain via `security` command)
- Bash
- [jq](https://jqlang.github.io/jq/) (required for `opchain create`): `brew install jq`

## Installation

### Homebrew (recommended)

```bash
brew install dungle-scrubs/opchain/opchain
```

### Manual

```bash
./install.sh
```

Creates a symlink at `~/.local/bin/opchain`. Ensure `~/.local/bin` is in your `PATH`.

## Setup

Store both tokens in Keychain with the interactive setup:

```bash
opchain setup
```

This prompts for a **read-only** and **read-write** 1Password service account token and stores them as separate Keychain entries.

Setup also offers to configure an **OpenRouter API key** for LLM-assisted item creation (`opchain create`). This is optional — without it, `create` falls back to manual selection prompts. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).

Set each keychain item to "Allow all applications" access to avoid biometric prompts during automation.

## Usage

### Token auto-selection

opchain automatically picks the least-privilege token:

```bash
# Read token (default for reads and non-op commands)
opchain op vault list
opchain op item get --vault Dev "api-key"
opchain varlock run -- ./start.sh

# Write token (auto-detected for mutating op commands)
opchain op item create --vault Dev --title "api-key"
opchain op item edit "api-key" --vault Dev
opchain op item delete "api-key"
```

### Expiry date on create/edit

Use `--expires` to set an expiration date when creating or editing items:

```bash
# Instead of remembering op's field syntax:
opchain op item create --vault Dev --title "api-key" --expires 2026-06-15

# Translates to: op item create --vault Dev --title "api-key" --category "API Credential" "expires[date]=2026-06-15"
# Auto-tracks the item for expiry monitoring
```

When `--expires` is used with `op item create` and no `--category` is specified, opchain defaults to `--category "API Credential"`.

Works with `op item edit` too:

```bash
opchain op item edit "api-key" --vault Dev --expires 2026-12-31
```

### LLM-assisted item creation

Create 1Password items interactively with optional LLM suggestions for vault, category, and fields:

```bash
# LLM suggests vault, category, and fields based on the title
opchain create "Stripe API Key"

# Skip LLM, specify vault and category directly
opchain create "SSH Key" --vault Dev --category "SSH Key"

# Auto-track expiry on creation
opchain create "Token" --expires 2026-06-15
```

When an OpenRouter API key is configured (via `opchain setup`), the LLM analyzes the item title and suggests:
- Which vault to store it in
- The appropriate category (from 1Password's 22 built-in types)
- Relevant fields with appropriate types (concealed for secrets, url for endpoints, etc.)

The LLM only sees metadata (title, vault names, category list) — **never secret values**. Without an LLM key configured, opchain falls back to numbered selection prompts.

### Token expiry tracking

Track items with expiration dates and check their status:

```bash
# List tracked items with expiry status
opchain expires

# Manually track an item
opchain expires add op://Dev/api-key

# Stop tracking
opchain expires remove op://Dev/api-key
```

Output shows status based on the configured threshold (default: 14 days):

```
==> Tracked Items
  OK       op://Dev/api-key (2026-06-15, 138 days)
  EXPIRING op://Admin/service-token (2026-02-10, 13 days)
  EXPIRED  op://Prod/old-key (2026-01-15, 13 days ago)
  FAIL     op://Dev/missing-item (could not read)
```

Expiry warnings also appear after `opchain secrets validate` when items are expiring or expired.

### Force a specific token

```bash
opchain --read op vault list       # force read token
opchain --write op vault list      # force write token
```

### Secrets management

Manage `op://` references in `.env.op` files across projects:

```bash
# List op:// references in .env.op files
opchain secrets list .
opchain secrets list path/to/.env.op

# Check if each op:// reference resolves
opchain secrets check .env.op

# Validate all .env.op files under ~/dev/
opchain secrets validate
```

### Working with .env files

Create a `.env.op` template (safe to commit):

```bash
# .env.op
GEMINI_API_KEY=op://Personal/Gemini/credential
DATABASE_URL=op://Dev/Postgres/connection-string
```

Run with secrets injected:

```bash
opchain op run --env-file=.env.op -- npm run dev
```

## Write command detection

These `op` subcommand + action pairs trigger the write token:

| Subcommand | Actions |
|------------|---------|
| `item` | `create`, `edit`, `delete`, `share` |
| `vault` | `create`, `edit`, `delete` |
| `document` | `create`, `edit`, `delete` |
| `group` | `create`, `edit`, `delete` |

Everything else uses the read token. Non-`op` commands (e.g., `varlock`) always use read.

## Configuration

### Config file

`~/.config/opchain/config` (optional):

```
projects_dir=~/dev
read_account=opchain-read
write_account=opchain-write
```

### Environment variables

Environment variables override the config file, which overrides defaults.

| Variable | Description | Default |
|----------|-------------|---------|
| `OPCHAIN_PROJECTS_DIR` | Directory for `secrets validate` | `~/dev` |
| `OPCHAIN_READ_ACCOUNT` | Keychain account for read token | `opchain-read` |
| `OPCHAIN_WRITE_ACCOUNT` | Keychain account for write token | `opchain-write` |
| `OPCHAIN_EXPIRES_THRESHOLD` | Days before expiry to warn | `14` |
| `OPCHAIN_LLM_ACCOUNT` | Keychain account for OpenRouter API key | `opchain-llm` |
| `OPCHAIN_LLM_MODEL` | LLM model for create suggestions | `anthropic/claude-3.5-haiku` |

## Uninstall

```bash
./uninstall.sh
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
