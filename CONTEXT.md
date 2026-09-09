# Opchain

macOS-first CLI that stores 1Password service-account tokens in the Apple Keychain, injects them into `op` child processes, validates `op://` secret references, and tracks expiring items by vault and item UUID.

## Language

### Identities and access

**Identity**:
A named configuration scope that owns profiles, a vault allowlist, and a default mode.
_Avoid_: account, tenant, workspace

**Profile**:
A named access role inside an Identity that maps to one Keychain account.
_Avoid_: key, credential, role

**ServiceAccountToken**:
An `ops_...` token stored in the Keychain and injected as `OP_SERVICE_ACCOUNT_TOKEN` into a delegated child.
_Avoid_: secret, password, env token (the env override is a separate concept)

**AccessOverride**:
An explicit `--read` / `--write` / `--profile <name>` selection for one `op` invocation.
_Avoid_: flag override, mode

### Secrets and files

**SecretReference**:
An `op://` URI found in an `.env.op` file that names a vault, item, and field.
_Avoid_: secret, ref, op path

**EnvOpFile**:
A `.env.op` file that contains SecretReferences as assigned values.
_Avoid_: env file, template, .env

**Item**:
The canonical 1Password item returned by `op item get --format json`, with vault identity, item identity, title, field labels, and optional expiry.
_Avoid_: secret payload, JSON blob

### Expiry tracking

**TrackedItem**:
A persisted expiry record for one Item, keyed by vault UUID and item UUID with cached titles and expiry metadata.
_Avoid_: expiry entry, tracked identity alone

**TrackedIdentity**:
The canonical `(vaultUuid, itemUuid)` pair that identifies a TrackedItem.
_Avoid_: selector, vault/item string

**ExpiryState**:
The per-Identity JSON file that stores all TrackedItems.
_Avoid_: expires file, state file (ambiguous)

### Commands and execution

**IdentityCommand**:
An `opchain <identity> <command>` invocation that resolves config, profile, and token before running domain logic.
_Avoid_: subcommand, handler

**ProviderChild**:
A `security` or helper subprocess that resolves or mutates a ServiceAccountToken.
_Avoid_: backend, helper child (too vague)

**DelegatedOpChild**:
An `op` subprocess that receives the resolved ServiceAccountToken and inherits only a sanitized environment.
_Avoid_: op run, child op

## Relationships

- An **Identity** owns one or more **Profiles**; each **Profile** maps to one Keychain account holding a **ServiceAccountToken**.
- An **IdentityCommand** resolves exactly one **Profile** via the fail-closed rule, then resolves its **ServiceAccountToken** via a **ProviderChild**, then spawns a **DelegatedOpChild** when needed.
- An **EnvOpFile** contains zero or more **SecretReferences**; a **SecretReference** resolves to an **Item** when validated.
- An **Item** is the source of truth for a **TrackedItem**; a **TrackedItem** is identified by its **TrackedIdentity** and lives in one **ExpiryState**.

## Example dialogue

> **Dev:** "When `opchain primary secrets validate --project-wide` runs, what does it validate?"
> **Domain expert:** "It discovers every **EnvOpFile** under the Identity's projects directory, collects all **SecretReferences**, then validates each one by asking `op` for its **Item** using the Identity's read **Profile** token. No secret value is printed."
> **Dev:** "And `expires add op://Services/Stripe/api_key`?"
> **Domain expert:** "It fetches the **Item** for that reference, builds a **TrackedItem** keyed by its **TrackedIdentity**, and upserts it into the Identity's **ExpiryState**. Later `expires scan` re-fetches each **Item** to refresh the cached expiry."

## Flagged ambiguities

- "reference" was used for both **SecretReference** (`op://...`) and **TrackedIdentity** string (`vaultUuid/itemUuid`) - resolved: the first is **SecretReference**, the second is the formatted **TrackedIdentity**.
- "item payload" / "op JSON" / "secret inspection payload" all meant the same `op item get` shape - resolved: canonical term is **Item**.
