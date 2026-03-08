# shellcheck shell=bash
# Keychain token management and write detection

# --- Token fetching ---

# Check whether a configured helper binary is available.
# @returns 0 when KEYCHAIN_HELPER points to an executable file
has_keychain_helper() {
    [[ -n "${KEYCHAIN_HELPER:-}" && -x "$KEYCHAIN_HELPER" ]]
}

# Resolve the appropriate account based on mode and command args.
# @param $1 - mode: "read", "write", or "auto"
# @param $@ - remaining args (used for auto-detection)
# @returns account name on stdout
resolve_account() {
    local mode="$1"
    shift
    case "$mode" in
        read)  echo "$READ_ACCOUNT" ;;
        write) echo "$WRITE_ACCOUNT" ;;
        auto)
            if is_write_command "$@"; then
                echo "$WRITE_ACCOUNT"
            else
                echo "$READ_ACCOUNT"
            fi
            ;;
    esac
}

# Fetch a service account token from macOS Keychain or the optional helper.
# @param $1 - keychain account name
# @returns token string on stdout
# @throws exits 1 if token not found
fetch_token() {
    local account="$1"
    local token

    if has_keychain_helper; then
        token=$("$KEYCHAIN_HELPER" token --account "$account" 2>/dev/null) || {
            echo "Error: token not found via helper (account: $account)" >&2
            echo "" >&2
            echo "Check OPCHAIN_KEYCHAIN_HELPER or run 'opchain setup' to configure tokens." >&2
            exit 1
        }
        echo "$token"
        return 0
    fi

    token=$(security find-generic-password -a "$account" -s "$SECRET_NAME" -w 2>/dev/null) || {
        echo "Error: token not found in Keychain (account: $account)" >&2
        echo "" >&2
        echo "Run 'opchain setup' to configure tokens." >&2
        exit 1
    }
    echo "$token"
}

# Resolve the appropriate token based on mode and command args.
# @param $1 - mode: "read", "write", or "auto"
# @param $@ - remaining args (used for auto-detection)
# @returns token string on stdout
resolve_token() {
    local mode="$1"
    shift
    fetch_token "$(resolve_account "$mode" "$@")"
}

# Fetch the OpenRouter API key from Keychain.
# @returns API key on stdout (empty string if not configured)
fetch_llm_key() {
    security find-generic-password -a "$LLM_ACCOUNT" -s "OPENROUTER_API_KEY" -w 2>/dev/null || true
}

# Run a command with the account resolved for the given mode.
# Uses the helper binary when configured, otherwise exports the token locally.
# @param $1 - mode: read, write, or auto
# @param $@ - command to run
run_with_mode() {
    local mode="$1"
    shift

    local account
    account=$(resolve_account "$mode" "$@")

    if has_keychain_helper; then
        "$KEYCHAIN_HELPER" exec --account "$account" -- "$@"
        return $?
    fi

    local token
    token=$(fetch_token "$account")
    export OP_SERVICE_ACCOUNT_TOKEN="$token"
    "$@"
}

# Run a command and capture stdout with the account resolved for the given mode.
# This is just a named wrapper around run_with_mode for call sites that consume
# the command output rather than streaming it directly.
# @param $1 - mode: read, write, or auto
# @param $@ - command to run
run_with_mode_capture() {
    local mode="$1"
    shift
    run_with_mode "$mode" "$@"
}

# Export the read-only service account token for compatibility paths that still
# need the token value inside the current shell process.
# Most internal `op` calls now prefer run_with_mode/run_with_mode_capture.
# @sets OP_SERVICE_ACCOUNT_TOKEN environment variable
setup_read_token() {
    local token
    token=$(fetch_token "$READ_ACCOUNT")
    export OP_SERVICE_ACCOUNT_TOKEN="$token"
}

# --- Doctor ---

# Record a doctor result as a tab-delimited line.
# @param $1 - level: OK, WARN, or FAIL
# @param $2 - check name
# @param $3 - details
add_doctor_result() {
    local level="$1"
    local check="$2"
    local details="$3"
    DOCTOR_RESULTS+=("$level	$check	$details")
}

# Print a single doctor status line.
# @param $1 - level: OK, WARN, or FAIL
# @param $2 - check name
# @param $3 - details
print_doctor_status() {
    local level="$1"
    local check="$2"
    local details="$3"
    printf "  %-4s %s — %s\n" "$level" "$check" "$details"
}

