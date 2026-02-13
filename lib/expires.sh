# shellcheck shell=bash
# Token expiry tracking

# --- Status ---

# Classify an item's expiry status based on days remaining.
# @param $1 - days until expiry (negative = past)
# @returns status string: EXPIRED, EXPIRING, or OK
expires_status() {
    local days="$1"
    if [[ $days -lt 0 ]]; then
        echo "EXPIRED"
    elif [[ $days -le $EXPIRES_THRESHOLD ]]; then
        echo "EXPIRING"
    else
        echo "OK"
    fi
}

# --- Watch file ---

# Load tracked items from the expires watch file into EXPIRES_ITEMS array.
load_expires_list() {
    EXPIRES_ITEMS=()
    [[ -f "$EXPIRES_FILE" ]] || return 0
    while IFS= read -r line; do
        [[ -z "$line" || "$line" =~ ^# ]] && continue
        EXPIRES_ITEMS+=("$line")
    done < "$EXPIRES_FILE"
}

# Add an op:// reference to the expires watch file (idempotent).
# @param $1 - op:// reference (e.g., op://vault/item)
add_expires_item() {
    local ref="$1"
    mkdir -p "$CONFIG_DIR" && chmod 700 "$CONFIG_DIR"
    if [[ -f "$EXPIRES_FILE" ]] && grep -qxF "$ref" "$EXPIRES_FILE"; then
        return 0
    fi
    echo "$ref" >> "$EXPIRES_FILE"
    chmod 600 "$EXPIRES_FILE"
}

# Remove an op:// reference from the expires watch file.
# @param $1 - op:// reference
# @returns 1 if not tracked
remove_expires_item() {
    local ref="$1"
    if [[ ! -f "$EXPIRES_FILE" ]]; then
        echo "No items tracked." >&2
        return 1
    fi
    if ! grep -qxF "$ref" "$EXPIRES_FILE"; then
        echo "Not tracked: $ref" >&2
        return 1
    fi
    local tmp_file
    tmp_file=$(mktemp "${EXPIRES_FILE}.XXXXXX")
    grep -vxF "$ref" "$EXPIRES_FILE" > "$tmp_file" || true
    mv "$tmp_file" "$EXPIRES_FILE"
    chmod 600 "$EXPIRES_FILE"
    echo "Removed: $ref"
}

# --- Dispatch ---

# Route expires subcommands.
# @param $1 - subcommand: list (default), add, or remove
# @param $@ - remaining args
handle_expires() {
    local subcmd="${1:-list}"
    shift || true

    case "$subcmd" in
        list)   expires_list "$@" ;;
        add)    expires_add "$@" ;;
        remove) expires_remove "$@" ;;
        *)
            echo "Usage: opchain expires [list|add|remove] [ref]" >&2
            exit 1
            ;;
    esac
}

# --- Subcommands ---

# List all tracked items with their expiry status.
expires_list() {
    load_config
    load_expires_list

    if [[ ${#EXPIRES_ITEMS[@]} -eq 0 ]]; then
        echo "No items tracked."
        echo "Use 'opchain expires add op://vault/item' to track an item."
        return 0
    fi

    local token
    token=$(fetch_token "$READ_ACCOUNT")
    export OP_SERVICE_ACCOUNT_TOKEN="$token"

    echo "==> Tracked Items"
    local ref
    for ref in "${EXPIRES_ITEMS[@]}"; do
        local date_value
        if date_value=$(op read "$ref/expires" 2>/dev/null); then
            local days
            if days=$(days_until "$date_value"); then
                local status
                status=$(expires_status "$days")
                case "$status" in
                    EXPIRED)
                        local ago=$(( -days ))
                        printf "  %-8s %s (%s, %d days ago)\n" "$status" "$ref" "$date_value" "$ago"
                        ;;
                    *)
                        printf "  %-8s %s (%s, %d days)\n" "$status" "$ref" "$date_value" "$days"
                        ;;
                esac
            else
                printf "  %-8s %s (invalid date: %s)\n" "FAIL" "$ref" "$date_value"
            fi
        else
            printf "  %-8s %s (could not read)\n" "FAIL" "$ref"
        fi
    done
}

# Track an op:// item for expiry monitoring.
# @param $1 - op:// reference
expires_add() {
    local ref="${1:-}"
    if [[ -z "$ref" ]]; then
        echo "Usage: opchain expires add <op://vault/item>" >&2
        exit 1
    fi
    if [[ "$ref" != op://* ]]; then
        echo "Error: reference must start with op://" >&2
        exit 1
    fi
    add_expires_item "$ref"
    echo "Tracking: $ref"
}

# Stop tracking an item.
# @param $1 - op:// reference
expires_remove() {
    local ref="${1:-}"
    if [[ -z "$ref" ]]; then
        echo "Usage: opchain expires remove <op://vault/item>" >&2
        exit 1
    fi
    remove_expires_item "$ref"
}

# Print warnings for EXPIRING/EXPIRED items (called after secrets validate).
check_expires_warnings() {
    load_expires_list
    [[ ${#EXPIRES_ITEMS[@]} -gt 0 ]] || return 0

    local warnings=()
    local ref
    for ref in "${EXPIRES_ITEMS[@]}"; do
        local date_value
        if date_value=$(op read "$ref/expires" 2>/dev/null); then
            local days
            if days=$(days_until "$date_value"); then
                local status
                status=$(expires_status "$days")
                case "$status" in
                    EXPIRED)
                        local ago=$(( -days ))
                        warnings+=("$(printf "  %-8s %s (%s, %d days ago)" "$status" "$ref" "$date_value" "$ago")")
                        ;;
                    EXPIRING)
                        warnings+=("$(printf "  %-8s %s (%s, %d days)" "$status" "$ref" "$date_value" "$days")")
                        ;;
                esac
            fi
        fi
    done

    if [[ ${#warnings[@]} -gt 0 ]]; then
        echo ""
        echo "==> Expiry Warnings"
        for line in "${warnings[@]}"; do
            echo "$line"
        done
    fi
}
