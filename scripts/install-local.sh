#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="$root_dir/dist"
opchain_out_file="$out_dir/opchain"
oprun_out_file="$out_dir/oprun"
install_dir="${HOME}/.local/bin"
opchain_install_path="$install_dir/opchain"
oprun_install_path="$install_dir/oprun"

mkdir -p "$out_dir"
bun build "$root_dir/src/index.ts" --compile --outfile "$opchain_out_file"
bun build "$root_dir/src/oprun.ts" --compile --outfile "$oprun_out_file"
mkdir -p "$install_dir"
cp "$opchain_out_file" "$opchain_install_path"
cp "$oprun_out_file" "$oprun_install_path"
chmod +x "$opchain_install_path" "$oprun_install_path"
printf 'Installed opchain to %s\n' "$opchain_install_path"
printf 'Installed oprun to %s\n' "$oprun_install_path"
