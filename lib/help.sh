# shellcheck shell=bash
# Help and version display

# Print full usage documentation.
show_help() {
    cat << EOF
opchain $VERSION — Dual-token 1Password wrapper with secrets management

USAGE:
    opchain [--read|--write] op <command> [args...]
    opchain exec [--read|--write] [--confirm-write] -- <command> [args...]
    opchain create <title> [--vault name] [--category name] [--expires YYYY-MM-DD] [--dry-run]
    opchain secrets <list|check|inspect|validate> [path]
    opchain expires [list|add|remove] [ref]
    opchain doctor [--json]
    opchain setup
    opchain --help | --version

COMMANDS:
    create <title>           Create a 1Password item with LLM-assisted suggestions
    secrets list [path]      List op:// references in .env.op files
    secrets check [path]     Resolve each op:// reference, report OK/FAIL
    secrets inspect [path]   Show available fields for each referenced item
    secrets validate         Check all .env.op files under projects dir
    expires [list]           Show tracked items with expiry status
    expires add <ref>        Track an op://vault/item-id for expiry monitoring
    expires remove <ref>     Stop tracking an op://vault/item-id entry
    exec [--read|--write]    Explicitly inject a token into a non-op command
                           --confirm-write is required with --write
    doctor [--json]          Verify helper path, realpath, signature, and token access
    setup                    Store read/write tokens in Keychain
    setup <account>          Store a single token for a named account

FLAGS:
    --read       Force read-only token
    --write      Force read-write token
    --expires    Set expiry date (YYYY-MM-DD) on op item create/edit
    --dry-run    Preview the create command without executing (create only)
    --help, -h   Show this help
    --version    Show version

TOKEN SELECTION:
    By default, opchain only wraps op CLI commands:
    - Read token for: op item get, op vault list
    - Write token for: op item create/edit/delete/share,
      op vault/document/group create/edit/delete
    Use 'opchain exec --read|--write -- ...' for explicit token injection.
    Write-token exec also requires '--confirm-write'.

EXAMPLES:
    opchain op vault list
    opchain op item create --vault Dev --title "api-key"
    opchain op item create --vault Dev --title "api-key" --expires 2026-06-15
    opchain create "Stripe API Key"
    opchain create "SSH Key" --vault Dev --category "SSH Key"
    opchain create "Token" --expires 2026-06-15
    opchain --read op vault list
    opchain --write op vault list
    opchain exec --read -- env
    opchain exec --write --confirm-write -- ./script-that-needs-a-token
    opchain doctor
    opchain doctor --json
    opchain secrets validate
    opchain expires
    opchain setup tool-proxy-read
    opchain expires add op://Dev/item-id

CONFIG:
    File: ~/.config/opchain/config

    projects_dir=~/dev            Directory for secrets validate
    read_account=opchain-read     Keychain account for read token
    write_account=opchain-write   Keychain account for write token
    expires_threshold=14          Days before expiry to warn
    llm_account=opchain-llm       Keychain account for OpenRouter API key
    llm_model=anthropic/claude-3.5-haiku  LLM model for create suggestions
    keychain_helper=~/bin/opchain-keychain-helper  Optional helper for trusted-binary Keychain access

    Env vars (override config): OPCHAIN_PROJECTS_DIR,
    OPCHAIN_READ_ACCOUNT, OPCHAIN_WRITE_ACCOUNT,
    OPCHAIN_EXPIRES_THRESHOLD, OPCHAIN_LLM_ACCOUNT,
    OPCHAIN_LLM_MODEL, OPCHAIN_KEYCHAIN_HELPER

DEPENDENCIES:
    jq (required for 'opchain create'): brew install jq

EOF
    exit 0
}

# Print version string.
show_version() {
    echo "opchain $VERSION"
    exit 0
}
