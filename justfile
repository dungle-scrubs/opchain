# opchain task runner

# List available recipes
default:
    @just --list

# Run shellcheck on all scripts
lint:
    shellcheck -S warning opchain lib/*.sh install.sh uninstall.sh test/test.sh

# Run local tests (no op CLI or Keychain required)
test:
    ./test/test.sh

# Lint + test
check: lint test

# Build the optional Keychain helper scaffold
helper-build:
    swift build -c release --package-path helper/opchain-keychain-helper

# Install opchain via symlink
install:
    ./install.sh

# Remove opchain symlink
uninstall:
    ./uninstall.sh
