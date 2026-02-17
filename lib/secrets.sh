# shellcheck shell=bash
# Secrets management for .env.op files

# --- Dispatch ---

# Route secrets subcommands.
# @param $1 - subcommand: list, check, or validate
# @param $@ - remaining args (path)
handle_secrets() {
    local subcmd="${1:-}"
    shift || true

    case "$subcmd" in
        list)     secrets_list "$@" ;;
        check)    secrets_check "$@" ;;
        inspect)  secrets_inspect "$@" ;;
        validate) secrets_validate "$@" ;;
        *)
            echo "Usage: opchain secrets <list|check|inspect|validate> [path]" >&2
            exit 1
            ;;
    esac
}

# --- List ---

# List op:// references in .env.op files at a path.
# @param $1 - file or directory path (default: .)
secrets_list() {
    local target="${1:-.}"

    if [[ -f "$target" ]]; then
        secrets_list_file "$target"
    elif [[ -d "$target" ]]; then
        local found=0
        while IFS= read -r -d '' file; do
            found=1
            secrets_list_file "$file"
        done < <(find "$target" -name '.env.op' -print0 2>/dev/null)
        if [[ $found -eq 0 ]]; then
            echo "No .env.op files found in $target" >&2
        fi
    else
        echo "Error: $target not found" >&2
        exit 1
    fi
}

