# Contributing

## Development Setup

1. Clone the repository
2. Ensure you have `shellcheck` installed: `brew install shellcheck`

## Making Changes

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `make lint`
5. Commit and push
6. Open a Pull Request

## Code Style

- Follow [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html)
- All scripts must pass `shellcheck`
- Use `set -e` for error handling
- Provide clear error messages with remediation steps
