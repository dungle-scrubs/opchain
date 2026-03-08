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
    assert_exit "op item move → write" 0 is_write_command op item move
    assert_exit "op item get → read" 1 is_write_command op item get
    assert_exit "op item list → read" 1 is_write_command op item list
    assert_exit "op vault list → read" 1 is_write_command op vault list
    assert_exit "non-op command → read" 1 is_write_command env run
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

test_expires_threshold_validation() {
    echo "==> expires_threshold validation"
    local old_config="$CONFIG_FILE"
    local tmpdir
    tmpdir=$(mktemp -d)
    CONFIG_FILE="$tmpdir/config"

    # Non-numeric threshold falls back to default
    echo "expires_threshold=banana" > "$CONFIG_FILE"
    load_config 2>/dev/null
    assert_eq "non-numeric falls back to default" "$DEFAULT_EXPIRES_THRESHOLD" "$EXPIRES_THRESHOLD"

    # Empty threshold falls back to default
    echo "expires_threshold=" > "$CONFIG_FILE"
    load_config 2>/dev/null
    assert_eq "empty falls back to default" "$DEFAULT_EXPIRES_THRESHOLD" "$EXPIRES_THRESHOLD"

    # Valid threshold kept
    echo "expires_threshold=7" > "$CONFIG_FILE"
    load_config 2>/dev/null
    assert_eq "valid threshold kept" "7" "$EXPIRES_THRESHOLD"

    CONFIG_FILE="$old_config"
}

test_expires_file_permissions() {
    echo "==> expires file permissions"
    local tmpdir
    tmpdir=$(mktemp -d)
    local old_config_dir="$CONFIG_DIR"
    local old_expires="$EXPIRES_FILE"

    CONFIG_DIR="$tmpdir/opchain-perm-test"
    EXPIRES_FILE="$CONFIG_DIR/expires"

    add_expires_item "op://Dev/test-item"

    local dir_perms
    dir_perms=$(stat -f '%Lp' "$CONFIG_DIR")
    assert_eq "config dir is 700" "700" "$dir_perms"

    local file_perms
    file_perms=$(stat -f '%Lp' "$EXPIRES_FILE")
    assert_eq "expires file is 600" "600" "$file_perms"

    CONFIG_DIR="$old_config_dir"
    EXPIRES_FILE="$old_expires"
}

