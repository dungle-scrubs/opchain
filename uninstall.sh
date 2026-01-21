#!/bin/bash
# Remove opchain from PATH
set -e

BIN_DIR="${HOME}/.local/bin"

if [ -L "$BIN_DIR/opchain" ]; then
    rm "$BIN_DIR/opchain"
    echo "Removed: $BIN_DIR/opchain"
else
    echo "opchain not installed at $BIN_DIR"
fi
