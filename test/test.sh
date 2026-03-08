#!/bin/bash
# Local test runner for opchain
# Tests shell functions directly and CLI behavior with mocked op/security binaries.
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
keychain_helper=~/bin/opchain-keychain-helper
EOF

    load_config
    assert_eq "projects_dir from config" "$HOME/projects" "$PROJECTS_DIR"
    assert_eq "read_account from config" "custom-read" "$READ_ACCOUNT"
    assert_eq "write_account from config" "custom-write" "$WRITE_ACCOUNT"
    assert_eq "expires_threshold from config" "7" "$EXPIRES_THRESHOLD"
    assert_eq "llm_model from config" "openai/gpt-4o-mini" "$LLM_MODEL"
    assert_eq "keychain_helper from config" "$HOME/bin/opchain-keychain-helper" "$KEYCHAIN_HELPER"

    # Test env var override
    OPCHAIN_PROJECTS_DIR="/override/path" OPCHAIN_KEYCHAIN_HELPER="/override/helper" load_config
    assert_eq "env var overrides config" "/override/path" "$PROJECTS_DIR"
    assert_eq "helper env overrides config" "/override/helper" "$KEYCHAIN_HELPER"

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
    assert_eq "add writes structured record" $'Dev\ttest-item\t' "$(cat "$EXPIRES_FILE")"

    # duplicate
    add_expires_item "op://Dev/test-item"
    local count
    count=$(grep -c $'^Dev\ttest-item\t$' "$EXPIRES_FILE")
    assert_eq "no duplicate on re-add" "1" "$count"

    # second item
    add_expires_item "op://Dev/other-item"
    count=$(wc -l < "$EXPIRES_FILE" | tr -d ' ')
    assert_eq "two items tracked" "2" "$count"

    # load
    load_expires_list
    assert_eq "load returns 2 records" "2" "${#EXPIRES_RECORDS[@]}"
    assert_eq "compat refs still exposed" "op://Dev/test-item" "${EXPIRES_ITEMS[0]}"

    # remove
    remove_expires_item "op://Dev/test-item" > /dev/null
    assert_eq "remove leaves one" "1" "$(wc -l < "$EXPIRES_FILE" | tr -d ' ')"

    # Restore
    CONFIG_DIR="$old_config_dir"
    EXPIRES_FILE="$old_expires"
    rm -rf "$tmpdir"
}

test_legacy_expires_line_compatibility() {
    echo "==> legacy expires line compatibility"

    local tmpdir
    tmpdir=$(mktemp -d)
    local old_config_dir="$CONFIG_DIR"
    local old_expires="$EXPIRES_FILE"
    CONFIG_DIR="$tmpdir"
    EXPIRES_FILE="$tmpdir/expires"

    printf 'op://Dev/legacy-item\n' > "$EXPIRES_FILE"
    load_expires_list

    assert_eq "legacy line loads as one record" "1" "${#EXPIRES_RECORDS[@]}"
    assert_eq "legacy line normalizes to ref" "op://Dev/legacy-item" "${EXPIRES_ITEMS[0]}"
    assert_eq "legacy line gets empty cached title" "" "$(expires_record_title "${EXPIRES_RECORDS[0]}")"

    CONFIG_DIR="$old_config_dir"
    EXPIRES_FILE="$old_expires"
    rm -rf "$tmpdir"
}

