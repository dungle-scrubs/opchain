#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="$root_dir/dist"
out_file="$out_dir/opchain"
install_dir="${HOME}/.local/bin"
install_path="$install_dir/opchain"

mkdir -p "$out_dir"
bun build "$root_dir/src/index.ts" --compile --outfile "$out_file"
mkdir -p "$install_dir"
cp "$out_file" "$install_path"
chmod +x "$install_path"
printf 'Installed opchain to %s\n' "$install_path"
