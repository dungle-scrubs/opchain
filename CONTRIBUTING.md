# Contributing

## Development Setup

1. Clone the repository
2. Install dependencies: `brew install shellcheck just`

## Making Changes

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `just check` locally (lint + tests)
5. Commit and push
6. Open a Pull Request

`main` is intended to stay protected: no direct pushes, no deletion, and all
merges should go through a PR.

## Available Commands

```bash
just          # list all recipes
just lint     # shellcheck all scripts
just test     # run local test suite (macOS only)
just check    # lint + test
just install  # install opchain via symlink
just uninstall
```

GitHub Actions intentionally stays on Ubuntu runners only. CI covers secrets,
lint, install smoke checks, and CodeQL. The full shell test suite remains a
local macOS responsibility.

## Code Style

- Follow [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html)
- All scripts must pass `shellcheck`
- Use `set -euo pipefail` for error handling
- Provide clear error messages with remediation steps

## Project Structure

```
opchain           # main entry point (sources lib/)
lib/
  config.sh       # constants, config loading, date utilities
  keychain.sh     # token fetching, write detection
  secrets.sh      # .env.op file management
  expires.sh      # token expiry tracking
  create.sh       # LLM-assisted item creation
  help.sh         # help text and version
test/
  test.sh         # local test suite
install.sh        # symlink installer
uninstall.sh      # symlink remover
```

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning:

| Prefix | Bump | Example |
|--------|------|---------|
| `fix:` | patch | `fix: resolve crash on empty input` |
| `feat:` | minor | `feat: add export command` |
| `feat!:` | major (minor pre-1.0) | `feat!: change config format` |
| `docs:`, `chore:`, `ci:`, `test:` | none | `docs: update README` |

## Release Process

Releases are automated via [release-please](https://github.com/googleapis/release-please):

1. Merge conventional commits into `main` via PR
2. release-please opens/updates a PR bumping version + changelog
3. Merge the release PR → GitHub Release created automatically