# Escape a string for JSON output.
# @param $1 - raw string
# @returns JSON-escaped string on stdout
json_escape() {
    local value="$1"
    value=${value//\\/\\\\}
    value=${value//\"/\\\"}
    value=${value//$'\n'/\\n}
    value=${value//$'\r'/\\r}
    value=${value//$'\t'/\\t}
    printf '%s' "$value"
}

# Print collected doctor results in text format.
print_doctor_results_text() {
    echo "==> opchain doctor"
    local entry level check details
    for entry in "${DOCTOR_RESULTS[@]}"; do
        IFS=$'\t' read -r level check details <<< "$entry"
        print_doctor_status "$level" "$check" "$details"
    done
}

# Print collected doctor results in JSON format.
# @param $1 - 0 when healthy, non-zero when failing
# @param $2 - failure count
# @param $3 - warning count
print_doctor_results_json() {
    local ok="$1"
    local failures="$2"
    local warnings="$3"
    local first=1
    local entry level check details

    printf '{\n'
    printf '  "ok": %s,\n' "$ok"
    printf '  "failureCount": %s,\n' "$failures"
    printf '  "warningCount": %s,\n' "$warnings"
    printf '  "results": [\n'
    for entry in "${DOCTOR_RESULTS[@]}"; do
        IFS=$'\t' read -r level check details <<< "$entry"
        if [[ $first -eq 0 ]]; then
            printf ',\n'
        fi
        first=0
        printf '    {"level":"%s","check":"%s","details":"%s"}' \
            "$(json_escape "$level")" \
            "$(json_escape "$check")" \
            "$(json_escape "$details")"
    done
    printf '\n  ]\n}\n'
}

# Resolve a real filesystem path, following symlinks.
# @param $1 - path to resolve
# @returns resolved absolute path on stdout
resolve_real_path() {
    local path="$1"
    while [[ -L "$path" ]]; do
        local dir
        dir=$(cd "$(dirname "$path")" && pwd)
        path=$(readlink "$path")
        [[ "$path" != /* ]] && path="$dir/$path"
    done
    cd "$(dirname "$path")" && printf '%s/%s\n' "$(pwd)" "$(basename "$path")"
}

# Verify the configured helper signature via codesign.
# @returns 0 if the helper verifies successfully, 1 otherwise
verify_keychain_helper_signature() {
    codesign --verify --verbose=2 "$KEYCHAIN_HELPER" > /dev/null 2>&1
}

# Describe the helper signing identity from codesign metadata.
# @returns best-effort identity details on stdout
helper_signature_details() {
    local metadata identifier authority team
    metadata=$(codesign -dv --verbose=4 "$KEYCHAIN_HELPER" 2>&1 >/dev/null) || return 1
    identifier=$(printf '%s\n' "$metadata" | awk -F= '/^Identifier=/{print $2; exit}')
    authority=$(printf '%s\n' "$metadata" | awk -F= '/^Authority=/{print $2; exit}')
    team=$(printf '%s\n' "$metadata" | awk -F= '/^TeamIdentifier=/{print $2; exit}')

    local details=""
    [[ -n "$identifier" ]] && details="Identifier=$identifier"
    [[ -n "$authority" ]] && details="${details:+$details; }Authority=$authority"
    [[ -n "$team" ]] && details="${details:+$details; }TeamIdentifier=$team"
    printf '%s\n' "${details:-codesign metadata unavailable}"
}

# Verify the helper token subcommand without exposing the secret.
# @param $1 - keychain account name
# @returns 0 if the helper can read the account, 1 otherwise
verify_helper_token_access() {
    local account="$1"
    "$KEYCHAIN_HELPER" token --account "$account" > /dev/null 2>&1
}

# Verify the helper exec subcommand without printing the secret.
# @param $1 - keychain account name
# @returns 0 if the helper can exec with the account token, 1 otherwise
verify_helper_exec_access() {
    local account="$1"
    "$KEYCHAIN_HELPER" exec --account "$account" -- /bin/sh -c 'test -n "${OP_SERVICE_ACCOUNT_TOKEN:-}"' > /dev/null 2>&1
}

# Run diagnostic checks for helper configuration and token access.
# @param $1 - output format: text (default) or json
# @returns 0 on success, 1 if any required check fails
run_doctor() {
    local format="${1:-text}"
    local failures=0
    local warnings=0
    local helper_ready=1
    DOCTOR_RESULTS=()

    add_doctor_result "OK" "config" "$CONFIG_FILE"

    if [[ -z "${KEYCHAIN_HELPER:-}" ]]; then
        add_doctor_result "FAIL" "helper" "not configured; set OPCHAIN_KEYCHAIN_HELPER or keychain_helper"
        failures=$((failures + 1))
        helper_ready=0
    else
        add_doctor_result "OK" "helper" "$KEYCHAIN_HELPER"
    fi

    if [[ $helper_ready -eq 1 ]]; then
        if [[ "$KEYCHAIN_HELPER" == /* ]]; then
            add_doctor_result "OK" "helper path" "absolute"
        else
            add_doctor_result "FAIL" "helper path" "must be absolute"
            failures=$((failures + 1))
            helper_ready=0
        fi
    fi

    if [[ $helper_ready -eq 1 ]]; then
        if [[ -x "$KEYCHAIN_HELPER" ]]; then
            add_doctor_result "OK" "helper executable" "present"
        else
            add_doctor_result "FAIL" "helper executable" "missing or not executable"
            failures=$((failures + 1))
            helper_ready=0
        fi
    fi

    if [[ $helper_ready -eq 1 ]]; then
        local real_helper_path
        real_helper_path=$(resolve_real_path "$KEYCHAIN_HELPER")
        if [[ -L "$KEYCHAIN_HELPER" ]]; then
            add_doctor_result "WARN" "helper symlink" "configured path resolves to $real_helper_path"
            warnings=$((warnings + 1))
        else
            add_doctor_result "OK" "helper symlink" "not a symlink"
        fi
        add_doctor_result "OK" "helper realpath" "$real_helper_path"
    fi

    if [[ $helper_ready -eq 1 ]]; then
        if verify_keychain_helper_signature; then
            add_doctor_result "OK" "helper signature" "verified"
            add_doctor_result "OK" "helper identity" "$(helper_signature_details)"
        else
            add_doctor_result "FAIL" "helper signature" "codesign verification failed"
            failures=$((failures + 1))
            helper_ready=0
        fi
    fi

    if [[ $helper_ready -eq 1 ]]; then
        if verify_helper_token_access "$READ_ACCOUNT"; then
            add_doctor_result "OK" "helper token read" "$READ_ACCOUNT"
        else
            add_doctor_result "FAIL" "helper token read" "$READ_ACCOUNT"
            failures=$((failures + 1))
        fi

        if verify_helper_exec_access "$READ_ACCOUNT"; then
            add_doctor_result "OK" "helper exec read" "$READ_ACCOUNT"
        else
            add_doctor_result "FAIL" "helper exec read" "$READ_ACCOUNT"
            failures=$((failures + 1))
        fi

        if verify_helper_token_access "$WRITE_ACCOUNT"; then
            add_doctor_result "OK" "helper token write" "$WRITE_ACCOUNT"
        else
            add_doctor_result "FAIL" "helper token write" "$WRITE_ACCOUNT"
            failures=$((failures + 1))
        fi

        if verify_helper_exec_access "$WRITE_ACCOUNT"; then
            add_doctor_result "OK" "helper exec write" "$WRITE_ACCOUNT"
        else
            add_doctor_result "FAIL" "helper exec write" "$WRITE_ACCOUNT"
            failures=$((failures + 1))
        fi
    fi

    add_doctor_result "WARN" "keychain acl" "manual check required in Keychain Access; shell tooling cannot reliably inspect trusted-app bindings"
    warnings=$((warnings + 1))

    if [[ $failures -gt 0 ]]; then
        add_doctor_result "FAIL" "summary" "doctor found $failures failing check(s)"
    else
        add_doctor_result "OK" "summary" "helper configuration looks good"
    fi

    case "$format" in
        json) print_doctor_results_json "$( [[ $failures -eq 0 ]] && echo true || echo false )" "$failures" "$warnings" ;;
        *)    print_doctor_results_text ;;
    esac

    [[ $failures -eq 0 ]]
}

# --- Single-account setup ---

# Store a single token in Keychain for a named account.
# @param $1 - keychain account name
setup_single_account() {
    local account="$1"

    echo "opchain setup — store token for account: $account"
    echo ""

    if security find-generic-password -a "$account" -s "$SECRET_NAME" > /dev/null 2>&1; then
        echo "  Existing entry found."
        read -rp "  Overwrite? [y/N] " confirm
        if [[ "$confirm" != [yY] ]]; then
            echo "  Skipped."
            return 0
        fi
        security delete-generic-password -a "$account" -s "$SECRET_NAME" > /dev/null 2>&1 || true
    fi

    read -rsp "  Paste token: " token
    echo ""

    if [[ -z "$token" ]]; then
        echo "  Empty token, skipped."
        return 0
    fi

    security add-generic-password -a "$account" -s "$SECRET_NAME" -w "$token"
    echo "  Stored."
}

# --- Write detection ---

# Determine if an op command requires write access.
# Non-op commands always return false (read token).
# @param $@ - full command args
# @returns 0 if write, 1 if read
is_write_command() {
    [[ "${1:-}" != "op" ]] && return 1

    local subcommand="${2:-}"
    local action="${3:-}"

    case "$subcommand" in
        item)
            case "$action" in
                create|edit|delete|share|move) return 0 ;;
            esac
            ;;
        vault|document|group)
            case "$action" in
                create|edit|delete) return 0 ;;
            esac
            ;;
        user)
            case "$action" in
                provision|confirm|edit|delete|suspend|reactivate) return 0 ;;
            esac
            ;;
        connect)
            # op connect server/token create/edit/delete
            case "$action" in
                server|token) return 0 ;;
            esac
            ;;
    esac
    return 1
}
