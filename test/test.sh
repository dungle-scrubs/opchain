#!/bin/bash
# Local test runner for opchain
# Tests pure functions that don't require op CLI or Keychain access.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0

# Source modules (order matters: config first, then modules that depend on it)
# shellcheck source=../lib/config.sh
source "$SCRIPT_DIR/lib/config.sh"
# shellcheck source=../lib/keychain.sh
source "$SCRIPT_DIR/lib/keychain.sh"
# shellcheck source=../lib/expires.sh
source "$SCRIPT_DIR/lib/expires.sh"
# shellcheck source=../lib/create.sh
source "$SCRIPT_DIR/lib/create.sh"

# --- Assertions ---

assert_eq() {
    local label="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        echo "  PASS  $label"
        PASS=$((PASS + 1))
    else
        echo "  FAIL  $label"
        echo "        expected: '$expected'"
        echo "        actual:   '$actual'"
        FAIL=$((FAIL + 1))
    fi
}

assert_exit() {
    local label="$1" expected="$2"
    shift 2
    local actual
    "$@" > /dev/null 2>&1 && actual=0 || actual=$?
    assert_eq "$label" "$expected" "$actual"
}

# --- Tests ---

test_trim() {
    echo "==> trim"
    assert_eq "no whitespace" "hello" "$(trim "hello")"
    assert_eq "leading spaces" "hello" "$(trim "   hello")"
    assert_eq "trailing spaces" "hello" "$(trim "hello   ")"
    assert_eq "both sides" "hello" "$(trim "  hello  ")"
    assert_eq "tabs" "hello" "$(trim "	hello	")"
    assert_eq "inner spaces preserved" "hello world" "$(trim "  hello world  ")"
    assert_eq "empty string" "" "$(trim "")"
}

test_write_detection() {
    echo "==> is_write_command"
    assert_exit "op item create → write" 0 is_write_command op item create
    assert_exit "op item edit → write" 0 is_write_command op item edit
    assert_exit "op item delete → write" 0 is_write_command op item delete
    assert_exit "op item share → write" 0 is_write_command op item share
    assert_exit "op vault create → write" 0 is_write_command op vault create
    assert_exit "op document delete → write" 0 is_write_command op document delete
    assert_exit "op group edit → write" 0 is_write_command op group edit
    assert_exit "op item get → read" 1 is_write_command op item get
    assert_exit "op item list → read" 1 is_write_command op item list
    assert_exit "op vault list → read" 1 is_write_command op vault list
    assert_exit "non-op command → read" 1 is_write_command varlock run
    assert_exit "empty → read" 1 is_write_command
}

test_validate_date() {
    echo "==> validate_date"
    assert_exit "valid date" 0 validate_date "2026-01-15"
    assert_exit "valid leap year" 0 validate_date "2028-02-29"
    assert_exit "bad format" 1 validate_date "01-15-2026"
    assert_exit "not a date" 1 validate_date "not-a-date"
    assert_exit "invalid month" 1 validate_date "2026-13-01"
    assert_exit "invalid day" 1 validate_date "2026-02-30"
    assert_exit "empty" 1 validate_date ""
}

test_days_until() {
    echo "==> days_until"
    local today
    today=$(date +%Y-%m-%d)
    assert_eq "today → 0" "0" "$(days_until "$today")"

    local tomorrow
    tomorrow=$(date -j -v+1d +%Y-%m-%d)
    assert_eq "tomorrow → 1" "1" "$(days_until "$tomorrow")"

    local yesterday
    yesterday=$(date -j -v-1d +%Y-%m-%d)
    assert_eq "yesterday → -1" "-1" "$(days_until "$yesterday")"
}

test_expires_status() {
    echo "==> expires_status"
    load_config  # sets EXPIRES_THRESHOLD
    assert_eq "past → EXPIRED" "EXPIRED" "$(expires_status -5)"
    assert_eq "zero → EXPIRING" "EXPIRING" "$(expires_status 0)"
    assert_eq "within threshold → EXPIRING" "EXPIRING" "$(expires_status "$EXPIRES_THRESHOLD")"
    assert_eq "beyond threshold → OK" "OK" "$(expires_status $((EXPIRES_THRESHOLD + 1)))"
}

test_sanitize_title() {
    echo "==> sanitize_title"
    assert_eq "normal title" "Stripe API Key" "$(sanitize_title "Stripe API Key")"
    assert_eq "strips control chars" "hello" "$(sanitize_title $'hel\x01lo')"
    assert_eq "preserves spaces" "hello world" "$(sanitize_title "hello world")"

    local long
    long=$(printf 'x%.0s' {1..250})
    local result
    result=$(sanitize_title "$long")
    assert_eq "caps at 200 chars" "200" "${#result}"
}

