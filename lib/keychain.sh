# shellcheck shell=bash
# Keychain token management and write detection

# --- Token fetching ---

# Fetch a service account token from macOS Keychain.
# @param $1 - keychain account name
# @returns token string on stdout
# @throws exits 1 if token not found
fetch_token() {
    local account="$1"
    local token
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
    case "$mode" in
        read)  fetch_token "$READ_ACCOUNT" ;;
        write) fetch_token "$WRITE_ACCOUNT" ;;
        auto)
            if is_write_command "$@"; then
                fetch_token "$WRITE_ACCOUNT"
            else
                fetch_token "$READ_ACCOUNT"
            fi
            ;;
    esac
}

# Fetch the OpenRouter API key from Keychain.
# @returns API key on stdout (empty string if not configured)
fetch_llm_key() {
    security find-generic-password -a "$LLM_ACCOUNT" -s "OPENROUTER_API_KEY" -w 2>/dev/null || true
}

# Export the read-only service account token for direct op CLI calls.
# Internal subcommands (secrets check, expires list, create) call op directly
# after the token is set — they don't re-enter opchain's command dispatch
# because these are always read operations.
# @sets OP_SERVICE_ACCOUNT_TOKEN environment variable
setup_read_token() {
    local token
    token=$(fetch_token "$READ_ACCOUNT")
    export OP_SERVICE_ACCOUNT_TOKEN="$token"
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
        item|vault|document|group)
            case "$action" in
                create|edit|delete|share|move) return 0 ;;
            esac
            ;;
    esac
    return 1
}
