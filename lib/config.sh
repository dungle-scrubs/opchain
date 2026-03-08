# shellcheck shell=bash
# shellcheck disable=SC2034  # Variables here are used by other sourced modules
# Config loading, constants, and utility functions

# x-release-please-version
VERSION="0.4.0"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opchain"
CONFIG_FILE="$CONFIG_DIR/config"
EXPIRES_FILE="$CONFIG_DIR/expires"
SECRET_NAME="OP_SERVICE_ACCOUNT_TOKEN"

# Defaults (overridden by config file, then env vars)
DEFAULT_PROJECTS_DIR="$HOME/dev"
DEFAULT_READ_ACCOUNT="opchain-read"
DEFAULT_WRITE_ACCOUNT="opchain-write"
DEFAULT_EXPIRES_THRESHOLD=14
DEFAULT_LLM_ACCOUNT="opchain-llm"
DEFAULT_LLM_MODEL="anthropic/claude-3.5-haiku"

# Fallback categories when op CLI is unavailable
FALLBACK_CATEGORIES=(
    "Login" "Secure Note" "Credit Card" "Identity" "Password"
    "Document" "API Credential" "Bank Account" "Crypto Wallet"
    "Database" "Driver License" "Email Account" "Medical Record"
    "Membership" "Outdoor License" "Passport" "Reward Program"
    "SSH Key" "Server" "Social Security Number" "Software License"
    "Wireless Router"
)

# Runtime categories — populated by fetch_categories() in create flow,
# falls back to FALLBACK_CATEGORIES elsewhere
OP_CATEGORIES=("${FALLBACK_CATEGORIES[@]}")

# --- Utilities ---

# Trim leading/trailing whitespace without xargs (which mangles quotes/backslashes).
# @param $1 - string to trim
# @returns trimmed string
trim() {
    local var="$1"
    var="${var#"${var%%[![:space:]]*}"}"
    var="${var%"${var##*[![:space:]]}"}"
    echo "$var"
}

# --- Config ---

# Load config from file and env vars (three-tier: defaults → file → env).
# Sets: PROJECTS_DIR, READ_ACCOUNT, WRITE_ACCOUNT, EXPIRES_THRESHOLD,
#        LLM_ACCOUNT, LLM_MODEL, KEYCHAIN_HELPER
load_config() {
    local projects_dir="$DEFAULT_PROJECTS_DIR"
    local read_account="$DEFAULT_READ_ACCOUNT"
    local write_account="$DEFAULT_WRITE_ACCOUNT"
    local expires_threshold="$DEFAULT_EXPIRES_THRESHOLD"
    local llm_account="$DEFAULT_LLM_ACCOUNT"
    local llm_model="$DEFAULT_LLM_MODEL"
    local keychain_helper=""

    if [[ -f "$CONFIG_FILE" ]]; then
        local key value
        while IFS='=' read -r key value; do
            [[ -z "$key" || "$key" =~ ^# ]] && continue
            key=$(trim "$key")
            value=$(trim "$value")
            case "$key" in
                projects_dir)      projects_dir="$value" ;;
                read_account)      read_account="$value" ;;
                write_account)     write_account="$value" ;;
                expires_threshold) expires_threshold="$value" ;;
                llm_account)       llm_account="$value" ;;
                llm_model)         llm_model="$value" ;;
                keychain_helper)   keychain_helper="$value" ;;
            esac
        done < "$CONFIG_FILE"
    fi

    # Env vars override config file
    PROJECTS_DIR="${OPCHAIN_PROJECTS_DIR:-$projects_dir}"
    READ_ACCOUNT="${OPCHAIN_READ_ACCOUNT:-$read_account}"
    WRITE_ACCOUNT="${OPCHAIN_WRITE_ACCOUNT:-$write_account}"
    EXPIRES_THRESHOLD="${OPCHAIN_EXPIRES_THRESHOLD:-$expires_threshold}"
    LLM_ACCOUNT="${OPCHAIN_LLM_ACCOUNT:-$llm_account}"
    LLM_MODEL="${OPCHAIN_LLM_MODEL:-$llm_model}"
    KEYCHAIN_HELPER="${OPCHAIN_KEYCHAIN_HELPER:-$keychain_helper}"

    # Validate expires_threshold is a positive integer (bash 3.2 crashes on
    # non-numeric values in [[ -le ]] comparisons under set -u)
    if ! [[ "$EXPIRES_THRESHOLD" =~ ^[0-9]+$ ]]; then
        echo "Warning: invalid expires_threshold '$EXPIRES_THRESHOLD', using default ($DEFAULT_EXPIRES_THRESHOLD)" >&2
        EXPIRES_THRESHOLD="$DEFAULT_EXPIRES_THRESHOLD"
    fi

    # Expand tilde
    PROJECTS_DIR="${PROJECTS_DIR/#\~/$HOME}"
    KEYCHAIN_HELPER="${KEYCHAIN_HELPER/#\~/$HOME}"
}

# --- Date utilities ---

# Validate a YYYY-MM-DD date string.
# @param $1 - date string
# @returns 0 if valid, 1 otherwise
validate_date() {
    local input="$1"
    [[ "$input" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || return 1
    local roundtrip
    roundtrip=$(date -j -f "%Y-%m-%d" "$input" "+%Y-%m-%d" 2>/dev/null) || return 1
    [[ "$roundtrip" == "$input" ]]
}

# Calculate days from today until a target date.
# Uses midnight-to-midnight comparison to avoid time-of-day truncation.
# @param $1 - target date (YYYY-MM-DD)
# @returns number of days (negative if past)
days_until() {
    local target="$1"
    local target_epoch today_epoch
    target_epoch=$(date -j -f "%Y-%m-%d" "$target" "+%s" 2>/dev/null) || return 1
    today_epoch=$(date -j -f "%Y-%m-%d" "$(date +%Y-%m-%d)" "+%s")
    echo $(( (target_epoch - today_epoch) / 86400 ))
}