test_tracking_ref_resolution() {
    echo "==> tracking ref resolution"

    local tmpdir
    tmpdir=$(mktemp -d)
    local old_config_dir="$CONFIG_DIR"
    local old_expires="$EXPIRES_FILE"
    CONFIG_DIR="$tmpdir"
    EXPIRES_FILE="$tmpdir/expires"

    setup_read_token() { true; }
    op() {
        if [[ "$1" == "item" && "$2" == "get" ]]; then
            cat << 'MOCK_JSON'
{"id":"item-123","title":"API Key"}
MOCK_JSON
            return 0
        fi
        return 1
    }

    assert_eq "stable ref resolved" "op://Dev/item-123" "$(resolve_tracking_ref "Dev" "api-key")"
    assert_exit "field path ref rejected" 1 is_valid_expires_ref "op://Dev/item-id/expires"
    assert_eq "display label shows cached title and ref" "API Key [op://Dev/item-123]" "$(tracking_display_label $'Dev\titem-123\tAPI Key')"

    track_expires_item "Dev" "api-key"
    assert_eq "tracked record uses item id and title" $'Dev\titem-123\tAPI Key' "$(cat "$EXPIRES_FILE")"

    unset -f op setup_read_token
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

test_secrets_validate_reports_expiry_warnings_on_failure() {
    echo "==> secrets_validate expiry warnings"

    local old_projects_dir="${PROJECTS_DIR:-}"
    PROJECTS_DIR="/tmp/mock-projects"

    setup_read_token() { true; }
    check_secret_target() {
        # shellcheck disable=SC2034  # Mock sets globals consumed by secrets_validate.
        SECRET_CHECK_FOUND=1
        # shellcheck disable=SC2034  # Mock sets globals consumed by secrets_validate.
        SECRET_CHECK_FAILURES=1
        echo "==> /tmp/mock-projects/.env.op"
        echo "  FAIL API_KEY (op://Dev/item-id/api-key)"
        echo ""
    }
    check_expires_warnings() {
        echo ""
        echo "==> Expiry Warnings"
        echo "  EXPIRING op://Dev/item-id (2026-06-15, 3 days)"
    }

    local output status
    output=$(secrets_validate 2>&1) && status=0 || status=$?
    assert_eq "validate exits non-zero on failures" "1" "$status"

    echo "$output" | grep -q "Expiry Warnings"
    assert_eq "warnings still shown when validation fails" "0" "$?"

    echo "$output" | grep -q "1 file(s) with failures"
    assert_eq "failure count still reported" "0" "$?"

    unset -f setup_read_token check_secret_target check_expires_warnings
    PROJECTS_DIR="$old_projects_dir"
}

test_handle_op_expires_equals_syntax() {
    echo "==> handle_op_expires --expires=DATE syntax"

    local tmpdir
    tmpdir=$(mktemp -d)
    local old_config_dir="$CONFIG_DIR"
    local old_expires="$EXPIRES_FILE"
    CONFIG_DIR="$tmpdir"
    EXPIRES_FILE="$tmpdir/expires"

    # Mock op: capture create args and resolve item IDs for tracking
    setup_read_token() { true; }
    op() {
        if [[ "$1" == "item" && "$2" == "get" ]]; then
            cat << 'MOCK_JSON'
{"id":"item-123"}
MOCK_JSON
            return 0
        fi
        printf '%s\n' "$@" > "$tmpdir/captured_args"
        return 0
    }

    # Test: --expires=DATE stripped and converted to field syntax
    (handle_op_expires op item create --vault Dev --title "eq-key" --expires=2026-06-15) 2>/dev/null || true
    grep -q 'expires\[date\]=2026-06-15' "$tmpdir/captured_args"
    assert_eq "=syntax converts to field" "0" "$?"
    ! grep -q '^--expires' "$tmpdir/captured_args"
    assert_eq "=syntax strips --expires" "0" "$?"

    # Test: expiry tracking resolves a stable item record with =syntax
    [[ -f "$tmpdir/expires" ]] && grep -q $'^Dev\titem-123\t$' "$tmpdir/expires"
    assert_eq "=syntax tracks item record" "0" "$?"

    # Test: invalid date rejected with =syntax
    local err
    err=$( (handle_op_expires op item create --vault Dev --title "x" --expires=bad-date) 2>&1 ) || true
    echo "$err" | grep -q "invalid date"
    assert_eq "=syntax rejects invalid date" "0" "$?"

    # Cleanup
    unset -f op setup_read_token
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
    setup_read_token() { true; }
    op() {
        if [[ "$1" == "item" && "$2" == "get" ]]; then
            cat << 'MOCK_JSON'
{"id":"item-123"}
MOCK_JSON
            return 0
        fi
        printf '%s\n' "$@" > "$tmpdir/captured_args"
        return 0
    }

    # Test: --vault=Dev style doesn't break positional arg extraction
    rm -f "$tmpdir/expires"
    (handle_op_expires op item edit --vault=Dev myitem --expires 2026-06-15) 2>/dev/null || true
    [[ -f "$tmpdir/expires" ]] && grep -q $'^Dev\titem-123\t$' "$tmpdir/expires"
    assert_eq "=style vault finds positional item record" "0" "$?"

    # Test: multiple --flag=value before positional arg
    rm -f "$tmpdir/expires"
    (handle_op_expires op item edit --vault=Prod --format=json myedit --expires 2026-06-15) 2>/dev/null || true
    [[ -f "$tmpdir/expires" ]] && grep -q $'^Prod\titem-123\t$' "$tmpdir/expires"
    assert_eq "multiple =style flags find positional item record" "0" "$?"

    # Test: mixed --flag value and --flag=value
    rm -f "$tmpdir/expires"
    (handle_op_expires op item edit --vault Staging --format=json editme --expires 2026-06-15) 2>/dev/null || true
    [[ -f "$tmpdir/expires" ]] && grep -q $'^Staging\titem-123\t$' "$tmpdir/expires"
    assert_eq "mixed flag styles find positional item record" "0" "$?"

    # Cleanup
    unset -f op setup_read_token
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

    # Invalid field type
    local bad_type_raw
    bad_type_raw=$(cat <<'JSON'
{"choices":[{"message":{"content":"{\"category\":\"Login\",\"fields\":[{\"name\":\"username\",\"type\":\"shell\"}]}"}}]}
JSON
)
    assert_exit "invalid field type rejected" 1 parse_llm_response "$bad_type_raw"

    # Unsafe field name
    local bad_name_raw
    bad_name_raw=$(cat <<'JSON'
{"choices":[{"message":{"content":"{\"category\":\"Login\",\"fields\":[{\"name\":\"--vault\",\"type\":\"text\"}]}"}}]}
JSON
)
    assert_exit "unsafe field name rejected" 1 parse_llm_response "$bad_name_raw"

    # Invalid fields shape
    local bad_shape_raw
    bad_shape_raw=$(cat <<'JSON'
{"choices":[{"message":{"content":"{\"category\":\"Login\",\"fields\":{\"name\":\"username\"}}"}}]}
JSON
)
    assert_exit "invalid fields shape rejected" 1 parse_llm_response "$bad_shape_raw"
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

    output=$("$opchain" env 2>&1 || true)
    echo "$output" | grep -q "only 'op' passthrough commands"
    assert_eq "non-op passthrough rejected" "0" "$?"
    assert_exit "non-op default → error" 1 "$opchain" env

    local tmpdir
    tmpdir=$(mktemp -d)
    cat > "$tmpdir/security" << 'EOF'
#!/bin/bash
if [[ "$1" == "find-generic-password" && "$2" == "-a" ]]; then
    echo "mock-token"
    exit 0
fi
exit 1
EOF
    chmod +x "$tmpdir/security"

    output=$(PATH="$tmpdir:$PATH" "$opchain" exec --read -- /bin/sh -c 'printf "%s" "${OP_SERVICE_ACCOUNT_TOKEN:+present}"')
    assert_eq "exec exports token only when requested" "present" "$output"

    output=$(PATH="$tmpdir:$PATH" "$opchain" exec --write -- /bin/echo nope 2>&1 || true)
    echo "$output" | grep -q "requires --confirm-write"
    assert_eq "write exec requires confirmation" "0" "$?"
    assert_exit "write exec without confirmation fails" 1 env PATH="$tmpdir:$PATH" "$opchain" exec --write -- /bin/echo nope

    output=$(PATH="$tmpdir:$PATH" "$opchain" exec --write --confirm-write -- /bin/sh -c 'printf "%s" "${OP_SERVICE_ACCOUNT_TOKEN:+present}"')
    assert_eq "write exec works with confirmation" "present" "$output"

    output=$("$opchain" doctor 2>&1 || true)
    echo "$output" | grep -q "not configured"
    assert_eq "doctor fails without helper" "0" "$?"
    assert_exit "doctor without helper exits non-zero" 1 "$opchain" doctor

    output=$("$opchain" doctor --json 2>&1 || true)
    echo "$output" | jq -e '.ok == false and .failureCount == 1 and .results[1].check == "helper"' > /dev/null 2>&1
    assert_eq "doctor json reports missing helper" "0" "$?"
    assert_exit "doctor json without helper exits non-zero" 1 "$opchain" doctor --json

    rm -rf "$tmpdir"
}

test_doctor_with_fake_helper() {
    echo "==> doctor with fake helper"

    local opchain="$SCRIPT_DIR/opchain"
    local tmpdir
    tmpdir=$(mktemp -d)

    cat > "$tmpdir/opchain-keychain-helper" << 'EOF'
#!/bin/bash
set -euo pipefail
state_dir="${OPCHAIN_FAKE_STATE:?}"
case "$1" in
    exec)
        account=""
        shift
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --account) account="$2"; shift 2 ;;
                --) shift; break ;;
                *) exit 1 ;;
            esac
        done
        printf '%s\n' "$account" >> "$state_dir/doctor_helper_exec_accounts"
        export OP_SERVICE_ACCOUNT_TOKEN="helper-$account"
        exec "$@"
        ;;
    token)
        [[ "$2" == "--account" ]] || exit 1
        printf '%s\n' "$3" >> "$state_dir/doctor_helper_token_accounts"
        printf 'helper-%s\n' "$3"
        ;;
    *) exit 1 ;;