# Print op:// references from a single .env.op file.
# @param $1 - path to .env.op file
secrets_list_file() {
    local file="$1"
    echo "==> $file"
    while IFS='=' read -r key value; do
        [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
        key=$(trim "$key")
        value=$(trim "$value")
        if [[ "$value" == op://* ]]; then
            echo "  $key=$value"
        fi
    done < "$file"
    echo ""
}

# --- Check ---

# Resolve op:// references in .env.op files and report OK/FAIL.
# @param $1 - file or directory path (default: .)
secrets_check() {
    local target="${1:-.}"
    local failures=0

    setup_read_token

    if [[ -f "$target" ]]; then
        secrets_check_file "$target" || failures=$((failures + 1))
    elif [[ -d "$target" ]]; then
        while IFS= read -r -d '' file; do
            secrets_check_file "$file" || failures=$((failures + 1))
        done < <(find "$target" -name '.env.op' -print0 2>/dev/null)
    else
        echo "Error: $target not found" >&2
        exit 1
    fi

    if [[ $failures -gt 0 ]]; then
        exit 1
    fi
}

# Check each op:// reference in a file against the op CLI.
# @param $1 - path to .env.op file
# @returns 1 if any reference fails to resolve
secrets_check_file() {
    local file="$1"
    local has_failure=0
    echo "==> $file"
    while IFS='=' read -r key value; do
        [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
        key=$(trim "$key")
        value=$(trim "$value")
        [[ "$value" != op://* ]] && continue

        if op read "$value" > /dev/null 2>&1; then
            echo "  OK   $key ($value)"
        else
            echo "  FAIL $key ($value)"
            has_failure=1
        fi
    done < "$file"
    echo ""
    return $has_failure
}

# --- Inspect ---

# List available fields for items referenced in .env.op files.
# Shows all fields on each referenced 1Password item so consumers can
# verify their op:// field paths before deployment.
# Requires: jq
# @param $1 - file or directory path (default: .)
secrets_inspect() {
    local target="${1:-.}"

    require_jq
    setup_read_token

    if [[ -f "$target" ]]; then
        secrets_inspect_file "$target"
    elif [[ -d "$target" ]]; then
        local found=0
        while IFS= read -r -d '' file; do
            found=1
            secrets_inspect_file "$file"
        done < <(find "$target" -name '.env.op' -print0 2>/dev/null)
        if [[ $found -eq 0 ]]; then
            echo "No .env.op files found in $target" >&2
        fi
    else
        echo "Error: $target not found" >&2
        exit 1
    fi
}

# Inspect a single .env.op file: fetch item metadata and list fields.
# For each unique vault/item pair, calls `op item get` once and displays
# all available fields alongside the env var references, marking whether
# each referenced field exists on the item.
# @param $1 - path to .env.op file
# @returns 1 if any referenced field is missing
secrets_inspect_file() {
    local file="$1"
    local tmpdir
    tmpdir=$(mktemp -d)

    echo "==> $file"

    # Pass 1: collect references (vault, item, env_var, field_path)
    while IFS='=' read -r key value; do
        [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
        key=$(trim "$key")
        value=$(trim "$value")
        [[ "$value" != op://* ]] && continue

        local ref="${value#op://}"
        local vault="${ref%%/*}"
        ref="${ref#*/}"
        local item="${ref%%/*}"
        local field_path="${ref#*/}"

        printf '%s\t%s\t%s\t%s\n' "$vault" "$item" "$key" "$field_path"
    done < "$file" > "$tmpdir/refs"

    if [[ ! -s "$tmpdir/refs" ]]; then
        echo "  (no op:// references)"
        echo ""
        rm -rf "$tmpdir"
        return
    fi

    # Pass 2: fetch and display each unique item
    local has_missing=0
    cut -f1,2 "$tmpdir/refs" | sort -u > "$tmpdir/items"

    while IFS=$'\t' read -r vault item; do
        echo ""
        local json=""
        local item_ok=0

        if json=$(op item get "$item" --vault "$vault" --format json 2>/dev/null); then
            item_ok=1
            local category
            category=$(echo "$json" | jq -r '.category // "Unknown"')
            echo "  op://${vault}/${item}  [${category}]"

            echo "    Fields:"
            echo "$json" | jq -r '
                .fields[]? |
                "      " +
                (if .section.label then .section.label + "/" else "" end) +
                .label +
                "  (" + .type + ")"
            '
        else
            echo "  op://${vault}/${item}  [ITEM NOT FOUND]"
            has_missing=1
        fi

        # Show references pointing to this item
        echo "    References:"
        awk -F'\t' -v v="$vault" -v i="$item" \
            '$1==v && $2==i {print $3 "\t" $4}' "$tmpdir/refs" > "$tmpdir/match"

        while IFS=$'\t' read -r env_var field_path; do
            if [[ $item_ok -eq 1 ]]; then
                local match_count
                if [[ "$field_path" == */* ]]; then
                    # Section/field reference
                    local section="${field_path%%/*}"
                    local field="${field_path#*/}"
                    match_count=$(echo "$json" | jq -r \
                        --arg s "$section" --arg f "$field" \
                        '[.fields[]? | select(.section.label == $s and .label == $f)] | length')
                else
                    match_count=$(echo "$json" | jq -r \
                        --arg f "$field_path" \
                        '[.fields[]? | select(.label == $f)] | length')
                fi

                if [[ "$match_count" -gt 0 ]]; then
                    echo "      ✓ ${env_var} → ${field_path}"
                else
                    echo "      ✗ ${env_var} → ${field_path}  (field not found)"
                    has_missing=1
                fi
            else
                echo "      ? ${env_var} → ${field_path}  (item unavailable)"
            fi
        done < "$tmpdir/match"

    done < "$tmpdir/items"

    echo ""
    rm -rf "$tmpdir"
    return $has_missing
}

# --- Validate ---

# Check all .env.op files under the configured projects directory.
secrets_validate() {
    setup_read_token

    local failures=0
    local found=0

    while IFS= read -r -d '' file; do
        found=1
        secrets_check_file "$file" || failures=$((failures + 1))
    done < <(find "$PROJECTS_DIR" -name '.env.op' -print0 2>/dev/null)

    if [[ $found -eq 0 ]]; then
        echo "No .env.op files found under $PROJECTS_DIR" >&2
        exit 1
    fi

    if [[ $failures -gt 0 ]]; then
        echo "$failures file(s) with failures" >&2
        exit 1
    fi

    echo "All secrets validated."
    check_expires_warnings
}