test_seq_empty_array_safety() {
    echo "==> seq empty array safety (bash 3.2)"

    # Simulate the preview loop from create.sh with empty arrays
    local field_names=()
    local populated=0

    # This is the guarded pattern from create.sh lines 433-447
    if [[ ${#field_names[@]} -gt 0 ]]; then
        local i
        for i in $(seq 0 $((${#field_names[@]} - 1))); do
            populated=$((populated + i * 0 + 1))
        done
    fi
    assert_eq "no iterations on empty array" "0" "$populated"

    # Verify seq 0 -1 WOULD iterate (proving the guard is needed)
    local bad_iterations=0
    local _idx
    for _idx in $(seq 0 $(( 0 - 1 ))); do
        bad_iterations=$((_idx * 0 + bad_iterations + 1))
    done
    assert_eq "unguarded seq 0 -1 iterates" "2" "$bad_iterations"
}

test_secrets_inspect() {
    echo "==> secrets_inspect"
    # shellcheck source=../lib/secrets.sh
    source "$SCRIPT_DIR/lib/secrets.sh"

    local tmpdir
    tmpdir=$(mktemp -d)

    cat > "$tmpdir/.env.op" << 'EOF'
# API keys
API_KEY=op://Services/stripe/api-key
STRIPE_USER=op://Services/stripe/username
DB_PASS=op://Dev/database/password
MISSING=op://Services/stripe/nonexistent
SECTIONED=op://Services/stripe/Keys/secret
EOF

    # Mock setup_read_token (no Keychain needed)
    setup_read_token() { true; }

    # Mock op item get to return fake JSON
    op() {
        # op item get <item> --vault <vault> --format json
        local item_name="$3"
        case "$item_name" in
            stripe)
                cat << 'MOCK_JSON'
{
    "category": "API Credential",
    "fields": [
        {"label": "username", "type": "STRING"},
        {"label": "api-key", "type": "CONCEALED"},
        {"label": "website", "type": "URL"},
        {"label": "secret", "type": "CONCEALED", "section": {"id": "keys", "label": "Keys"}}
    ]
}
MOCK_JSON
                ;;
            database)
                cat << 'MOCK_JSON'
{
    "category": "Database",
    "fields": [
        {"label": "username", "type": "STRING"},
        {"label": "password", "type": "CONCEALED"},
        {"label": "server", "type": "STRING"},
        {"label": "port", "type": "STRING"}
    ]
}
MOCK_JSON
                ;;
            *)
                return 1
                ;;
        esac
    }

    local output
    output=$(secrets_inspect_file "$tmpdir/.env.op" 2>&1) || true

    # Item headers with category
    echo "$output" | grep -q "op://Services/stripe.*API Credential"
    assert_eq "stripe item with category" "0" "$?"

    echo "$output" | grep -q "op://Dev/database.*Database"
    assert_eq "database item with category" "0" "$?"

    # Fields listed
    echo "$output" | grep -q "api-key.*(CONCEALED)"
    assert_eq "lists api-key field" "0" "$?"

    echo "$output" | grep -q "website.*(URL)"
    assert_eq "lists website field with type" "0" "$?"

    echo "$output" | grep -q "Keys/secret"
    assert_eq "lists sectioned field" "0" "$?"

    # Reference matching
    echo "$output" | grep -q "✓ API_KEY → api-key"
    assert_eq "existing field shows ✓" "0" "$?"

    echo "$output" | grep -q "✓ STRIPE_USER → username"
    assert_eq "username field shows ✓" "0" "$?"

    echo "$output" | grep -q "✓ DB_PASS → password"
    assert_eq "database password shows ✓" "0" "$?"

    echo "$output" | grep -q "✗ MISSING → nonexistent.*(field not found)"
    assert_eq "missing field shows ✗" "0" "$?"

    echo "$output" | grep -q "✓ SECTIONED → Keys/secret"
    assert_eq "sectioned reference shows ✓" "0" "$?"

    # No op:// references
    cat > "$tmpdir/plain.env.op" << 'EOF'
PLAIN_VAR=some-value
OTHER=another-value
EOF
    local empty_output
    empty_output=$(secrets_inspect_file "$tmpdir/plain.env.op" 2>&1) || true
    echo "$empty_output" | grep -q "no op:// references"
    assert_eq "no refs shows message" "0" "$?"

    # Item not found
    cat > "$tmpdir/bad.env.op" << 'EOF'
KEY=op://Vault/nonexistent/field
EOF
    local bad_output
    bad_output=$(secrets_inspect_file "$tmpdir/bad.env.op" 2>&1) || true
    echo "$bad_output" | grep -q "ITEM NOT FOUND"
    assert_eq "missing item shows NOT FOUND" "0" "$?"

    echo "$bad_output" | grep -q "? KEY → field.*(item unavailable)"
    assert_eq "unavailable item ref shows ?" "0" "$?"

    # Restore real functions
    unset -f op setup_read_token
    # shellcheck source=../lib/keychain.sh
    source "$SCRIPT_DIR/lib/keychain.sh"
    rm -rf "$tmpdir"
}

test_handle_op_expires_equals_syntax() {
    echo "==> handle_op_expires --expires=DATE syntax"

    local tmpdir
    tmpdir=$(mktemp -d)
    local old_config_dir="$CONFIG_DIR"
    local old_expires="$EXPIRES_FILE"
    CONFIG_DIR="$tmpdir"
    EXPIRES_FILE="$tmpdir/expires"

    # Mock op: capture args to file
    op() { printf '%s\n' "$@" > "$tmpdir/captured_args"; return 0; }

    # Test: --expires=DATE stripped and converted to field syntax
    (handle_op_expires op item create --vault Dev --title "eq-key" --expires=2026-06-15) 2>/dev/null || true
    grep -q 'expires\[date\]=2026-06-15' "$tmpdir/captured_args"
    assert_eq "=syntax converts to field" "0" "$?"
    ! grep -q '^--expires' "$tmpdir/captured_args"
    assert_eq "=syntax strips --expires" "0" "$?"

    # Test: expiry tracking works with =syntax
    [[ -f "$tmpdir/expires" ]] && grep -q 'op://Dev/eq-key' "$tmpdir/expires"
    assert_eq "=syntax tracks item" "0" "$?"

    # Test: invalid date rejected with =syntax
    local err
    err=$( (handle_op_expires op item create --vault Dev --title "x" --expires=bad-date) 2>&1 ) || true
    echo "$err" | grep -q "invalid date"
    assert_eq "=syntax rejects invalid date" "0" "$?"

    # Cleanup
    unset -f op
    CONFIG_DIR="$old_config_dir"
    EXPIRES_FILE="$old_expires"
    rm -rf "$tmpdir"
}

test_edit_positional_arg_extraction() {
    echo "==> edit positional arg with --flag=value"

    local tmpdir
    tmpdir=$(mktemp -d)
    local old_config_dir="$CONFIG_DIR"
    local old_expires="$EXPIRES_FILE"
    CONFIG_DIR="$tmpdir"
    EXPIRES_FILE="$tmpdir/expires"

    # Mock op
    op() { printf '%s\n' "$@" > "$tmpdir/captured_args"; return 0; }

    # Test: --vault=Dev style doesn't break positional arg extraction
    rm -f "$tmpdir/expires"
    (handle_op_expires op item edit --vault=Dev myitem --expires 2026-06-15) 2>/dev/null || true
    [[ -f "$tmpdir/expires" ]] && grep -q 'op://Dev/myitem' "$tmpdir/expires"
    assert_eq "=style vault finds positional item" "0" "$?"

    # Test: multiple --flag=value before positional arg
    rm -f "$tmpdir/expires"
    (handle_op_expires op item edit --vault=Prod --format=json myedit --expires 2026-06-15) 2>/dev/null || true
    [[ -f "$tmpdir/expires" ]] && grep -q 'op://Prod/myedit' "$tmpdir/expires"
    assert_eq "multiple =style flags find positional" "0" "$?"

    # Test: mixed --flag value and --flag=value
    rm -f "$tmpdir/expires"
    (handle_op_expires op item edit --vault Staging --format=json editme --expires 2026-06-15) 2>/dev/null || true
    [[ -f "$tmpdir/expires" ]] && grep -q 'op://Staging/editme' "$tmpdir/expires"
    assert_eq "mixed flag styles find positional" "0" "$?"

    # Cleanup
    unset -f op
    CONFIG_DIR="$old_config_dir"
    EXPIRES_FILE="$old_expires"
    rm -rf "$tmpdir"
}

test_parse_llm_response() {
    echo "==> parse_llm_response"

    # Valid response
    local valid_raw
    valid_raw=$(cat <<'JSON'
{"choices":[{"message":{"content":"{\"category\":\"Login\",\"note\":\"A login item\",\"fields\":[{\"name\":\"username\",\"type\":\"text\",\"hint\":\"username\"}]}"}}]}
JSON
)
    local result
    result=$(parse_llm_response "$valid_raw")
    assert_eq "valid response parses" "0" "$?"
    echo "$result" | jq -e '.category == "Login"' > /dev/null 2>&1
    assert_eq "category extracted" "0" "$?"

    # Invalid category (not in whitelist)
    local bad_cat_raw
    bad_cat_raw=$(cat <<'JSON'
{"choices":[{"message":{"content":"{\"category\":\"Nonexistent Category\",\"fields\":[]}"}}]}
JSON
)
    assert_exit "invalid category rejected" 1 parse_llm_response "$bad_cat_raw"

    # Markdown-fenced response
    local fenced_raw
    fenced_raw=$(printf '{"choices":[{"message":{"content":"```json\\n{\\"category\\":\\"Login\\",\\"fields\\":[]}\\n```"}}]}')
    result=$(parse_llm_response "$fenced_raw" 2>/dev/null)
    assert_eq "fenced response parses" "0" "$?"

    # Empty response
    assert_exit "empty response rejected" 1 parse_llm_response ""

    # Malformed JSON
    local bad_json_raw
    bad_json_raw='{"choices":[{"message":{"content":"not json at all"}}]}'
    assert_exit "malformed JSON rejected" 1 parse_llm_response "$bad_json_raw"
}

test_write_detection_extended() {
    echo "==> is_write_command (extended)"
    # user subcommand
    assert_exit "op user provision → write" 0 is_write_command op user provision
    assert_exit "op user confirm → write" 0 is_write_command op user confirm
    assert_exit "op user edit → write" 0 is_write_command op user edit
    assert_exit "op user delete → write" 0 is_write_command op user delete
    assert_exit "op user suspend → write" 0 is_write_command op user suspend
    assert_exit "op user reactivate → write" 0 is_write_command op user reactivate
    assert_exit "op user list → read" 1 is_write_command op user list
    assert_exit "op user get → read" 1 is_write_command op user get
    # connect subcommand
    assert_exit "op connect server → write" 0 is_write_command op connect server
    assert_exit "op connect token → write" 0 is_write_command op connect token
    assert_exit "op connect list → read" 1 is_write_command op connect list
    # item-specific: share and move only on item
    assert_exit "op vault share → read" 1 is_write_command op vault share
    assert_exit "op vault move → read" 1 is_write_command op vault move
    assert_exit "op item share → write" 0 is_write_command op item share
    assert_exit "op item move → write" 0 is_write_command op item move
}

test_setup_single_account() {
    echo "==> setup_single_account"

    local tmpdir
    tmpdir=$(mktemp -d)
    local stored_account="" stored_service="" stored_token=""

    # Mock security commands
    security() {
        case "$1" in
            find-generic-password)
                return 1  # not found
                ;;
            add-generic-password)
                # Parse: -a account -s service -w token
                shift
                while [[ $# -gt 0 ]]; do
                    case "$1" in
                        -a) stored_account="$2"; shift 2 ;;
                        -s) stored_service="$2"; shift 2 ;;
                        -w) stored_token="$2"; shift 2 ;;
                        *) shift ;;
                    esac
                done
                ;;
        esac
    }

    # Mock read to provide a token
    read() {
        # The -rsp variant sets the variable (last arg)
        local varname="${!#}"
        eval "$varname=mock-token-value"
    }

    setup_single_account "tool-proxy-read"

    assert_eq "stores to correct account" "tool-proxy-read" "$stored_account"
    assert_eq "uses SECRET_NAME service" "$SECRET_NAME" "$stored_service"
    assert_eq "stores provided token" "mock-token-value" "$stored_token"

    # Test skip on empty token
    stored_account=""
    read() {
        local varname="${!#}"
        eval "$varname="
    }

    setup_single_account "empty-test"
    assert_eq "empty token not stored" "" "$stored_account"

    unset -f security read
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

test_handle_op_expires() {
    echo "==> handle_op_expires"

    local tmpdir
    tmpdir=$(mktemp -d)
    local old_config_dir="$CONFIG_DIR"
    local old_expires="$EXPIRES_FILE"
    CONFIG_DIR="$tmpdir"
    EXPIRES_FILE="$tmpdir/expires"

    # Mock op: capture args to file
    op() { printf '%s\n' "$@" > "$tmpdir/captured_args"; return 0; }

    # Test: --expires stripped and converted to field syntax
    (handle_op_expires op item create --vault Dev --title "test-key" --expires 2026-06-15) 2>/dev/null || true
    grep -q 'expires\[date\]=2026-06-15' "$tmpdir/captured_args"
    assert_eq "converts --expires to field" "0" "$?"
    ! grep -q '^--expires$' "$tmpdir/captured_args"
    assert_eq "strips --expires flag" "0" "$?"

    # Test: default category on create without --category
    grep -q '^API Credential$' "$tmpdir/captured_args"
    assert_eq "defaults to API Credential" "0" "$?"

    # Test: =style vault/title for expiry tracking
    rm -f "$tmpdir/expires"
    (handle_op_expires op item create --vault=Prod --title="api-key" --expires 2026-06-15) 2>/dev/null || true
    [[ -f "$tmpdir/expires" ]] && grep -q 'op://Prod/api-key' "$tmpdir/expires"
    assert_eq "tracks =style vault/title" "0" "$?"

    # Test: space-style vault/title for expiry tracking
    rm -f "$tmpdir/expires"
    (handle_op_expires op item create --vault Dev --title "space-key" --expires 2026-06-15) 2>/dev/null || true
    [[ -f "$tmpdir/expires" ]] && grep -q 'op://Dev/space-key' "$tmpdir/expires"
    assert_eq "tracks space-style vault/title" "0" "$?"

    # Test: invalid date rejected
    local err
    err=$( (handle_op_expires op item create --vault Dev --title "x" --expires "bad-date") 2>&1 ) || true
    echo "$err" | grep -q "invalid date"
    assert_eq "rejects invalid date" "0" "$?"

    # Cleanup
    unset -f op
    CONFIG_DIR="$old_config_dir"
    EXPIRES_FILE="$old_expires"
    rm -rf "$tmpdir"
}

test_resolve_token() {
    echo "==> resolve_token"

    load_config

    # Mock fetch_token to avoid Keychain dependency
    fetch_token() {
        case "$1" in
            "$READ_ACCOUNT")  echo "mock-read-token" ;;
            "$WRITE_ACCOUNT") echo "mock-write-token" ;;
        esac
    }

    assert_eq "explicit read" "mock-read-token" "$(resolve_token read op vault list)"
    assert_eq "explicit write" "mock-write-token" "$(resolve_token write op item create)"
    assert_eq "auto read" "mock-read-token" "$(resolve_token auto op vault list)"
    assert_eq "auto write" "mock-write-token" "$(resolve_token auto op item create)"
    assert_eq "auto non-op" "mock-read-token" "$(resolve_token auto env run)"

    # Restore real fetch_token
    # shellcheck source=../lib/keychain.sh
    source "$SCRIPT_DIR/lib/keychain.sh"
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
test_expires_threshold_validation
test_expires_file_permissions
test_seq_empty_array_safety
test_handle_op_expires
test_handle_op_expires_equals_syntax
test_edit_positional_arg_extraction
test_resolve_token
test_write_detection_extended
test_parse_llm_response
test_secrets_inspect
test_setup_single_account
test_cli_flags

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