esac
EOF
    chmod +x "$tmpdir/opchain-keychain-helper"

    cat > "$tmpdir/codesign" << 'EOF'
#!/bin/bash
if [[ "$1" == "--verify" ]]; then
    exit 0
fi
if [[ "$1" == "-dv" ]]; then
    echo 'Identifier=dev.kevin.opchain-keychain-helper' >&2
    echo 'Authority=opchain-local-signing' >&2
    echo 'TeamIdentifier=not set' >&2
    exit 0
fi
exit 1
EOF
    chmod +x "$tmpdir/codesign"

    local output
    output=$(PATH="$tmpdir:$PATH" OPCHAIN_FAKE_STATE="$tmpdir" OPCHAIN_KEYCHAIN_HELPER="$tmpdir/opchain-keychain-helper" "$opchain" doctor)
    echo "$output" | grep -q 'helper signature'
    assert_eq "doctor verifies helper signature" "0" "$?"
    echo "$output" | grep -q 'helper identity — Identifier=dev.kevin.opchain-keychain-helper; Authority=opchain-local-signing; TeamIdentifier=not set'
    assert_eq "doctor reports signing identity" "0" "$?"
    echo "$output" | grep -q 'helper symlink — not a symlink'
    assert_eq "doctor reports helper symlink state" "0" "$?"
    echo "$output" | grep -q 'keychain acl — manual check required'
    assert_eq "doctor warns about manual ACL check" "0" "$?"
    echo "$output" | grep -q 'summary — helper configuration looks good'
    assert_eq "doctor reports healthy summary" "0" "$?"

    output=$(PATH="$tmpdir:$PATH" OPCHAIN_FAKE_STATE="$tmpdir" OPCHAIN_KEYCHAIN_HELPER="$tmpdir/opchain-keychain-helper" "$opchain" doctor --json)
    echo "$output" | jq -e '.ok == true and .warningCount == 1 and (.results[] | select(.check == "helper identity") | .details == "Identifier=dev.kevin.opchain-keychain-helper; Authority=opchain-local-signing; TeamIdentifier=not set")' > /dev/null 2>&1
    assert_eq "doctor json reports identity and warning count" "0" "$?"
    echo "$output" | jq -e '([.results[] | select(.level == "WARN")] | length) == 1' > /dev/null 2>&1
    assert_eq "doctor json includes acl warning" "0" "$?"

    assert_eq "doctor checked helper token accounts" $'opchain-read\nopchain-write\nopchain-read\nopchain-write' "$(cat "$tmpdir/doctor_helper_token_accounts")"
    assert_eq "doctor checked helper exec accounts" $'opchain-read\nopchain-write\nopchain-read\nopchain-write' "$(cat "$tmpdir/doctor_helper_exec_accounts")"

    rm -rf "$tmpdir"
}

