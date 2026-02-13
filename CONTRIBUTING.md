# Contributing

## Development Setup

1. Clone the repository
2. Install dependencies: `brew install shellcheck just`

## Making Changes

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `just check` (lint + tests)
5. Commit and push
6. Open a Pull Request

## Available Commands

```bash
just          # list all recipes
just lint     # shellcheck all scripts
just test     # run local test suite
just check    # lint + test
just install  # install opchain via symlink
just uninstall
```

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

## Release Process

1. Update `VERSION` in `lib/config.sh`
2. Move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md`
3. Commit: `git commit -am "release: vX.Y.Z"`
4. Tag: `git tag vX.Y.Z && git push --tags`
5. GitHub Actions creates the release automatically
