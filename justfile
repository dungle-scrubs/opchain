# opchain task runner

# List available recipes
default:
    @just --list

# Run shellcheck on all scripts
lint:
    shellcheck opchain lib/*.sh install.sh uninstall.sh

# Run local tests (no op CLI or Keychain required)
test:
    ./test/test.sh

# Lint + test
check: lint test

# Install opchain via symlink
install:
    ./install.sh

# Remove opchain symlink
uninstall:
    ./uninstall.sh