test_cli_integration_with_fake_op() {
    echo "==> CLI integration with fake op"

    local opchain="$SCRIPT_DIR/opchain"
    local tmpdir
    tmpdir=$(mktemp -d)

    cat > "$tmpdir/security" << 'EOF'
#!/bin/bash
account=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -a) account="$2"; shift 2 ;;
        *) shift ;;
    esac
done
case "$account" in
    opchain-read) echo "read-token" ;;
    opchain-write) echo "write-token" ;;
    *) exit 1 ;;
esac
EOF
    chmod +x "$tmpdir/security"

    cat > "$tmpdir/op" << 'EOF'
#!/bin/bash
set -euo pipefail
state_dir="${OPCHAIN_FAKE_STATE:?}"
if [[ "$1" == "vault" && "$2" == "list" && "${3:-}" == "--format=json" ]]; then
    printf '%s\n' "$OP_SERVICE_ACCOUNT_TOKEN" > "$state_dir/vault_list_token"
    printf '[{"name":"Dev"}]\n'
    exit 0
fi
if [[ "$1" == "item" && "$2" == "create" ]]; then
    printf '%s\n' "$OP_SERVICE_ACCOUNT_TOKEN" > "$state_dir/item_create_token"
    printf '%s\n' "$@" > "$state_dir/item_create_args"
    exit 0
