#!/usr/bin/env bash
# Sign the given binaries with a code-signing identity and the hardened runtime, then verify them.
# Usage: sign-macos.sh --identity <name> [--team-id <id>] [--timestamp] <binary>...
# Exit 0: all binaries signed and verified. Exit 1: a check or codesign call failed. Exit 2: usage error.
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: sign-macos.sh --identity <name> [--team-id <id>] [--timestamp] <binary>...' >&2
  exit 2
}
identity=''
team_id=''
timestamp=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --identity)
      [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || usage
      identity="$2"; shift 2 ;;
    --team-id)
      [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || usage
      team_id="$2"; shift 2 ;;
    --timestamp) timestamp=(--timestamp); shift ;;
    -*) usage ;;
    *) break ;;
  esac
done
[[ -n "$identity" && $# -gt 0 ]] || usage
for binary in "$@"; do
  if [[ ! -f "$binary" ]]; then
    printf 'error: not a file: %s\n' "$binary" >&2
    exit 1
  fi
done
if ! identities="$(security find-identity -v -p codesigning 2>/dev/null)" ||
  ! grep -qF -- "\"$identity\"" <<< "$identities"; then
  printf 'error: signing identity not found: %s\n' "$identity" >&2
  exit 1
fi
for binary in "$@"; do
  identifier="dev.opchain.$(basename "$binary")"
  if ! codesign --force --options runtime ${timestamp[@]+"${timestamp[@]}"} --sign "$identity" --identifier "$identifier" "$binary"; then
    printf 'error: codesign failed for %s\n' "$binary" >&2
    exit 1
  fi
  if ! codesign --verify --strict "$binary"; then
    printf 'error: %s: strict verification failed\n' "$binary" >&2
    exit 1
  fi
  if ! details="$(codesign -dv "$binary" 2>&1)"; then
    printf 'error: %s: could not inspect signature\n' "$binary" >&2
    exit 1
  fi
  if ! grep -qxF -- "Identifier=$identifier" <<< "$details"; then
    printf 'error: %s: Identifier does not match %s\n' "$binary" "$identifier" >&2
    exit 1
  fi
  if ! grep -q 'flags=.*(runtime)' <<< "$details"; then
    printf 'error: %s: hardened runtime is missing\n' "$binary" >&2
    exit 1
  fi
  if [[ -n "$team_id" ]] && ! grep -qxF -- "TeamIdentifier=$team_id" <<< "$details"; then
    found="$(sed -n 's/^TeamIdentifier=//p' <<< "$details")"
    printf 'error: %s: TeamIdentifier is %s, expected %s\n' "$binary" "${found:-missing}" "$team_id" >&2
    exit 1
  fi
  printf 'signed %s as %s\n' "$binary" "$identifier"
done
