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

# Sanitize a cached item title before persisting it in the expires file.
# Tabs/newlines would corrupt the tab-delimited storage format.
# @param $1 - raw title
# @returns sanitized title
sanitize_expires_title() {
    local title="$1"
    title=${title//$'\t'/ }
    title=${title//$'\n'/ }
    title=${title//$'\r'/ }
    printf '%s\n' "$title"
}

# Build a tab-delimited expires record.
# Format: vault<TAB>item-id<TAB>cached title
# @param $1 - vault name
# @param $2 - item ID
# @param $3 - cached title (optional)
# @returns record string on stdout
build_expires_record() {
    local vault="$1"
    local item_id="$2"
    local title="${3:-}"
    title=$(sanitize_expires_title "$title")
    printf '%s\t%s\t%s\n' "$vault" "$item_id" "$title"
}

# Convert an expires record to an op:// ref.
# @param $1 - tab-delimited expires record
# @returns op://vault/item-id on stdout
expires_record_ref() {
    local record="$1"
    local vault item_id _title
    IFS=$'\t' read -r vault item_id _title <<< "$record"
    printf 'op://%s/%s\n' "$vault" "$item_id"
}

# Return the cached title from an expires record.
# @param $1 - tab-delimited expires record
# @returns cached title on stdout (may be empty)
expires_record_title() {
    local record="$1"
    local _vault _item_id title
    IFS=$'\t' read -r _vault _item_id title <<< "$record"
    printf '%s\n' "$title"
}

# Parse either a legacy ref line or a structured record line.
# Legacy lines are normalized to a record with an empty cached title.
# @param $1 - line from the expires file
# @returns normalized record on stdout
parse_expires_record() {
    local line="$1"

    if [[ "$line" == op://* ]]; then
        local parsed vault item_id
        parsed=$(parse_tracking_ref "$line") || return 1
        vault="${parsed%%$'\t'*}"
        item_id="${parsed#*$'\t'}"
        build_expires_record "$vault" "$item_id" ""
        return 0
    fi

    local vault item_id title
    IFS=$'\t' read -r vault item_id title <<< "$line"
    [[ -n "$vault" && -n "$item_id" ]] || return 1
    build_expires_record "$vault" "$item_id" "$title"
}

# Persist the loaded expires records back to disk.
# @param $@ - tab-delimited expires records
save_expires_records() {
    local records=("$@")
    mkdir -p "$CONFIG_DIR" && chmod 700 "$CONFIG_DIR"
    : > "$EXPIRES_FILE"

    if [[ ${#records[@]} -gt 0 ]]; then
        local record
        for record in "${records[@]}"; do
            printf '%s\n' "$record" >> "$EXPIRES_FILE"
        done
    fi

    chmod 600 "$EXPIRES_FILE"
}

# Load tracked items from the expires watch file.
# Sets:
#   EXPIRES_RECORDS - structured tab-delimited records
#   EXPIRES_ITEMS   - normalized op:// refs for compatibility
load_expires_list() {
    EXPIRES_RECORDS=()
    EXPIRES_ITEMS=()
    [[ -f "$EXPIRES_FILE" ]] || return 0

    while IFS= read -r line; do
        [[ -z "$line" || "$line" =~ ^# ]] && continue

        local record
        record=$(parse_expires_record "$line") || continue
        EXPIRES_RECORDS+=("$record")
        EXPIRES_ITEMS+=("$(expires_record_ref "$record")")
    done < "$EXPIRES_FILE"
}

# Validate the stored tracking ref format.
# Expected format: op://vault/item-id
# @param $1 - op:// reference
# @returns 0 if valid, 1 otherwise
is_valid_expires_ref() {
    local ref="$1"
    [[ "$ref" =~ ^op://[^/]+/[^/]+$ ]]
}

# Parse a stored tracking ref into vault and item ID.
# @param $1 - op://vault/item-id reference
# @returns tab-delimited vault and item ID on stdout
parse_tracking_ref() {
    local ref="$1"
    is_valid_expires_ref "$ref" || return 1

    local path="${ref#op://}"
    local vault="${path%%/*}"
    local item_id="${path#*/}"
    printf '%s\t%s\n' "$vault" "$item_id"
}

# Add or update a structured expires record.
# Records are unique by vault + item ID. A non-empty title refreshes the cache.
# @param $1 - tab-delimited expires record
add_expires_record() {
    local record="$1"
    local new_vault new_item_id new_title
    IFS=$'\t' read -r new_vault new_item_id new_title <<< "$record"

    load_expires_list

    local updated=0
    local records=()
    if [[ ${#EXPIRES_RECORDS[@]} -gt 0 ]]; then
        local existing
        for existing in "${EXPIRES_RECORDS[@]}"; do
            local vault item_id title
            IFS=$'\t' read -r vault item_id title <<< "$existing"

            if [[ "$vault" == "$new_vault" && "$item_id" == "$new_item_id" ]]; then
                if [[ -n "$new_title" ]]; then
                    records+=("$(build_expires_record "$new_vault" "$new_item_id" "$new_title")")
                else
                    records+=("$existing")
                fi
                updated=1
            else
                records+=("$existing")
            fi
        done
    fi

    if [[ $updated -eq 0 ]]; then
        records+=("$(build_expires_record "$new_vault" "$new_item_id" "$new_title")")
    fi

    save_expires_records ${records[@]+"${records[@]}"}
}

# Add an op:// reference to the expires watch file (idempotent).
# Manual adds have no cached title until opchain auto-tracks or refreshes them.
# @param $1 - op:// reference (e.g., op://vault/item-id)
add_expires_item() {
    local ref="$1"
    local parsed vault item_id
    parsed=$(parse_tracking_ref "$ref") || return 1
    vault="${parsed%%$'\t'*}"
    item_id="${parsed#*$'\t'}"
    add_expires_record "$(build_expires_record "$vault" "$item_id" "")"
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

    load_expires_list

    local removed=0
    local records=()
    if [[ ${#EXPIRES_RECORDS[@]} -gt 0 ]]; then
        local record
        for record in "${EXPIRES_RECORDS[@]}"; do
            if [[ "$(expires_record_ref "$record")" == "$ref" ]]; then
                removed=1
                continue
            fi
            records+=("$record")
        done
    fi

    if [[ $removed -eq 0 ]]; then
        echo "Not tracked: $ref" >&2
        return 1
    fi

    save_expires_records ${records[@]+"${records[@]}"}
    echo "Removed: $ref"
}

# Resolve vault, item ID, and cached title from 1Password metadata.
# Requires jq because the op CLI exposes metadata in JSON output.
# @param $1 - vault name
# @param $2 - item identifier (title or UUID)
# @returns tab-delimited vault, item ID, cached title on stdout
resolve_tracking_info() {
    local vault="$1"
    local identifier="$2"
    [[ -n "$vault" && -n "$identifier" ]] || return 1
    command -v jq > /dev/null 2>&1 || return 1

    local json item_id title
    json=$(run_with_mode_capture read op item get "$identifier" --vault "$vault" --format json 2>/dev/null) || return 1
    item_id=$(printf '%s' "$json" | jq -r '.id // empty' 2>/dev/null) || return 1
    title=$(printf '%s' "$json" | jq -r '.title // .overview.title // empty' 2>/dev/null) || title=""
    [[ -n "$item_id" ]] || return 1

    printf '%s\t%s\t%s\n' "$vault" "$item_id" "$(sanitize_expires_title "$title")"
}

# Resolve a vault + item identifier to a stable op://vault/item-id ref.
# Requires jq because the op CLI only exposes the item ID in JSON output.
# @param $1 - vault name
# @param $2 - item identifier (title or UUID)
# @returns stable op:// ref on stdout
resolve_tracking_ref() {
    local info
    info=$(resolve_tracking_info "$1" "$2") || return 1
    local vault item_id _title
    IFS=$'\t' read -r vault item_id _title <<< "$info"
    printf 'op://%s/%s\n' "$vault" "$item_id"
}

# Build a human-readable display label from a structured record.
# Falls back to the raw ref when no cached title is available.
# @param $1 - tab-delimited expires record
# @returns display label on stdout
tracking_display_label() {
    local record="$1"
    local ref title
    ref=$(expires_record_ref "$record")
    title=$(expires_record_title "$record")

    if [[ -n "$title" ]]; then
        printf '%s [%s]\n' "$title" "$ref"
    else
        printf '%s\n' "$ref"
    fi
}

# Track an item using a stable identifier and cached title when possible.
# Skips tracking rather than storing a fragile ref.
# @param $1 - vault name
# @param $2 - item identifier (title or UUID)
track_expires_item() {
    local vault="$1"
    local identifier="$2"
    local info

    info=$(resolve_tracking_info "$vault" "$identifier") || {
        echo "Warning: could not resolve stable tracking ref for '$vault/$identifier'; expiry tracking skipped." >&2
        return 1
    }

    local tracked_vault item_id title
    IFS=$'\t' read -r tracked_vault item_id title <<< "$info"
    add_expires_record "$(build_expires_record "$tracked_vault" "$item_id" "$title")"
}

# --- Passthrough interception ---

# Intercept --expires flag on `op item create/edit` passthrough commands.
# Strips --expires, appends the date as an op field, and auto-tracks for expiry.
# @param $@ - full command args (starting with "op")
# @returns exit code from op command
handle_op_expires() {
    local all_args=("$@")
    local expires_date=""
    local new_args=()
    local skip_next=0

    for ((i = 0; i < ${#all_args[@]}; i++)); do
        if [[ $skip_next -eq 1 ]]; then
            skip_next=0
            continue
        fi
        if [[ "${all_args[$i]}" == --expires=* ]]; then
            expires_date="${all_args[$i]#--expires=}"
            if ! validate_date "$expires_date"; then
                echo "Error: invalid date '$expires_date' (expected YYYY-MM-DD)" >&2
                exit 1
            fi
        elif [[ "${all_args[$i]}" == "--expires" ]]; then
            local next=$((i + 1))
            if [[ $next -ge ${#all_args[@]} ]]; then
                echo "Error: --expires requires a YYYY-MM-DD date" >&2
                exit 1
            fi
            expires_date="${all_args[$next]}"
            if ! validate_date "$expires_date"; then
                echo "Error: invalid date '$expires_date' (expected YYYY-MM-DD)" >&2
                exit 1
            fi
            skip_next=1
        else
            new_args+=("${all_args[$i]}")
        fi
    done

    local action="${new_args[2]}"

    # Default to "API Credential" category for create without --category
    if [[ "$action" == "create" ]]; then
        local has_category=0
        local a
        for a in "${new_args[@]}"; do
            [[ "$a" == "--category" || "$a" == --category=* ]] && has_category=1
        done
        if [[ $has_category -eq 0 ]]; then
            new_args+=("--category" "API Credential")
        fi
    fi

    new_args+=("expires[date]=$expires_date")

    run_with_mode write "${new_args[@]}"
    local exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        # Extract vault and current item identifier for expiry tracking.
        local vault="" title="" item_arg=""
        local j
        for ((j = 0; j < ${#new_args[@]}; j++)); do
            case "${new_args[$j]}" in
                --vault)   vault="${new_args[$((j + 1))]}" ;;
                --vault=*) vault="${new_args[$j]#--vault=}" ;;
                --title)   title="${new_args[$((j + 1))]}" ;;
                --title=*) title="${new_args[$j]#--title=}" ;;
            esac
        done

        # For edit, the item identifier is the positional arg after "op item edit".
        if [[ "$action" == "edit" ]]; then
            local k
            for ((k = 3; k < ${#new_args[@]}; k++)); do
                case "${new_args[$k]}" in
                    --*=*) continue ;;                # --flag=value: single arg
                    --*)   k=$((k + 1)); continue ;; # --flag value: skip next
                    *=*)   continue ;;                # field[type]=value
                    *)     item_arg="${new_args[$k]}"; break ;;
                esac
            done
        fi

        local track_identifier="$title"
        if [[ "$action" == "edit" && -z "$track_identifier" ]]; then
            track_identifier="$item_arg"
        fi

        if [[ -n "$vault" && -n "$track_identifier" ]]; then
            track_expires_item "$vault" "$track_identifier" || true
        fi
    fi

    exit $exit_code
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
    load_expires_list

    if [[ ${#EXPIRES_RECORDS[@]} -eq 0 ]]; then
        echo "No items tracked."
        echo "Use 'opchain expires add op://vault/item-id' to track an item."
        return 0
    fi

    echo "==> Tracked Items"
    local record
    for record in "${EXPIRES_RECORDS[@]}"; do
        local ref label date_value
        ref=$(expires_record_ref "$record")
        label=$(tracking_display_label "$record")
        if date_value=$(run_with_mode_capture read op read "$ref/expires" 2>/dev/null); then
            local days
            if days=$(days_until "$date_value"); then
                local status
                status=$(expires_status "$days")
                case "$status" in
                    EXPIRED)
                        local ago=$(( -days ))
                        printf "  %-8s %s (%s, %d days ago)\n" "$status" "$label" "$date_value" "$ago"
                        ;;
                    *)
                        printf "  %-8s %s (%s, %d days)\n" "$status" "$label" "$date_value" "$days"
                        ;;
                esac
            else
                printf "  %-8s %s (invalid date: %s)\n" "FAIL" "$label" "$date_value"
            fi
        else
            printf "  %-8s %s (could not read)\n" "FAIL" "$label"
        fi
    done
}

# Track an op:// item for expiry monitoring.
# @param $1 - op:// reference
expires_add() {
    local ref="${1:-}"
    if [[ -z "$ref" ]]; then
        echo "Usage: opchain expires add <op://vault/item-id>" >&2
        exit 1
    fi
    if ! is_valid_expires_ref "$ref"; then
        echo "Error: reference must match op://vault/item-id" >&2
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
        echo "Usage: opchain expires remove <op://vault/item-id>" >&2
        exit 1
    fi
    remove_expires_item "$ref"
}

# Print warnings for EXPIRING/EXPIRED items (called after secrets validate).
check_expires_warnings() {
    load_expires_list
    [[ ${#EXPIRES_RECORDS[@]} -gt 0 ]] || return 0

    local warnings=()
    local record
    for record in "${EXPIRES_RECORDS[@]}"; do
        local ref label date_value
        ref=$(expires_record_ref "$record")
        label=$(tracking_display_label "$record")
        if date_value=$(run_with_mode_capture read op read "$ref/expires" 2>/dev/null); then
            local days
            if days=$(days_until "$date_value"); then
                local status
                status=$(expires_status "$days")
                case "$status" in
                    EXPIRED)
                        local ago=$(( -days ))
                        warnings+=("$(printf "  %-8s %s (%s, %d days ago)" "$status" "$label" "$date_value" "$ago")")
                        ;;
                    EXPIRING)
                        warnings+=("$(printf "  %-8s %s (%s, %d days)" "$status" "$label" "$date_value" "$days")")
                        ;;
                esac
            fi
        fi
    done

    if [[ ${#warnings[@]} -gt 0 ]]; then
        echo ""
        echo "==> Expiry Warnings"
        local line
        for line in "${warnings[@]}"; do
            echo "$line"
        done
    fi
}
