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

# Collect op:// references from a file into a tab-delimited cache file.
# Output columns: file, env var, op:// ref
# @param $1 - path to .env.op file
# @param $2 - output file path
collect_secret_refs_file() {
    local file="$1"
    local output_file="$2"

    while IFS='=' read -r key value; do
        [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
        key=$(trim "$key")
        value=$(trim "$value")
        [[ "$value" == op://* ]] || continue
        printf '%s\t%s\t%s\n' "$file" "$key" "$value" >> "$output_file"
    done < "$file"
}

# Validate each unique op:// ref once, in bounded parallel batches.
# Output columns: ref, status
# @param $1 - refs cache file
# @param $2 - validation results file
validate_secret_refs() {
    local refs_file="$1"
    local results_file="$2"
    local jobs="${OPCHAIN_SECRETS_JOBS:-8}"
    [[ "$jobs" =~ ^[1-9][0-9]*$ ]] || jobs=8

    : > "$results_file"
    [[ -s "$refs_file" ]] || return 0

    local unique_refs_file="$results_file.unique"
    cut -f3 "$refs_file" | sort -u > "$unique_refs_file"

    local unique_refs=()
    local ref
    while IFS= read -r ref; do
        [[ -n "$ref" ]] && unique_refs+=("$ref")
    done < "$unique_refs_file"

    local total=${#unique_refs[@]}
    [[ $total -gt 0 ]] || return 0

    local start end i
    for ((start = 0; start < total; start += jobs)); do
        end=$((start + jobs - 1))
        [[ $end -ge $total ]] && end=$((total - 1))

        local pids=()
        for ((i = start; i <= end; i++)); do
            (
                if run_with_mode read op read "${unique_refs[$i]}" > /dev/null 2>&1; then
                    echo "OK"
                else
                    echo "FAIL"
                fi
            ) > "${results_file}.status.$i" &
            pids+=("$!")
        done

        if [[ ${#pids[@]} -gt 0 ]]; then
            local pid
            for pid in "${pids[@]}"; do
                wait "$pid"
            done
        fi
    done

    for ((i = 0; i < total; i++)); do
        local status
        status=$(< "${results_file}.status.$i")
        printf '%s\t%s\n' "${unique_refs[$i]}" "$status" >> "$results_file"
        rm -f "${results_file}.status.$i"
    done

    rm -f "$unique_refs_file"
}

# Look up a cached validation result for a single op:// ref.
# @param $1 - op:// ref
# @param $2 - validation results file
# @returns status string on stdout
lookup_secret_ref_status() {
    local ref="$1"
    local results_file="$2"
    awk -F'\t' -v ref="$ref" '$1 == ref { print $2; exit }' "$results_file"
}

# Print cached OK/FAIL results for a single .env.op file.
# @param $1 - path to .env.op file
# @param $2 - validation results file
# @returns 1 if any reference failed
render_secret_check_file() {
    local file="$1"
    local results_file="$2"
    local has_failure=0

    echo "==> $file"
    while IFS='=' read -r key value; do
        [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
        key=$(trim "$key")
        value=$(trim "$value")
        [[ "$value" == op://* ]] || continue

        local status
        status=$(lookup_secret_ref_status "$value" "$results_file")
        if [[ "$status" == "OK" ]]; then
            echo "  OK   $key ($value)"
        else
            echo "  FAIL $key ($value)"
            has_failure=1
        fi
    done < "$file"
    echo ""
    return $has_failure
}

# Check a file or directory using a shared validation cache.
# Sets SECRET_CHECK_FOUND and SECRET_CHECK_FAILURES.
# @param $1 - file or directory path
check_secret_target() {
    local target="$1"
    local tmpdir
    tmpdir=$(mktemp -d)

    SECRET_CHECK_FOUND=0
    SECRET_CHECK_FAILURES=0

    local refs_file="$tmpdir/refs"
    : > "$refs_file"

    local files=()
    if [[ -f "$target" ]]; then
        files+=("$target")
    elif [[ -d "$target" ]]; then
        while IFS= read -r -d '' file; do
            files+=("$file")
        done < <(find "$target" -name '.env.op' -print0 2>/dev/null)
    else
        rm -rf "$tmpdir"
        echo "Error: $target not found" >&2
        exit 1
    fi

    SECRET_CHECK_FOUND=${#files[@]}
    if [[ $SECRET_CHECK_FOUND -eq 0 ]]; then
        rm -rf "$tmpdir"
        return 0
    fi

    local file
    for file in "${files[@]}"; do
        collect_secret_refs_file "$file" "$refs_file"
    done

    local results_file="$tmpdir/results"
    validate_secret_refs "$refs_file" "$results_file"

    for file in "${files[@]}"; do
        render_secret_check_file "$file" "$results_file" || SECRET_CHECK_FAILURES=$((SECRET_CHECK_FAILURES + 1))
    done

    rm -rf "$tmpdir"
    [[ $SECRET_CHECK_FAILURES -eq 0 ]]
}

# Resolve op:// references in .env.op files and report OK/FAIL.
# @param $1 - file or directory path (default: .)
secrets_check() {
    local target="${1:-.}"

    check_secret_target "$target"

    if [[ $SECRET_CHECK_FAILURES -gt 0 ]]; then
        exit 1
    fi
}

# Check each op:// reference in a file against the op CLI.
# @param $1 - path to .env.op file
# @returns 1 if any reference fails to resolve
secrets_check_file() {
    local file="$1"

    check_secret_target "$file"
    [[ $SECRET_CHECK_FAILURES -eq 0 ]]
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

        if json=$(run_with_mode_capture read op item get "$item" --vault "$vault" --format json 2>/dev/null); then
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
    check_secret_target "$PROJECTS_DIR"

    if [[ $SECRET_CHECK_FOUND -eq 0 ]]; then
        echo "No .env.op files found under $PROJECTS_DIR" >&2
        exit 1
    fi

    check_expires_warnings

    if [[ $SECRET_CHECK_FAILURES -gt 0 ]]; then
        echo "$SECRET_CHECK_FAILURES file(s) with failures" >&2
        exit 1
    fi

    echo "All secrets validated."
}