fi
if [[ "$1" == "item" && "$2" == "get" ]]; then
    printf '{"id":"item-123","title":"Tracked API Key"}\n'
    exit 0
fi
if [[ "$1" == "read" && "$2" == "op://Dev/item-123/expires" ]]; then
    printf '2026-06-15\n'
    exit 0
fi
exit 1
EOF
    chmod +x "$tmpdir/op"

    local output
    output=$(PATH="$tmpdir:$PATH" OPCHAIN_FAKE_STATE="$tmpdir" XDG_CONFIG_HOME="$tmpdir/config" "$opchain" op vault list --format=json)
    assert_eq "read passthrough reaches fake op" "[{\"name\":\"Dev\"}]" "$output"
    assert_eq "read token selected for vault list" "read-token" "$(cat "$tmpdir/vault_list_token")"

    PATH="$tmpdir:$PATH" OPCHAIN_FAKE_STATE="$tmpdir" XDG_CONFIG_HOME="$tmpdir/config" "$opchain" op item create --vault Dev --title "api-key" --expires 2026-06-15 > /dev/null
    assert_eq "write token selected for create" "write-token" "$(cat "$tmpdir/item_create_token")"
    grep -q '^expires\[date\]=2026-06-15$' "$tmpdir/item_create_args"
    assert_eq "expires passthrough adds field" "0" "$?"
    grep -q '^API Credential$' "$tmpdir/item_create_args"
    assert_eq "expires passthrough adds default category" "0" "$?"
    assert_eq "auto-tracking stores structured record" $'Dev\titem-123\tTracked API Key' "$(cat "$tmpdir/config/opchain/expires")"

    output=$(PATH="$tmpdir:$PATH" OPCHAIN_FAKE_STATE="$tmpdir" XDG_CONFIG_HOME="$tmpdir/config" "$opchain" expires)
    echo "$output" | grep -q 'Tracked API Key \[op://Dev/item-123\]'
    assert_eq "expires output shows title and stable ref" "0" "$?"

    rm -rf "$tmpdir"
}

test_cli_integration_with_fake_helper() {
    echo "==> CLI integration with fake helper"

    local opchain="$SCRIPT_DIR/opchain"
    local tmpdir
    tmpdir=$(mktemp -d)

    cat > "$tmpdir/opchain-keychain-helper" << 'EOF'
#!/bin/bash
set -euo pipefail
state_dir="${OPCHAIN_FAKE_STATE:?}"
case "$1" in
    exec)
        account=""
        shift
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --account) account="$2"; shift 2 ;;
                --) shift; break ;;
                *) exit 1 ;;
            esac
        done
        printf '%s\n' "$account" >> "$state_dir/helper_exec_accounts"
        export OP_SERVICE_ACCOUNT_TOKEN="helper-$account"
        exec "$@"
        ;;
    token)
        [[ "$2" == "--account" ]] || exit 1
        printf '%s\n' "$3" >> "$state_dir/helper_token_accounts"
        printf 'helper-%s\n' "$3"
        ;;
    *) exit 1 ;;
esac
EOF
    chmod +x "$tmpdir/opchain-keychain-helper"

    cat > "$tmpdir/op" << 'EOF'
#!/bin/bash
set -euo pipefail
state_dir="${OPCHAIN_FAKE_STATE:?}"
if [[ "$1" == "vault" && "$2" == "list" && "${3:-}" == "--format=json" ]]; then
    printf '%s\n' "$OP_SERVICE_ACCOUNT_TOKEN" > "$state_dir/helper_vault_list_token"
    printf '[{"name":"Dev"}]\n'
    exit 0
fi
if [[ "$1" == "read" && "$2" == "op://Dev/item-123/expires" ]]; then
    printf '%s\n' "$OP_SERVICE_ACCOUNT_TOKEN" > "$state_dir/helper_expires_read_token"
    printf '2026-06-15\n'
    exit 0
