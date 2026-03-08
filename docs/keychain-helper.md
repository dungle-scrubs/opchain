# Keychain helper for trusted-binary scoping

`opchain` is a shell script, so macOS Keychain access control cannot be
scoped to the script itself. If you grant access to `/usr/bin/security`, you
are really trusting every process that can invoke that binary.

The fix is a dedicated helper binary that talks to the Security framework
itself. This repo includes a scaffold at
`helper/opchain-keychain-helper/`.

## What the helper does

The helper has two narrow jobs:

- `exec` a child command with `OP_SERVICE_ACCOUNT_TOKEN` set
- `token` prints the token for the small compatibility surface that still
  needs a value inside the shell process

Usage:

```bash
opchain-keychain-helper exec --account opchain-read -- op vault list
opchain-keychain-helper exec --account opchain-write -- op item create ...
opchain-keychain-helper token --account opchain-read
```

It still only reads `OP_SERVICE_ACCOUNT_TOKEN` items for named accounts. It
is not a general-purpose secret browser.

## Build the helper

```bash
swift build -c release --package-path helper/opchain-keychain-helper
```

The compiled binary will be at:

```bash
helper/opchain-keychain-helper/.build/release/opchain-keychain-helper
```

## Create a local code-signing certificate

You do not need an Apple developer certificate for local Keychain ACL
scoping.

In Keychain Access:

1. Open `Keychain Access`
2. Choose `Keychain Access → Certificate Assistant → Create a Certificate...`
3. Name it `opchain-local-signing`
4. Set `Identity Type` to `Self Signed Root`
5. Set `Certificate Type` to `Code Signing`
6. Save it in your `login` keychain

This is sufficient for local development on your own Mac.

## Sign the helper

```bash
codesign -s "opchain-local-signing" -f --timestamp=none \
  helper/opchain-keychain-helper/.build/release/opchain-keychain-helper

codesign -dv --verbose=4 \
  helper/opchain-keychain-helper/.build/release/opchain-keychain-helper
```

If `codesign` cannot find the identity, the certificate setup is wrong.
Fix that first.

## Grant Keychain access to the helper

For each `opchain` token item in Keychain:

1. Open the item in Keychain Access
2. Open `Get Info`
3. Open the `Access Control` tab
4. Choose `Confirm before allowing access`
5. Add the signed helper binary path

Do not use `Allow all applications`.

## Operational caveats

- Re-sign the helper with the same local certificate if you rebuild it.
- Do not switch to ad-hoc signing if you want stable Keychain trust.
- This only solves local trust on your machine. It is not a distribution
  story.
- If `OPCHAIN_KEYCHAIN_HELPER` / `keychain_helper` is not configured,
  `opchain` still falls back to `/usr/bin/security`.

## Wire it into opchain

Set either:

```bash
export OPCHAIN_KEYCHAIN_HELPER="$HOME/bin/opchain-keychain-helper"
```

or in `~/.config/opchain/config`:

```bash
keychain_helper=~/bin/opchain-keychain-helper
```

When configured, `opchain` uses the helper for service-account token access
instead of calling `/usr/bin/security` directly.

Then run:

```bash
opchain doctor
opchain doctor --json
```

That verifies the helper path, reports symlink/realpath and `codesign`
identity details, checks read/write helper access without printing token
values, and reminds you that Keychain trusted-app bindings still need a
manual check in Keychain Access. `--json` makes the output scriptable.

## Current integration model

The clean path is already wired for top-level command execution and most
internal `op` calls:

1. `opchain` decides which account is needed
2. `opchain` launches `opchain-keychain-helper exec --account ... -- ...`
3. the helper reads the token and replaces itself with the target command

The `token --account ...` subcommand still exists as a compatibility path,
but the code now prefers helper `exec`/capture wrappers for internal reads
and writes wherever possible.
