#!/bin/bash
# Install opchain to PATH via symlink
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${HOME}/.local/bin"

mkdir -p "$BIN_DIR"

if [ -L "$BIN_DIR/opchain" ]; then
    rm "$BIN_DIR/opchain"
fi

ln -s "$SCRIPT_DIR/opchain" "$BIN_DIR/opchain"
echo "Installed: $BIN_DIR/opchain -> $SCRIPT_DIR/opchain"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    echo "Warning: $BIN_DIR is not in PATH"
    echo "Add to your shell config:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
