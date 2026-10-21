#!/usr/bin/env bash
# Sign the given binaries with a code-signing identity and the hardened
# runtime, then verify them.
#
# Usage: sign-macos.sh --identity <name> [--team-id <id>] [--timestamp] <binary>...
# Exit 0: all binaries signed and verified.
# Exit 1: a check or codesign call failed.
# Exit 2: usage error.
#
# Apple's timestamp service intermittently refuses back-to-back requests, so a
# timestamped signing call that fails with "The timestamp service is not
# available" is retried up to 5 times, waiting 2, 4, 8 and 16 seconds
# (OPCHAIN_SIGN_RETRY_DELAY sets the first wait). Every other failure stops at
# once.
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: sign-macos.sh --identity <name> [--team-id <id>] [--timestamp] <binary>...' >&2
  exit 2
}
identity=''
team_id=''
timestamp=()
use_timestamp=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --identity)
      [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || usage
      identity="$2"; shift 2 ;;
    --team-id)
      [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || usage
      team_id="$2"; shift 2 ;;
    --timestamp) timestamp=(--timestamp); use_timestamp=1; shift ;;
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
sign_binary() {
  local binary="$1" identifier="$2" attempt=1 output
  local delay="${OPCHAIN_SIGN_RETRY_DELAY:-2}"
  while true; do
    if output="$(codesign --force --options runtime ${timestamp[@]+"${timestamp[@]}"} --sign "$identity" --identifier "$identifier" "$binary" 2>&1)"; then
      [[ -z "$output" ]] || printf '%s\n' "$output" >&2
      return 0
    fi
    [[ -z "$output" ]] || printf '%s\n' "$output" >&2
    if [[ "$use_timestamp" -ne 1 || "$output" != *"The timestamp service is not available"* || "$attempt" -ge 5 ]]; then
      return 1
    fi
    printf 'retrying %s: timestamp service unavailable (attempt %d of 5)\n' "$binary" "$attempt" >&2
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}
for binary in "$@"; do
  identifier="dev.opchain.$(basename "$binary")"
  if ! sign_binary "$binary" "$identifier"; then
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
