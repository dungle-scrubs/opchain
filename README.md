# opchain

[![CI](https://github.com/dungle-scrubs/opchain/actions/workflows/ci.yml/badge.svg)](https://github.com/dungle-scrubs/opchain/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Run commands with `OP_SERVICE_ACCOUNT_TOKEN` from macOS Keychain. Enables the 1Password CLI (`op`) and tools that depend on it to authenticate via service account without exposing the token in shell history or config files.

## Requirements

- macOS (uses Keychain via `security` command)
- Bash

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

Store your 1Password service account token in Keychain:

```bash
security add-generic-password -a opchain -s OP_SERVICE_ACCOUNT_TOKEN -w
# (prompts for the token value)
```

Set the keychain item to "Allow all applications" access to avoid biometric prompts during automation.

## Usage

```bash
# Run 1Password CLI commands
opchain op read "op://vault/item/field"

# Inject secrets into environment via op run
opchain op run -- node server.js

# Run varlock (or any tool using op under the hood)
opchain varlock run -- ./start.sh

# Verify it works
opchain printenv | grep OP_SERVICE_ACCOUNT_TOKEN
```

## Working with .env Files

For projects that expect environment variables, create a `.env.op` template (safe to commit):

```bash
# .env.op
GEMINI_API_KEY=op://Personal/Gemini/credential
DATABASE_URL=op://Dev/Postgres/connection-string
```

Run with secrets injected:

```bash
opchain op run --env-file=.env.op -- npm run dev
```

For projects that require an actual `.env` file on disk:

```bash
opchain op inject -i .env.op -o .env
npm run dev
rm .env
```

## Why?

- **LLM-proof**: Token stays in Keychain, never in shell history or config files
- **Reusable**: Works with `op`, varlock, or any tool that reads `OP_SERVICE_ACCOUNT_TOKEN`
- **Fallback-friendly**: Projects can still use `.env` files for contributors without 1Password

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `OPCHAIN_KEYCHAIN_SERVICE` | Keychain account name | `opchain` |

## Known Limitations

- macOS only (requires Keychain)
- Hardcoded secret name (`OP_SERVICE_ACCOUNT_TOKEN`)
- Install path fixed to `~/.local/bin`

## Uninstall

```bash
./uninstall.sh
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