test_config_parsing() {
    echo "==> load_config"
    local tmpdir
    tmpdir=$(mktemp -d)
    local old_config="$CONFIG_FILE"

    # Test with custom config file
    CONFIG_FILE="$tmpdir/config"
    cat > "$CONFIG_FILE" << 'EOF'
projects_dir=~/projects
read_account=custom-read
write_account=custom-write
expires_threshold=7
# this is a comment
llm_model=openai/gpt-4o-mini
EOF

    load_config
    assert_eq "projects_dir from config" "$HOME/projects" "$PROJECTS_DIR"
    assert_eq "read_account from config" "custom-read" "$READ_ACCOUNT"
    assert_eq "write_account from config" "custom-write" "$WRITE_ACCOUNT"
    assert_eq "expires_threshold from config" "7" "$EXPIRES_THRESHOLD"
    assert_eq "llm_model from config" "openai/gpt-4o-mini" "$LLM_MODEL"

    # Test env var override
    OPCHAIN_PROJECTS_DIR="/override/path" load_config
    assert_eq "env var overrides config" "/override/path" "$PROJECTS_DIR"

    # Restore
    CONFIG_FILE="$old_config"
    rm -rf "$tmpdir"
}

test_secrets_list_file() {
    echo "==> secrets_list_file"
    # Need secrets module
    # shellcheck source=../lib/secrets.sh
    source "$SCRIPT_DIR/lib/secrets.sh"

    local tmpdir
    tmpdir=$(mktemp -d)
    cat > "$tmpdir/.env.op" << 'EOF'
# comment line
API_KEY=op://vault/item/field
PLAIN_VAR=some-value
DB_URL=op://vault/db/url
EOF

    local output
    output=$(secrets_list_file "$tmpdir/.env.op")
    echo "$output" | grep -q "API_KEY=op://vault/item/field"
    assert_eq "lists op:// refs" "0" "$?"
    echo "$output" | grep -q "PLAIN_VAR" && assert_eq "excludes plain vars" "1" "0" || assert_eq "excludes plain vars" "1" "1"

    rm -rf "$tmpdir"
}

test_expires_file_ops() {
    echo "==> expires file operations"
    local tmpdir
    tmpdir=$(mktemp -d)
    local old_config_dir="$CONFIG_DIR"
    local old_expires="$EXPIRES_FILE"

    CONFIG_DIR="$tmpdir"
    EXPIRES_FILE="$tmpdir/expires"

    # add
    add_expires_item "op://Dev/test-item"
    assert_eq "add writes file" "op://Dev/test-item" "$(cat "$EXPIRES_FILE")"

    # duplicate
    add_expires_item "op://Dev/test-item"
    local count
    count=$(grep -c "op://Dev/test-item" "$EXPIRES_FILE")
    assert_eq "no duplicate on re-add" "1" "$count"

    # second item
    add_expires_item "op://Dev/other-item"
    count=$(wc -l < "$EXPIRES_FILE" | tr -d ' ')
    assert_eq "two items tracked" "2" "$count"

    # load
    load_expires_list
    assert_eq "load returns 2 items" "2" "${#EXPIRES_ITEMS[@]}"

    # remove
    remove_expires_item "op://Dev/test-item" > /dev/null
    assert_eq "remove leaves one" "1" "$(wc -l < "$EXPIRES_FILE" | tr -d ' ')"

    # Restore
    CONFIG_DIR="$old_config_dir"
    EXPIRES_FILE="$old_expires"
    rm -rf "$tmpdir"
}

test_cli_flags() {
    echo "==> CLI flags"
    local opchain="$SCRIPT_DIR/opchain"

    local output
    output=$("$opchain" --version)
    assert_eq "--version output" "opchain $VERSION" "$output"

    output=$("$opchain" --help 2>&1 | head -1)
    assert_eq "--help first line" "opchain $VERSION — Dual-token 1Password wrapper with secrets management" "$output"

    output=$("$opchain" -h 2>&1 | head -1)
    assert_eq "-h works" "opchain $VERSION — Dual-token 1Password wrapper with secrets management" "$output"

    "$opchain" 2>&1 | grep -q "Usage:" || true
    assert_exit "no args → error" 1 "$opchain"

    "$opchain" --bogus 2>&1 | grep -q "Unknown flag" || true
    assert_exit "unknown flag → error" 1 "$opchain" --bogus
}

# --- Run ---

echo "opchain test suite"
echo ""

test_trim
test_write_detection
test_validate_date
test_days_until
test_expires_status
test_sanitize_title
test_config_parsing
test_secrets_list_file
test_expires_file_ops
test_cli_flags

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
