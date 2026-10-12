#!/usr/bin/env bash
# Submit the given signed binaries to Apple's notary service with an App
# Store Connect API key and wait for the result.
#
# Usage: notarize-macos.sh <binary>...
# Environment: APPLE_API_KEY_PATH, APPLE_API_KEY_ID, APPLE_API_ISSUER_ID
#              (required); NOTARY_TIMEOUT (optional, default 30m)
# Exit 0: Accepted.
# Exit 1: rejected, unreadable result, or a failed step.
# Exit 2: usage or missing environment.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  printf '%s\n' 'Usage: notarize-macos.sh <binary>...' >&2
  exit 2
fi

for name in APPLE_API_KEY_PATH APPLE_API_KEY_ID APPLE_API_ISSUER_ID; do
  if [[ -z "${!name:-}" ]]; then
    printf 'error: %s is not set\n' "$name" >&2
    exit 2
  fi
done

if [[ ! -f "$APPLE_API_KEY_PATH" ]]; then
  printf 'error: API key file not found\n' >&2
  exit 1
fi

for binary in "$@"; do
  if [[ ! -f "$binary" ]]; then
    printf 'error: not a file: %s\n' "$binary" >&2
    exit 1
  fi
done
if ! command -v jq >/dev/null 2>&1; then
  printf 'error: jq is required\n' >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if ! mkdir "$tmp/opchain-notarize" ||
  ! cp "$@" "$tmp/opchain-notarize/" ||
  ! ditto -c -k --keepParent "$tmp/opchain-notarize" "$tmp/opchain-notarize.zip"; then
  printf 'error: could not create the archive\n' >&2
  exit 1
fi
xcrun notarytool submit "$tmp/opchain-notarize.zip" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID" --wait --timeout "${NOTARY_TIMEOUT:-30m}" --output-format json > "$tmp/result.json" || true
if ! id="$(jq -r '.id' "$tmp/result.json" 2>/dev/null)" ||
  ! status="$(jq -r '.status' "$tmp/result.json" 2>/dev/null)" ||
  [[ -z "$id" || "$id" == null || -z "$status" || "$status" == null ]]; then
  printf 'error: could not read the notarization result\n' >&2
  cat "$tmp/result.json" >&2
  exit 1
fi
if xcrun notarytool log "$id" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID" "$tmp/notary-log.json"; then
  printf 'notary log:\n'
  cat "$tmp/notary-log.json"
else
  printf 'warning: could not fetch the notary log\n' >&2
fi
if [[ "$status" == Accepted ]]; then
  printf 'notarized: submission %s Accepted\n' "$id"
  exit 0
fi
printf 'error: notarization %s for submission %s\n' "$status" "$id" >&2
exit 1
