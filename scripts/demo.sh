#!/usr/bin/env bash
set -euo pipefail

keep_demo="false"
if [[ "${1:-}" == "--keep" ]]; then
  keep_demo="true"
  shift
fi

if [[ $# -ne 0 ]]; then
  printf 'Usage: %s [--keep]\n' "$0" >&2
  exit 1
fi

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
home_dir="$(mktemp -d "${TMPDIR:-/tmp}/opchain-demo-home.XXXXXX")"
project_dir="$(mktemp -d "${TMPDIR:-/tmp}/opchain-demo-project.XXXXXX")"

cleanup() {
  if [[ "$keep_demo" == "true" ]]; then
    return
  fi

  rm -rf "$home_dir" "$project_dir"
}

run_demo_command() {
  local label="$1"
  shift

  printf '\n--- %s\n' "$label"
  "$@"
}

trap cleanup EXIT

mkdir -p "$home_dir/.config/opchain" "$project_dir/apps/demo"
cat > "$home_dir/.config/opchain/config.toml" <<'EOF'
[defaults]
projects_dir = "/Users/example/dev"
expires_threshold_days = 14
enforce_vault_allowlist = true

[identities.human]
default_mode = "default"
vaults = ["Human", "Services", "Models"]

[identities.human.profiles.default]
keychain_account = "opchain:human:default"

[identities.primary]
default_mode = "auto"
vaults = ["Personal", "Services"]

[identities.primary.profiles.read]
keychain_account = "opchain:primary:read"

[identities.primary.profiles.write]
keychain_account = "opchain:primary:write"
EOF
cat > "$project_dir/.env.op" <<'EOF'
OPENAI_API_KEY=op://Services/OpenAI/api-key
DUPLICATE=op://Services/OpenAI/api-key
EOF
cat > "$project_dir/apps/demo/.env.op" <<'EOF'
ANTHROPIC_API_KEY="op://Models/Anthropic/api-key"
EOF

export HOME="$home_dir"
export OPCHAIN_SECURITY_PATH="$root_dir/test/fixtures/bin/security"
export OPCHAIN_OP_PATH="$root_dir/test/fixtures/bin/op"

printf 'Fixture-backed opchain demo\n'
printf 'This uses fake security/op binaries from test fixtures, not your real 1Password account.\n'
printf 'HOME_DIR=%s\n' "$home_dir"
printf 'PROJECT_DIR=%s\n' "$project_dir"
if [[ "$keep_demo" == "true" ]]; then
  printf 'Keeping demo directories for inspection.\n'
fi

run_demo_command "doctor" bun run --silent "$root_dir/src/index.ts" doctor
run_demo_command "identity list" bun run --silent "$root_dir/src/index.ts" identity list
run_demo_command \
  "human secrets list" \
  bun run --silent "$root_dir/src/index.ts" human secrets list "$project_dir/.env.op"
run_demo_command \
  "human secrets check" \
  env OPCHAIN_TEST_SECURITY_TOKEN='token-for-human-default' \
  bun run --silent "$root_dir/src/index.ts" human secrets check "$project_dir/.env.op"
run_demo_command \
  "human secrets validate (directory scan)" \
  env OPCHAIN_TEST_SECURITY_TOKEN='token-for-human-default' \
  bun run --silent "$root_dir/src/index.ts" human secrets validate "$project_dir"
run_demo_command \
  "human secrets inspect" \
  env OPCHAIN_TEST_SECURITY_TOKEN='token-for-human-default' \
  bun run --silent "$root_dir/src/index.ts" human secrets inspect op://Services/OpenAI/api-key
run_demo_command \
  "human op vault list" \
  env OPCHAIN_TEST_SECURITY_TOKEN='token-for-human-default' \
  bun run --silent "$root_dir/src/index.ts" human op vault list
run_demo_command \
  "primary --write op item edit Stripe --vault Services" \
  env OPCHAIN_TEST_SECURITY_TOKEN='token-for-primary-write' \
  bun run --silent "$root_dir/src/index.ts" primary --write op item edit Stripe --vault Services
run_demo_command \
  "human expires add" \
  env OPCHAIN_TEST_SECURITY_TOKEN='token-for-human-default' \
  bun run --silent "$root_dir/src/index.ts" human expires add op://Services/OpenAI/api-key
run_demo_command "human expires list" bun run --silent "$root_dir/src/index.ts" human expires list
run_demo_command \
  "human expires scan" \
  env OPCHAIN_TEST_SECURITY_TOKEN='token-for-human-default' \
  bun run --silent "$root_dir/src/index.ts" human expires scan
