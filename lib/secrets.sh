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
        validate) secrets_validate "$@" ;;
        *)
            echo "Usage: opchain secrets <list|check|validate> [path]" >&2
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

    load_config
    local token
    token=$(fetch_token "$READ_ACCOUNT")
    export OP_SERVICE_ACCOUNT_TOKEN="$token"

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

# --- Validate ---

# Check all .env.op files under the configured projects directory.
secrets_validate() {
    load_config
    local token
    token=$(fetch_token "$READ_ACCOUNT")
    export OP_SERVICE_ACCOUNT_TOKEN="$token"

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
