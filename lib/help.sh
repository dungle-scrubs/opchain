# shellcheck shell=bash
# Help and version display

# Print full usage documentation.
show_help() {
    cat << EOF
opchain $VERSION — Dual-token 1Password wrapper with secrets management

USAGE:
    opchain [--read|--write] <command> [args...]
    opchain create <title> [--vault name] [--category name] [--expires YYYY-MM-DD]
    opchain secrets <list|check|validate> [path]
    opchain expires [list|add|remove] [ref]
    opchain setup
    opchain --help | --version

COMMANDS:
    create <title>           Create a 1Password item with LLM-assisted suggestions
    secrets list [path]      List op:// references in .env.op files
    secrets check [path]     Resolve each op:// reference, report OK/FAIL
    secrets validate         Check all .env.op files under projects dir
    expires [list]           Show tracked items with expiry status
    expires add <ref>        Track an op:// item for expiry monitoring
    expires remove <ref>     Stop tracking an item
    setup                    Store read/write tokens in Keychain

FLAGS:
    --read       Force read-only token
    --write      Force read-write token
    --expires    Set expiry date (YYYY-MM-DD) on op item create/edit
    --help, -h   Show this help
    --version    Show version

TOKEN SELECTION:
    By default, opchain selects the token automatically:
    - Read token for: op item get, op vault list, non-op commands
    - Write token for: op item create/edit/delete/share,
      op vault/document/group create/edit/delete

EXAMPLES:
    opchain op vault list
    opchain op item create --vault Dev --title "api-key"
    opchain op item create --vault Dev --title "api-key" --expires 2026-06-15
    opchain create "Stripe API Key"
    opchain create "SSH Key" --vault Dev --category "SSH Key"
    opchain create "Token" --expires 2026-06-15
    opchain --read op vault list
    opchain --write op vault list
    opchain secrets validate
    opchain expires
    opchain expires add op://Dev/api-key

CONFIG:
    File: ~/.config/opchain/config

    projects_dir=~/dev            Directory for secrets validate
    read_account=opchain-read     Keychain account for read token
    write_account=opchain-write   Keychain account for write token
    expires_threshold=14          Days before expiry to warn
    llm_account=opchain-llm       Keychain account for OpenRouter API key
    llm_model=anthropic/claude-3.5-haiku  LLM model for create suggestions

    Env vars (override config): OPCHAIN_PROJECTS_DIR,
    OPCHAIN_READ_ACCOUNT, OPCHAIN_WRITE_ACCOUNT,
    OPCHAIN_EXPIRES_THRESHOLD, OPCHAIN_LLM_ACCOUNT,
    OPCHAIN_LLM_MODEL

    DEPENDENCIES:
    - jq (required for 'opchain create'): brew install jq

EOF
    exit 0
}

# Print version string.
show_version() {
    echo "opchain $VERSION"
    exit 0
}
