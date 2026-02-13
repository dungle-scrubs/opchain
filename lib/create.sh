# shellcheck shell=bash
# LLM-assisted 1Password item creation

# --- Dependencies ---

# Exit if jq is not installed (required for JSON parsing).
require_jq() {
    command -v jq > /dev/null 2>&1 || {
        echo "Error: jq is required for 'opchain create'." >&2
        echo "Install it with: brew install jq" >&2
        exit 1
    }
}

# --- Input sanitization ---

# Strip control characters and cap length to defend against prompt injection.
# The primary defense is output validation (JSON schema + category whitelist) —
# this is defense in depth.
# @param $1 - raw title string
# @returns sanitized title
sanitize_title() {
    local title="$1"
    # Strip control characters (keep printable ASCII + valid UTF-8)
    title=$(echo "$title" | tr -d '\000-\010\013\014\016-\037\177')
    # Cap at 200 characters
    title="${title:0:200}"
    echo "$title"
}

# --- Categories ---

# Fetch 1Password categories dynamically, fall back to hardcoded list.
# Requires: OP_SERVICE_ACCOUNT_TOKEN set, jq available.
# Sets: OP_CATEGORIES array
fetch_categories() {
    local categories=()
    if command -v jq > /dev/null 2>&1; then
        while IFS= read -r name; do
            [[ -n "$name" ]] && categories+=("$name")
        done < <(op item template list --format=json 2>/dev/null | jq -r '.[].name' 2>/dev/null)
    fi
    if [[ ${#categories[@]} -eq 0 ]]; then
        categories=("${FALLBACK_CATEGORIES[@]}")
    fi
    OP_CATEGORIES=("${categories[@]}")
}

# --- UI helpers ---

# Present a numbered list and return the user's selection.
# @param $1 - prompt text
# @param $@ - list items
# @returns selected item on stdout
select_from_list() {
    local prompt="$1"
    shift
    local items=("$@")
    local count=${#items[@]}

    echo "$prompt" >&2
    local i
    for i in $(seq 0 $((count - 1))); do
        printf "  %d) %s\n" "$((i + 1))" "${items[$i]}" >&2
    done
    local choice
    while true; do
        read -rp "Selection [1-$count]: " choice
        if [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le "$count" ]]; then
            echo "${items[$((choice - 1))]}"
            return 0
        fi
        echo "  Invalid selection." >&2
    done
}

# Prompt for a field value (concealed fields use silent input).
# @param $1 - field label
# @param $2 - field type (concealed|text|url|email|date)
# @param $3 - optional hint
# @returns field value on stdout
prompt_field_value() {
    local label="$1"
    local field_type="$2"
    local hint="${3:-}"
    local display="$label"
    [[ -n "$hint" ]] && display="$label ($hint)"

    if [[ "$field_type" == "concealed" ]]; then
        local val
        read -rsp "  $display: " val
        echo "" >&2
        echo "$val"
    else
        local val
        read -rp "  $display: " val
        echo "$val"
    fi
}

# --- LLM ---

# Request category and field suggestions from OpenRouter.
# Vault names are never sent — the LLM only sees the item title and
# the list of valid 1Password categories.
# @param $1 - item title (sanitized)
# @param $2 - OpenRouter API key
# @returns raw API response on stdout
llm_suggest() {
    local title="$1"
    local api_key="$2"

    local categories_csv=""
    local cat
    for cat in "${OP_CATEGORIES[@]}"; do
        if [[ -n "$categories_csv" ]]; then
            categories_csv="$categories_csv, $cat"
        else
            categories_csv="$cat"
        fi
    done

    local system_prompt="You are a 1Password item creation assistant. Given an item title, suggest the best category and fields. Respond with ONLY valid JSON, no markdown fences.

Available categories: $categories_csv

Respond with this exact JSON structure:
{
  \"category\": \"category name\",
  \"note\": \"optional brief note about this type of item\",
  \"fields\": [
    {\"name\": \"field name\", \"type\": \"concealed|text|url|email|date\", \"hint\": \"brief description\"}
  ]
}

Rules:
- category must be one of the available categories
- field types: concealed (secrets/passwords/keys), text (plain text), url (URLs), email (emails), date (dates)
- suggest 1-5 relevant fields
- keep hints under 30 characters"

    local payload
    payload=$(jq -n \
        --arg model "$LLM_MODEL" \
        --arg system "$system_prompt" \
        --arg user "Create item: $title" \
        '{
            model: $model,
            temperature: 0.1,
            max_tokens: 512,
            messages: [
                {role: "system", content: $system},
                {role: "user", content: $user}
            ]
        }')

    curl -s --max-time 15 \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        "https://openrouter.ai/api/v1/chat/completions" 2>/dev/null || true
}

# Parse and validate the LLM response JSON.
# Validates: JSON structure, category against OP_CATEGORIES whitelist.
# @param $1 - raw OpenRouter API response
# @returns parsed suggestion JSON on stdout, or returns 1
parse_llm_response() {
    local raw="$1"
    [[ -z "$raw" ]] && return 1

    local content
    content=$(echo "$raw" | jq -r '.choices[0].message.content // empty' 2>/dev/null) || return 1
    [[ -z "$content" ]] && return 1

    # Strip markdown fences if present
    content=$(echo "$content" | grep -v '^\x60\x60\x60' | sed '/^$/d')

    # Validate JSON structure
    echo "$content" | jq empty 2>/dev/null || return 1

    # Validate category against whitelist
    local suggested_cat
    suggested_cat=$(echo "$content" | jq -r '.category // empty' 2>/dev/null) || return 1
    local valid=0
    local cat
    for cat in "${OP_CATEGORIES[@]}"; do
        if [[ "$cat" == "$suggested_cat" ]]; then
            valid=1
            break
        fi
    done
    if [[ $valid -eq 0 ]]; then
        return 1
    fi

    echo "$content"
}

# --- Main create flow ---

# Interactive item creation with optional LLM suggestions.
# @param $@ - args: <title> [--vault name] [--category name] [--expires YYYY-MM-DD]
handle_create() {
    local title=""
    local opt_vault=""
    local opt_category=""
    local opt_expires=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --vault)
                [[ $# -lt 2 ]] && { echo "Error: --vault requires a value" >&2; exit 1; }
                opt_vault="$2"; shift 2 ;;
            --category)
                [[ $# -lt 2 ]] && { echo "Error: --category requires a value" >&2; exit 1; }
                opt_category="$2"; shift 2 ;;
            --expires)
                [[ $# -lt 2 ]] && { echo "Error: --expires requires a YYYY-MM-DD date" >&2; exit 1; }
                opt_expires="$2"; shift 2 ;;
            --*)
                echo "Error: unknown option $1" >&2
                echo "Usage: opchain create <title> [--vault name] [--category name] [--expires YYYY-MM-DD]" >&2
                exit 1 ;;
            *)
                if [[ -z "$title" ]]; then
                    title="$1"; shift
                else
                    echo "Error: unexpected argument '$1'" >&2; exit 1
                fi ;;
        esac
    done

    if [[ -z "$title" ]]; then
        echo "Usage: opchain create <title> [--vault name] [--category name] [--expires YYYY-MM-DD]" >&2
        exit 1
    fi

    title=$(sanitize_title "$title")

    if [[ -n "$opt_expires" ]] && ! validate_date "$opt_expires"; then
        echo "Error: invalid date '$opt_expires' (expected YYYY-MM-DD)" >&2
        exit 1
    fi

    require_jq
    load_config

    # Fetch vault list (read token)
    local token
    token=$(fetch_token "$READ_ACCOUNT")
    export OP_SERVICE_ACCOUNT_TOKEN="$token"

    # Fetch categories dynamically (falls back to hardcoded)
    fetch_categories

    local vaults_json
    vaults_json=$(op vault list --format=json 2>&1) || {
        echo "Error: failed to list vaults" >&2
        echo "$vaults_json" >&2
        exit 1
    }

    local vault_names=()
    while IFS= read -r name; do
        vault_names+=("$name")
    done < <(echo "$vaults_json" | jq -r '.[].name' 2>/dev/null)

    if [[ ${#vault_names[@]} -eq 0 ]]; then
        echo "Error: no vaults found" >&2
        exit 1
    fi

    # Try LLM suggestion for category + fields (never sends vault names)
    local llm_json=""
    local llm_category="" llm_note=""
    if [[ -z "$opt_category" ]]; then
        local api_key
        api_key=$(fetch_llm_key)
        if [[ -n "$api_key" ]]; then
            echo "Analyzing \"$title\"..."
            local raw_response
            raw_response=$(llm_suggest "$title" "$api_key")
            if llm_json=$(parse_llm_response "$raw_response"); then
                llm_category=$(echo "$llm_json" | jq -r '.category // empty')
                llm_note=$(echo "$llm_json" | jq -r '.note // empty')
            else
                echo "LLM unavailable, using manual selection." >&2
                llm_json=""
            fi
        fi
    fi

    # Resolve vault (always manual — LLM never sees vault names)
    local vault="$opt_vault"
    if [[ -z "$vault" ]]; then
        vault=$(select_from_list "Select vault:" "${vault_names[@]}")
    fi

    # Resolve category
    local category="$opt_category"
    if [[ -z "$category" ]]; then
        if [[ -n "$llm_category" ]]; then
            read -rp "Category [$llm_category]: " category
            category="${category:-$llm_category}"
        else
            category=$(select_from_list "Select category:" "${OP_CATEGORIES[@]}")
        fi
    fi

    if [[ -n "$llm_note" ]]; then
        echo "Note: $llm_note"
    fi

    # Collect fields
    local field_names=()
    local field_types=()
    local field_hints=()
    local field_values=()

    if [[ -n "$llm_json" ]]; then
        local field_count
        field_count=$(echo "$llm_json" | jq '.fields | length')
        if [[ "$field_count" -gt 0 ]]; then
            echo ""
            echo "Suggested fields:"
            local idx
            for idx in $(seq 0 $((field_count - 1))); do
                local fname ftype fhint
                fname=$(echo "$llm_json" | jq -r ".fields[$idx].name")
                ftype=$(echo "$llm_json" | jq -r ".fields[$idx].type")
                fhint=$(echo "$llm_json" | jq -r ".fields[$idx].hint // empty")
                echo "  - $fname ($ftype)${fhint:+ -- $fhint}"
                field_names+=("$fname")
                field_types+=("$ftype")
                field_hints+=("$fhint")
            done

            echo ""
            read -rp "Use these fields? [Y/n/edit] " confirm
            confirm=$(echo "${confirm:-Y}" | tr '[:upper:]' '[:lower:]')

            case "$confirm" in
                n|no)
                    field_names=()
                    field_types=()
                    field_hints=()
                    echo "Enter fields manually (empty name to finish):"
                    while true; do
                        local fname
                        read -rp "  Field name: " fname
                        [[ -z "$fname" ]] && break
                        local ftype
                        read -rp "  Field type (text/concealed/url/email/date) [text]: " ftype
                        ftype="${ftype:-text}"
                        field_names+=("$fname")
                        field_types+=("$ftype")
                        field_hints+=("")
                    done
                    ;;
                e|edit)
                    echo "Edit fields (Enter to keep, 'x' to remove, or type new name):"
                    local new_names=() new_types=() new_hints=()
                    local i
                    for i in $(seq 0 $((${#field_names[@]} - 1))); do
                        local fname="${field_names[$i]}"
                        local ftype="${field_types[$i]}"
                        local fhint="${field_hints[$i]}"
                        local new_name
                        read -rp "  $fname ($ftype) [keep/x/new name]: " new_name
                        if [[ "$new_name" == "x" ]]; then
                            continue
                        fi
                        new_name="${new_name:-$fname}"
                        new_names+=("$new_name")
                        new_types+=("$ftype")
                        new_hints+=("$fhint")
                    done
                    echo "Add more fields (empty name to finish):"
                    while true; do
                        local fname
                        read -rp "  Field name: " fname
                        [[ -z "$fname" ]] && break
                        local ftype
                        read -rp "  Field type (text/concealed/url/email/date) [text]: " ftype
                        ftype="${ftype:-text}"
                        new_names+=("$fname")
                        new_types+=("$ftype")
                        new_hints+=("")
                    done
                    # Safe for bash 3.2: ${arr[@]+...} avoids unbound error on empty arrays
                    field_names=(${new_names[@]+"${new_names[@]}"})
                    field_types=(${new_types[@]+"${new_types[@]}"})
                    field_hints=(${new_hints[@]+"${new_hints[@]}"})
                    ;;
            esac
        fi
    else
        echo "Enter fields (empty name to finish):"
        while true; do
            local fname
            read -rp "  Field name: " fname
            [[ -z "$fname" ]] && break
            local ftype
            read -rp "  Field type (text/concealed/url/email/date) [text]: " ftype
            ftype="${ftype:-text}"
            field_names+=("$fname")
            field_types+=("$ftype")
            field_hints+=("")
        done
    fi

    # Prompt for field values
    if [[ ${#field_names[@]} -gt 0 ]]; then
        echo ""
        echo "Enter field values (leave blank to skip):"
        local i
        for i in $(seq 0 $((${#field_names[@]} - 1))); do
            local val
            val=$(prompt_field_value "${field_names[$i]}" "${field_types[$i]}" "${field_hints[$i]}")
            field_values+=("$val")
        done
    fi

    # Preview
    echo ""
    echo "==> Creating item"
    echo "  Title:    $title"
    echo "  Vault:    $vault"
    echo "  Category: $category"
    local populated=0
    local i
    for i in $(seq 0 $((${#field_names[@]} - 1))); do
        [[ -n "${field_values[$i]:-}" ]] && populated=$((populated + 1))
    done
    echo "  Fields:   $populated"
    for i in $(seq 0 $((${#field_names[@]} - 1))); do
        local val="${field_values[$i]:-}"
        [[ -z "$val" ]] && continue
        local display_val="$val"
        if [[ "${field_types[$i]}" == "concealed" ]]; then
            display_val="****"
        fi
        echo "    - ${field_names[$i]} (${field_types[$i]}): $display_val"
    done
    if [[ -n "$opt_expires" ]]; then
        echo "  Expires:  $opt_expires"
    fi

    echo ""
    read -rp "Confirm? [Y/n] " confirm
    confirm=$(echo "${confirm:-Y}" | tr '[:upper:]' '[:lower:]')
    if [[ "$confirm" == "n" || "$confirm" == "no" ]]; then
        echo "Cancelled."
        exit 0
    fi

    # Execute with write token
    local write_token
    write_token=$(fetch_token "$WRITE_ACCOUNT")
    export OP_SERVICE_ACCOUNT_TOKEN="$write_token"

    local op_args=("op" "item" "create" "--vault" "$vault" "--category" "$category" "--title" "$title")

    local i
    for i in $(seq 0 $((${#field_names[@]} - 1))); do
        local val="${field_values[$i]:-}"
        [[ -z "$val" ]] && continue
        local ftype="${field_types[$i]}"
        case "$ftype" in
            concealed|text|url|email|date) ;;
            *) ftype="text" ;;
        esac
        op_args+=("${field_names[$i]}[$ftype]=$val")
    done

    if [[ -n "$opt_expires" ]]; then
        op_args+=("expires[date]=$opt_expires")
    fi

    "${op_args[@]}"
    local exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        echo "Item created successfully."
        if [[ -n "$opt_expires" ]]; then
            add_expires_item "op://$vault/$title"
        fi
    else
        echo "Error: op item create failed (exit code $exit_code)" >&2
        exit $exit_code
    fi
}
