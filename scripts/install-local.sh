#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="$root_dir/dist"
opchain_out_file="$out_dir/opchain"
oprun_out_file="$out_dir/oprun"
install_dir="${HOME}/.local/bin"
opchain_install_path="$install_dir/opchain"
oprun_install_path="$install_dir/oprun"

# Stable code-signing identity for the compiled binaries.
#
# By default `bun build --compile` produces an ad-hoc signature whose CDHash
# changes on every build. macOS keys the "access data from other apps" (TCC)
# consent grant to that signature, so each rebuild looks like a brand-new app
# and the prompt is re-armed. Signing with a fixed self-signed certificate and
# a fixed identifier gives the binaries a stable Designated Requirement, so the
# grant survives rebuilds and the prompt stops recurring.
#
# This step is optional: when the identity is not present in the keychain the
# binaries keep their default ad-hoc signature and install proceeds normally.
# Override the identity name with OPCHAIN_CODESIGN_IDENTITY.
codesign_identity="${OPCHAIN_CODESIGN_IDENTITY:-opchain-codesign}"

mkdir -p "$out_dir"
bun build "$root_dir/src/index.ts" --compile --outfile "$opchain_out_file"
bun build "$root_dir/src/oprun.ts" --compile --outfile "$oprun_out_file"

# Sign with the hardened runtime through scripts/sign-macos.sh before copying.
# OPCHAIN_CODESIGN_IDENTITY may name a Developer ID Application identity.
# The embedded Mach-O signature is inherited by the copied binaries.
if ! command -v codesign >/dev/null 2>&1 || ! command -v security >/dev/null 2>&1; then
  printf 'codesign/security unavailable; leaving default ad-hoc signature in place.\n'
elif security find-identity -v -p codesigning 2>/dev/null | grep -qF -- "$codesign_identity"; then
  "$root_dir/scripts/sign-macos.sh" --identity "$codesign_identity" "$opchain_out_file" "$oprun_out_file"
  printf 'Signed binaries with code-signing identity "%s".\n' "$codesign_identity"
else
  printf 'Code-signing identity "%s" not found; skipping signing.\n' "$codesign_identity"
  printf 'Binaries keep their ad-hoc signature, so macOS may repeat the\n'
  printf '"access data from other apps" prompt after each rebuild. To stop it,\n'
  printf 'create a self-signed Code Signing certificate named "%s" (Keychain\n' "$codesign_identity"
  printf 'Access > Certificate Assistant > Create a Certificate; Identity Type:\n'
  printf 'Self Signed Root; Certificate Type: Code Signing) and re-run this script.\n'
fi

mkdir -p "$install_dir"

# Install by renaming a staged copy over the target. Rewriting the file in
# place can crash an opchain process that is running it; after a rename that
# process keeps the old file.
install_binary() {
  local source_path=$1
  local target_path=$2
  local staged_path
  staged_path="$(mktemp "$install_dir/.$(basename "$target_path").XXXXXX")"
  if ! cp "$source_path" "$staged_path" ||
    ! chmod 755 "$staged_path" ||
    ! mv -f "$staged_path" "$target_path"; then
    rm -f "$staged_path"
    return 1
  fi
}

install_binary "$opchain_out_file" "$opchain_install_path"
install_binary "$oprun_out_file" "$oprun_install_path"
printf 'Installed opchain to %s\n' "$opchain_install_path"
printf 'Installed oprun to %s\n' "$oprun_install_path"
