# opchain

[![CI](https://github.com/dungle-scrubs/opchain/actions/workflows/ci.yml/badge.svg)](https://github.com/dungle-scrubs/opchain/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Dual-token 1Password wrapper with automatic least-privilege token selection and secrets management. Picks a read-only or read-write service account token from macOS Keychain based on the `op` subcommand being run.

## Requirements

- macOS (uses Keychain via `security` command)
- Bash
- [jq](https://jqlang.github.io/jq/) (required for `opchain create`): `brew install jq`

## Installation

### Install

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

Keep the default Keychain access controls. Do **not** switch items to "Allow all applications".

If you need unattended automation, the safe option is a dedicated helper binary with explicit Keychain access. With the current shell-script + `/usr/bin/security` design, you cannot meaningfully scope access to `opchain` itself — trusting `/usr/bin/security` would also trust every other script that invokes it.

A local helper scaffold and signing guide live at [`docs/keychain-helper.md`](docs/keychain-helper.md). Once built and signed, point `OPCHAIN_KEYCHAIN_HELPER` or `keychain_helper` at the binary to make opchain use it for service-account token access across top-level commands and most internal `op` calls.

Run `opchain doctor` after wiring the helper. It verifies the configured path, reports symlink/realpath and `codesign` identity details, checks read/write helper access, and reminds you that Keychain trusted-app bindings still require a manual check in Keychain Access. Use `opchain doctor --json` if you want machine-readable output.

## Usage

### Token auto-selection

opchain automatically picks the least-privilege token:

```bash
# Read token (default for read-only op commands)
opchain op vault list
opchain op item get --vault Dev "api-key"
opchain op run --env-file=.env.op -- ./start.sh

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

Create 1Password items interactively with optional LLM suggestions for category and fields:

```bash
# LLM suggests category and fields based on the title
opchain create "Stripe API Key"

# Skip LLM, specify vault and category directly
opchain create "SSH Key" --vault Dev --category "SSH Key"

# Auto-track expiry on creation
opchain create "Token" --expires 2026-06-15
```

When an OpenRouter API key is configured (via `opchain setup`), the LLM analyzes the item title and suggests:
- The appropriate category (from 1Password's built-in types)
- Relevant fields with appropriate types (concealed for secrets, url for endpoints, etc.)

The LLM only sees the item title and category list — **never secret values or vault names**. Responses are structurally validated before use: category must match a real 1Password category, field types must be in the allowed set, and unsafe field names are rejected. Without an LLM key configured, opchain falls back to numbered selection prompts.

### Token expiry tracking

Track items with expiration dates and check their status:

```bash
# List tracked items with expiry status
opchain expires

# Manually track an item (item UUID is safest)
opchain expires add op://Dev/item-id

# Stop tracking
opchain expires remove op://Dev/item-id
```

Auto-tracked items are stored as structured records containing the vault, stable item ID, and a cached title. That avoids breakage when titles contain path-like characters and avoids an extra metadata lookup just to render `opchain expires` output.

Output shows status based on the configured threshold (default: 14 days):

```
==> Tracked Items
  OK       API Key [op://Dev/item-id] (2026-06-15, 138 days)
  EXPIRING Service Token [op://Admin/item-id] (2026-02-10, 13 days)
  EXPIRED  Old Key [op://Prod/item-id] (2026-01-15, 13 days ago)
  FAIL     op://Dev/item-id (could not read)
```

Expiry warnings also appear after `opchain secrets validate` when items are expiring or expired, even if some secret references fail validation.

### Force a specific token

```bash
opchain --read op vault list       # force read token
opchain --write op vault list      # force write token
```

By default, `opchain` only wraps `op ...` commands. It will not inject a token into arbitrary processes.

If you need that behavior, use the explicit `exec` subcommand:

```bash
opchain exec --read -- env
opchain exec --write --confirm-write -- ./script-that-needs-a-token
opchain doctor
opchain doctor --json
```

`--confirm-write` is intentionally required for write-token exec. If you are exporting a write-capable 1Password token into another process, you should have to say so explicitly.

### Secrets management

Manage `op://` references in `.env.op` files across projects:

```bash
# List op:// references in .env.op files
opchain secrets list .
opchain secrets list path/to/.env.op

# Check if each op:// reference resolves
opchain secrets check .env.op

# Inspect available fields for each referenced item
opchain secrets inspect .env.op

# Validate all .env.op files under ~/dev/
opchain secrets validate
```

### Working with `.env.op` files

A `.env.op` file is a normal env file (`KEY=VALUE`) where values can be 1Password references.

Create a `.env.op` template (safe to commit):

```bash
# .env.op
# comments and blank lines are allowed
GEMINI_API_KEY=op://Personal/Gemini/credential
DATABASE_URL=op://Dev/Postgres/connection-string
STRIPE_SECRET=op://Services/Stripe/Keys/secret
```

Notes:

- Supports both `op://Vault/Item/field` and `op://Vault/Item/Section/field`
- `opchain secrets list|check|inspect` only process values starting with `op://`
- The file stores references, not secret values

Run with secrets injected:

```bash
opchain op run --env-file=.env.op -- npm run dev
```

#### Parallel reads (external examples)

Validate many refs in parallel (prints status only, not values):

```bash
opchain secrets list .env.op \
  | awk -F= '/op:\/\// { gsub(/^[[:space:]]+/, "", $1); print $1, $2 }' \
  | xargs -n 2 -P 8 sh -c '
      key="$1"
      ref="$2"
      if opchain --read op read "$ref" >/dev/null 2>&1; then
        printf "OK   %s\n" "$key"
      else
        printf "FAIL %s\n" "$key"
      fi
    ' _
```

If you need multiple fields from one item, fetch once and parse locally:

```bash
item_json=$(opchain --read op item get "Stripe" --vault Services --format json)
api_key=$(printf '%s' "$item_json" | jq -r '.fields[] | select(.label=="api-key") | .value')
endpoint=$(printf '%s' "$item_json" | jq -r '.fields[] | select(.label=="endpoint") | .value')
```

That avoids repeated network calls for the same item.

## Write command detection

These `op` subcommand + action pairs trigger the write token:

| Subcommand | Actions |
|------------|---------|
| `item` | `create`, `edit`, `delete`, `share`, `move` |
| `vault` | `create`, `edit`, `delete` |
| `document` | `create`, `edit`, `delete` |
| `group` | `create`, `edit`, `delete` |
| `user` | `provision`, `confirm`, `edit`, `delete`, `suspend`, `reactivate` |
| `connect` | `server`, `token` (any action on these sub-resources) |

Everything else uses the read token. Non-`op` commands are rejected by default unless you use `opchain exec` explicitly.

## Configuration

### Config file

`~/.config/opchain/config` (optional):

```
projects_dir=~/dev
read_account=opchain-read
write_account=opchain-write
keychain_helper=~/bin/opchain-keychain-helper
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
| `OPCHAIN_KEYCHAIN_HELPER` | Optional helper binary for trusted-binary Keychain access | unset |

## Uninstall

```bash
./uninstall.sh
```

## Known Limitations

- **macOS only** — uses `security` (Keychain) and BSD `date -j`; no Linux/Windows support
- **Bash 3.2+** — compatible with macOS default shell, but no Bash 4+ features (associative arrays, etc.)
- **1Password service accounts** — requires service account tokens, not personal accounts

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
