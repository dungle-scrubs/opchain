# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `opchain create <title>` command — LLM-assisted 1Password item creation with interactive prompts
- OpenRouter LLM integration for vault, category, and field suggestions (optional, never sends secret values)
- `opchain setup` now offers optional OpenRouter API key configuration
- `llm_account` and `llm_model` config keys with `OPCHAIN_LLM_ACCOUNT` / `OPCHAIN_LLM_MODEL` env var overrides
- `jq` dependency for `opchain create` (with install instructions on missing)
- `opchain expires` command — track items with expiration dates and check status (OK/EXPIRING/EXPIRED)
- `opchain expires add <ref>` — manually track an `op://` item for expiry monitoring
- `opchain expires remove <ref>` — stop tracking an item
- `--expires YYYY-MM-DD` flag for `op item create/edit` — sets expiry date field and auto-tracks item
- Default `--category "API Credential"` when using `--expires` with `op item create` (prevents confusing "Login" type)
- `expires_threshold` config key and `OPCHAIN_EXPIRES_THRESHOLD` env var (default: 14 days)
- Expiry warnings after `opchain secrets validate` for EXPIRING/EXPIRED items
- Watch file at `~/.config/opchain/expires` for tracked item references

## [0.3.0] - 2026-01-27

### Added

- Dual-token system: separate read-only and read-write service account tokens
- Automatic least-privilege token selection based on `op` subcommand
- `--read` / `--write` flags to force a specific token
- `opchain secrets list` — list `op://` references in `.env.op` files
- `opchain secrets check` — resolve each `op://` reference and report OK/FAIL
- `opchain secrets validate` — check all `.env.op` files under projects directory
- `opchain setup` — interactive dual-token Keychain storage with overwrite detection
- `--version` flag
- Config file support (`~/.config/opchain/config`)
- `OPCHAIN_PROJECTS_DIR`, `OPCHAIN_READ_ACCOUNT`, `OPCHAIN_WRITE_ACCOUNT` env vars
- Write command classification for `op item/vault/document/group` mutations

### Changed

- Rewritten as function-based script with `main()` entry point
- Token resolution: two dedicated tokens replace single token
- Keychain accounts: `opchain-read` and `opchain-write` replace `opchain`

### Removed

- `OPCHAIN_KEYCHAIN_SERVICE` env var (replaced by `OPCHAIN_READ_ACCOUNT` / `OPCHAIN_WRITE_ACCOUNT`)

## [0.2.0] - 2026-01-21

### Changed

- Default keychain account name from `dev-secrets` to `opchain`

### Added

- `OPCHAIN_KEYCHAIN_SERVICE` environment variable to customize keychain account name

## [0.1.0] - 2025-01-21

### Added

- Initial release
- `opchain` command to inject `OP_SERVICE_ACCOUNT_TOKEN` from Keychain
- `--help` flag with usage documentation
- Install/uninstall scripts
- Homebrew formula