fi
exit 1
EOF
    chmod +x "$tmpdir/op"

    mkdir -p "$tmpdir/config/opchain"
    printf 'Dev\titem-123\tCached Title\n' > "$tmpdir/config/opchain/expires"

    local output
    output=$(PATH="$tmpdir:$PATH" OPCHAIN_FAKE_STATE="$tmpdir" XDG_CONFIG_HOME="$tmpdir/config" OPCHAIN_KEYCHAIN_HELPER="$tmpdir/opchain-keychain-helper" "$opchain" op vault list --format=json)
    assert_eq "helper passthrough reaches fake op" "[{\"name\":\"Dev\"}]" "$output"
    assert_eq "helper exec selected read account" "opchain-read" "$(cat "$tmpdir/helper_exec_accounts")"
    assert_eq "helper exec injected read token" "helper-opchain-read" "$(cat "$tmpdir/helper_vault_list_token")"

    output=$(PATH="$tmpdir:$PATH" OPCHAIN_FAKE_STATE="$tmpdir" XDG_CONFIG_HOME="$tmpdir/config" OPCHAIN_KEYCHAIN_HELPER="$tmpdir/opchain-keychain-helper" "$opchain" expires)
    echo "$output" | grep -q 'Cached Title \[op://Dev/item-123\]'
    assert_eq "expires uses cached title with helper" "0" "$?"
    assert_eq "helper exec used for top-level and internal read flows" $'opchain-read\nopchain-read' "$(cat "$tmpdir/helper_exec_accounts")"
    assert_eq "internal read got helper exec token" "helper-opchain-read" "$(cat "$tmpdir/helper_expires_read_token")"
    if [[ -f "$tmpdir/helper_token_accounts" ]]; then
        assert_eq "helper token path not used for expires" "" "$(cat "$tmpdir/helper_token_accounts")"
    else
        assert_eq "helper token path not used for expires" "missing" "missing"
    fi

    rm -rf "$tmpdir"
}

test_handle_op_expires() {
    echo "==> handle_op_expires"

    local tmpdir
    tmpdir=$(mktemp -d)
    local old_config_dir="$CONFIG_DIR"
    local old_expires="$EXPIRES_FILE"
    CONFIG_DIR="$tmpdir"
    EXPIRES_FILE="$tmpdir/expires"

    # Mock op: capture create args and resolve item IDs for tracking
    setup_read_token() { true; }
    op() {
        if [[ "$1" == "item" && "$2" == "get" ]]; then
            cat << 'MOCK_JSON'
{"id":"item-123"}
MOCK_JSON
            return 0
        fi
        printf '%s\n' "$@" > "$tmpdir/captured_args"
        return 0
    }

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
    [[ -f "$tmpdir/expires" ]] && grep -q $'^Prod\titem-123\t$' "$tmpdir/expires"
    assert_eq "tracks =style vault/title item record" "0" "$?"

    # Test: space-style vault/title for expiry tracking
    rm -f "$tmpdir/expires"
    (handle_op_expires op item create --vault Dev --title "space-key" --expires 2026-06-15) 2>/dev/null || true
    [[ -f "$tmpdir/expires" ]] && grep -q $'^Dev\titem-123\t$' "$tmpdir/expires"
    assert_eq "tracks space-style vault/title item record" "0" "$?"

    # Test: invalid date rejected
    local err
    err=$( (handle_op_expires op item create --vault Dev --title "x" --expires "bad-date") 2>&1 ) || true
    echo "$err" | grep -q "invalid date"
    assert_eq "rejects invalid date" "0" "$?"

    # Cleanup
    unset -f op setup_read_token
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

test_fetch_token_with_helper() {
    echo "==> fetch_token with helper"

    local tmpdir
    tmpdir=$(mktemp -d)
    local old_helper="${KEYCHAIN_HELPER:-}"

    cat > "$tmpdir/helper" << 'EOF'
#!/bin/bash
if [[ "$1" == "token" && "$2" == "--account" ]]; then
    echo "helper-$3"
    exit 0
fi
exit 1
EOF
    chmod +x "$tmpdir/helper"

    KEYCHAIN_HELPER="$tmpdir/helper"
    assert_eq "helper fetches read token" "helper-opchain-read" "$(fetch_token "opchain-read")"
    assert_eq "helper resolves write account" "opchain-write" "$(resolve_account auto op item create)"

    KEYCHAIN_HELPER="$old_helper"
    rm -rf "$tmpdir"
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
test_legacy_expires_line_compatibility
test_tracking_ref_resolution
test_expires_threshold_validation
test_expires_file_permissions
test_seq_empty_array_safety
test_handle_op_expires
test_handle_op_expires_equals_syntax
test_edit_positional_arg_extraction
test_resolve_token
test_fetch_token_with_helper
test_write_detection_extended
test_parse_llm_response
test_secrets_inspect
test_secrets_validate_reports_expiry_warnings_on_failure
test_setup_single_account
test_cli_flags
test_doctor_with_fake_helper
test_cli_integration_with_fake_op
test_cli_integration_with_fake_helper

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
