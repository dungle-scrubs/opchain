# opchainV2 Roadmap

This document is the implementation plan for `~/dev/opchainV2`.

The goal is to replace the current Bash-heavy `opchain` with a compiled,
macOS-first Bun CLI that keeps the useful parts, drops the weak parts,
and makes the security model explicit.

## Current status

This repository now has an initial Phase 0 bootstrap, Phase 1 through Phase 7
basics, with only a small amount of cleanup remaining.

What exists today:

- Bun + TypeScript baseline
- Biome lint and format scripts
- Husky pre-commit hook definition for lint, format, and typecheck
- config loader for `config.toml`
- minimal `src/index.ts` help path
- `identity list` and `doctor` basics
- helper-backed `token set` via `--stdin` and hidden TTY prompt
- helper-backed `token remove` via `--yes` and interactive confirmation
- first `opchain <identity> op ...` slices for single-profile `vault list`, auto-mode read-profile resolution, and explicit `--write` override
- first `opchain <identity> secrets list [path]`, `secrets check [path]`, `secrets inspect`, and `secrets validate [path|--project-wide]` slices with `.env.op` parsing
- early expiry-tracking slices: canonical persisted IDs, add/remove/list, scan, and threshold evaluation
- first migration slices for legacy config detection, token mapping, expiry import, and guarded apply mode
- local packaging flow with compiled binary build, install-local, and doctor binary/helper reporting
- text and JSON debug telemetry
- redacted `config.load` and `identity.resolve` events
- helper token-provider contract
- `/usr/bin/security` fallback token-provider contract
- deterministic provider resolution order with explicit env override support
- precise redacted provider-failure reporting
- provider attempt, success, and failure telemetry during token resolution
- unit and integration tests for config loading, provider resolution, provider redaction, provider telemetry, current CLI entrypoints, completed `.env.op` slices, core expiry-tracking flows, early migration slices, and local packaging checks

The roadmap is still the source of truth for everything beyond those completed
slices.

Read in this order:

1. `README.md`
2. `SECURITY.md`
3. `ROADMAP.md`
4. `EXECUTION_CHECKLIST.md`

## Problem statement

Current `opchain` solves real problems, but it is carrying the wrong shape.
It is mostly Bash, the command surface is broader than the trusted use cases,
and the safety story is mixed because shell scripts plus
`/usr/bin/security` are not a clean trust boundary.

The real use cases are narrower:

- keep service account tokens out of ambient shell state
- keep secrets out of LLM and agent context whenever possible
- support multiple named identities on macOS machines
- validate `.env.op` files and push usage toward `.env.op`, not `.env`
- track expiring records and alert before things break
- allow tighter write access later, without rebuilding the whole tool

## Audit of opchain v1

## What v1 got right

| Area | Value kept in v2 |
|---|---|
| Separate read/write tokens | Good least-privilege default for `kevin` and any identity that needs both modes |
| Keychain-backed token lookup | Keeps tokens out of ambient env vars and casual command output |
| `.env.op` workflows | Matches the real goal: references in source, secrets only at runtime |
| Expiry tracking | Real operational value; 1Password does not give this cleanly |
| `op` passthrough with token injection | Still useful as the lowest-level escape hatch |

## What v1 should not carry forward

| Area | Reason to drop or shrink |
|---|---|
| Large Bash codebase | Hard to evolve, fragile, and unpleasant to trust long term |
| Global sourced module model | Load order matters; state is implicit and easy to break |
| LLM-assisted item creation | Out of current trust scope and not a core requirement |
| Broad wrapper ambition | The useful product is smaller than the current surface area |
| Shell-only Keychain access story | `/usr/bin/security` is convenience, not a strong trust boundary |

## Constraints learned from v1

- macOS is the real target for now
- 1Password service accounts are the real trust boundary for remote access
- `.env.op` is the right convention; `.env` should not be the default
- expiry tracking needs local state, but not a database
- the tool should stay small; a monorepo or server component would be bad

## Product decisions

## Keep

- Bun + TypeScript for the main CLI
- macOS-first support
- Keychain support
- identity-aware token resolution
- profile-aware token resolution for future scoped tokens
- `.env.op` list/check/inspect/validate commands
- expiry tracking
- `doctor` diagnostics
- a thin `op` execution path
- v1 migration tooling
- documentation that is explicit enough for both humans and agents

## Drop

- LLM item creation
- prompt-driven record scaffolding
- generic secret management ambitions outside 1Password
- Linux and Windows support in the first release
- database storage unless the file-based design proves insufficient
- broad feature creep around vault provisioning and reorganization
- persistent debug log storage by default

## Non-goals

- strong same-user isolation between identities on one macOS login
- replacing 1Password as the source of truth
- becoming a policy engine or secret broker
- silently granting write access to agents
- pretending local config is a stronger boundary than service-account scope

## Critical implementation invariants

These rules exist to prevent the implementation from drifting into a fake
security story.

### Ambient env tokens are ignored by default

The CLI must not silently accept ambient token env vars during normal use.

The only supported env override path is an explicit opt-in for the current
invocation:

- global flag: `--allow-env-token`
- env var read only when that flag is present: `OPCHAIN_TOKEN_OVERRIDE`

Without `--allow-env-token`, ambient env state is ignored for token lookup.
This keeps CI and tests possible without letting shell state silently override
identity selection.

### `auto` mode means read-safe allowlist, not write detection

`auto` must resolve only for command shapes that are explicitly classified as
read-safe.

That means:

- allowlisted read-safe commands may use the default read profile
- any command shape not on that allowlist fails closed
- unknown subcommands, new `op` features, or ambiguous flag combinations do
  not guess

This is the core protection. A write-detection table is too weak.

### Telemetry never includes child process output

Debug mode must never capture or re-emit child stdout or stderr from `op` or
other subprocesses.

Allowed execution telemetry includes only safe metadata such as:

- command name and classification
- selected identity and profile
- exit status
- duration
- byte counts if useful

Disallowed execution telemetry includes:

- child stdout
- child stderr
- resolved secret values
- raw subprocess env payloads
- token-bearing command arguments

### Expiry tracking stores canonical IDs, not display names

Expiry records must be keyed by stable identifiers, not user-facing names.

Canonical record identity:

- vault UUID
- item UUID

User-facing display fields such as vault title and item title may be cached for
output, but they are not the primary key.

### File state writes must be atomic

Any file-backed state in v2 must use atomic write discipline:

- write to a temp file in the same directory
- fsync when needed
- rename into place
- protect multi-writer updates with a lock strategy

Without that, same-user agents will corrupt state sooner or later.

## Engineering constraints

### Test-driven development is required

This is a security-sensitive CLI. Core runtime behavior must be built with
strict TDD, not implementation-led test-after.

Rules:

- define the next behavior before writing code
- write exactly one failing test for that behavior
- implement the minimum code needed to make it pass
- run the full test suite on every green cycle
- refactor only with a fully passing suite
- do not batch speculative tests or speculative implementation

Docs-only work, packaging glue, local install instructions, and the initial
repository docs may use test-after. Runtime behavior must not. Config loading,
profile resolution, token providers, `op` execution, `.env.op` parsing,
expiry tracking, migration, redaction logic, and state writes must use TDD
vertical slices.

### Observability is required

`doctor` is useful, but it is not runtime observability. opchainV2 needs a
debug mode that explains what it decided, which provider it tried, what
fallback occurred, and how long key steps took.

Required global flags:

- `--debug`
- `--debug-format text|json`

The default sinks should stay local and simple:

- human-readable text to stderr
- machine-readable JSON lines to stderr using the same underlying event model

Full OpenTelemetry exporters are not required for v2.0, but the internal event
model must stay OTEL-compatible so an OTLP exporter can be added later without
rewriting the CLI.

### Redaction is mandatory

Debug output must never log:

- token values
- resolved secret values
- full environment dumps
- unredacted command arguments when they may contain sensitive data
- raw subprocess env payloads
- child process stdout or stderr
- any payload that would defeat the intended anti-leakage model

Redaction behavior must be covered by tests. It cannot be treated as a
best-effort logging convention.

## Security model

opchainV2 should be honest about what it can and cannot protect.

## What it protects against well

- accidental token leakage through `env`, `printenv`, `ps`, shell history,
  logs, and normal debugging
- accidental use of the wrong token for the wrong identity
- casual secret exposure in LLM sessions when the workflow uses `.env.op`
  plus `op run`
- stale or forgotten expiring records

## What it does not protect against

- a malicious process running as the same macOS user and deliberately asking
  for another identity's token
- a same-user agent that is allowed to run arbitrary local commands and is
  determined to bypass the intended workflow

That means Keychain is still worth keeping, but it is an anti-ambient-leakage
control, not a hard multi-tenant isolation boundary.

If `human`, `marrow`, and `marcusthorn` require hard separation on the same
physical machine, they must eventually run under separate macOS user accounts,
VMs, or separate machines. opchainV2 should not pretend otherwise.

## Target identity model

An identity is a named operator context. A profile is a token slot within an
identity.

This allows the tool to support the current model and future narrower scopes
without redesign.

| Identity | Machine | Profiles at launch | Vaults |
|---|---|---|---|
| `kevin` | personal machine | `read`, `write` | `Personal`, `SSH`, `Services`, `Models`, `Infra` |
| `human` | agent machine | `default` | `Human` |
| `marrow` | agent machine | `default` | `Marrow`, `Marrow-Models`, `Marrow-Services` |
| `marcusthorn` | agent machine | `default` | `MarcusThorn` |

Future examples:

- `marrow.admin`
- `marrow.incident`
- `human.breakglass`
- `kevin.models-write`

The implementation must treat identities and profiles as first-class data, not
as a hardcoded read/write pair.

## Command model

The main UX should stay small and obvious.

## Primary commands

```text
opchain <identity> op ...
opchain <identity> secrets list [path]
opchain <identity> secrets check [path]
opchain <identity> secrets inspect [path]
opchain <identity> secrets validate [path]
opchain <identity> expires list
opchain <identity> expires add <op://vault/item-or-uuid>
opchain <identity> expires remove <vault-uuid>/<item-uuid>
opchain <identity> expires scan
opchain doctor
opchain identity list
opchain token set --identity <id> --profile <profile> [--stdin]
opchain token remove --identity <id> --profile <profile> [--yes]
opchain migrate-v1 [--dry-run]
```

## Global flags

- `--profile <name>`
- `--read`
- `--write`
- `--allow-env-token`
- `--debug`
- `--debug-format <text|json>`

## Token input and mutation rules

`token set` and `token remove` are security-sensitive commands. Their behavior
must be explicit.

### `token set`

- never accept a token value through argv
- never read a token value from ambient env by default
- when attached to a TTY, prompt with hidden input
- when `--stdin` is passed, read exactly one token value from stdin
- write only to the selected backend contract
- emit redacted telemetry only

### `token remove`

- remove only the explicitly selected identity and profile
- require confirmation when attached to a TTY unless `--yes` is passed
- never print the removed token value

## Access selection rules

- identities with one profile use that profile by default
- `kevin` defaults to `auto`
- `auto` uses an explicit read-safe allowlist for `op ...`
- `--profile <name>` overrides automatic resolution
- `--read` and `--write` remain as compatibility flags for identities that
  define those profiles
- unknown or ambiguous `op` command shapes must fail closed and require an
  explicit `--profile`, `--read`, or `--write`
- `--allow-env-token` only changes where the token is sourced; it does not
  bypass identity or profile resolution

Examples:

```bash
opchain kevin op vault list
opchain kevin op item edit "Stripe" --vault Services
opchain kevin --write op item edit "Stripe" --vault Services
opchain marrow secrets check .
opchain human expires scan
opchain marcusthorn op read "op://MarcusThorn/Apple ID/password"
opchain kevin --allow-env-token op vault list
opchain migrate-v1 --dry-run
```

## `.env.op` policy

`.env.op` is the default and recommended workflow.

Rules for v2:

- documentation must treat `.env.op` as the normal path
- examples must use `.env.op`, not `.env`
- the CLI must never encourage copying secret values into plaintext files
- `secrets validate` with no path scans the current working directory only
- `secrets validate <file>` validates that file only
- `secrets validate <dir>` scans that directory recursively
- project-wide validation against `projects_dir` must be explicit via a flag,
  not the default pathless behavior
- recursive scans must ignore `.git`, `node_modules`, `dist`, `build`,
  `.next`, and `coverage`
- symlinked directories are skipped by default
- when a scanned directory contains `.env` but not `.env.op`, v2 should print
  a non-blocking warning that `.env.op` is preferred for secret references
- unique refs are validated once per run, even if repeated across files

The product goal is not just to support `.env.op`; it is to push the workflow
there on purpose.

## Storage layout

Use a file-based design. Do not add SQLite unless a real data problem shows up.

## Config path

```text
~/.config/opchain/config.toml
```

## State paths

```text
~/.config/opchain/state/expires/<identity>.json
~/.config/opchain/state/locks/
~/.config/opchain/cache/
```

Notes:

- debug events go to stderr by default and are not persisted locally in v2.0
- if debug log persistence is added later, it must be explicit and documented
- state writers must use atomic update rules

## Keychain naming

Use one service name and structured account names.

- service: `opchain`
- account format: `opchain:<identity>:<profile>`

Examples:

- `opchain:kevin:read`
- `opchain:kevin:write`
- `opchain:human:default`
- `opchain:marrow:default`
- `opchain:marcusthorn:default`

## Config semantics

The config file is local policy and operator metadata. It does not expand 1Password
permissions.

### Vault lists

Configured `vaults` are a local allowlist and documentation aid.

They may be used to:

- show intended scope in `doctor`
- validate explicit vault-targeting commands against local expectations
- warn when runtime usage falls outside declared local scope

They must not be described as the primary security boundary. The service-account
token scope remains the real boundary.

## Example config

```toml
[defaults]
projects_dir = "/Users/kevin/dev"
expires_threshold_days = 14
keychain_backend = "helper"
enforce_vault_allowlist = true

[identities.kevin]
default_mode = "auto"
vaults = ["Personal", "SSH", "Services", "Models", "Infra"]

[identities.kevin.profiles.read]
keychain_account = "opchain:kevin:read"

[identities.kevin.profiles.write]
keychain_account = "opchain:kevin:write"

[identities.human]
default_mode = "default"
vaults = ["Human"]

[identities.human.profiles.default]
keychain_account = "opchain:human:default"

[identities.marrow]
default_mode = "default"
vaults = ["Marrow", "Marrow-Models", "Marrow-Services"]

[identities.marrow.profiles.default]
keychain_account = "opchain:marrow:default"

[identities.marcusthorn]
default_mode = "default"
vaults = ["MarcusThorn"]

[identities.marcusthorn.profiles.default]
keychain_account = "opchain:marcusthorn:default"
```

## Architecture

This should be a single-package CLI. No monorepo.

## Project shape

```text
opchainV2/
├── README.md
├── ROADMAP.md
├── EXECUTION_CHECKLIST.md
├── SECURITY.md
├── Justfile
├── package.json
├── bunfig.toml
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── cli/
│   │   ├── parse-argv.ts
│   │   └── commands/
│   ├── domain/
│   │   ├── identity.ts
│   │   ├── profile.ts
│   │   ├── access-mode.ts
│   │   └── errors.ts
│   ├── services/
│   │   ├── resolve-profile.ts
│   │   ├── run-op.ts
│   │   ├── validate-env-op.ts
│   │   └── scan-expiry.ts
│   └── infra/
│       ├── config/
│       ├── keychain/
│       ├── op/
│       ├── state/
│       ├── output/
│       └── telemetry/
└── test/
    ├── integration/
    ├── unit/
    └── fixtures/
```

One test tree is enough. A duplicate `src/test` tree is bad structure.

## Core abstractions

### Identity registry

Loads config, validates identities and profiles, and resolves the selected
runtime identity.

### Token provider interface

Backends:

- explicit env override provider
- macOS helper provider
- `/usr/bin/security` fallback provider

Default resolution order:

1. helper backend
2. `security` fallback
3. fail with a precise error

When `--allow-env-token` is passed:

1. explicit env override provider using `OPCHAIN_TOKEN_OVERRIDE`
2. helper backend
3. `security` fallback
4. fail with a precise error

The env override path exists for tests, CI, and controlled bootstrap cases. It
must be visibly enabled per invocation.

### op executor

Takes an identity plus profile, resolves a token, and runs `op` with the token
available only to the target child process through
`OP_SERVICE_ACCOUNT_TOKEN`.

The parent process must not export that token into its own shell state.

### Secrets service

Parses `.env.op`, lists refs, validates refs, inspects items, and scans project
paths for `.env.op` files.

`secrets inspect` may return metadata such as vault, item title, field names,
and expiry information. It must not print resolved secret values.

### Expiry service

Tracks canonical `vault_uuid` plus `item_uuid` pairs, resolves metadata through
`op`, and stores local status records per identity.

`expires add` may accept a human-readable `op://...` reference, but it must
resolve that reference into canonical IDs before persisting state.

### Telemetry interface

Records redaction-aware spans and events. The default sinks are local text and
JSON output to stderr, but the schema should map cleanly onto OTEL concepts so
an OTLP exporter can be added later without redesign.

## Observability model

Debug mode must emit structured, run-scoped telemetry.

## Event schema

Each event or span record should support at least:

- `timestamp`
- `trace_id`
- `span_id`
- `parent_span_id`
- `name`
- `status`
- `duration_ms`
- `attributes`

The text formatter should be a view over the same underlying data model used by
JSON mode.

## Required events

- `config.load`
- `identity.resolve`
- `profile.resolve`
- `token.provider.attempt`
- `token.provider.success`
- `token.provider.failure`
- `op.command.classify`
- `op.exec.start`
- `op.exec.finish`
- `envop.scan.file`
- `envop.validate.ref`
- `expires.scan.item`
- `migration.plan`
- `migration.apply`

## Safe telemetry guidance

Execution telemetry may include attributes such as:

- `identity`
- `profile`
- `command_name`
- `classification`
- `provider_name`
- `exit_code`
- `duration_ms`
- `stdout_bytes`
- `stderr_bytes`

Execution telemetry must not include:

- `stdout`
- `stderr`
- `env`
- `token`
- resolved secret strings
- raw `op://...` values when the path may be sensitive

## Keychain strategy

Keychain should stay, but with a cleaner contract.

## Why keep it

- both machines are macOS
- the agent machine has multiple identities, so tokens should not live as a
  pile of ambient env vars
- the personal machine has write-capable profiles, so ambient env vars are an
  even worse fit there
- Keychain lookup keeps tokens out of normal logs and command output

## Why the current v1 model is not enough

If the CLI only shells out to `/usr/bin/security`, trusted-app scoping is not
meaningful. That is the same flaw called out in v1.

## v2 plan

- keep a provider abstraction from day one
- support `/usr/bin/security` as a bootstrap fallback
- keep or rebuild a tiny native helper for real Keychain reads on macOS
- prefer the helper on `kevin` and any write-capable profile
- show helper status in `doctor`

This means the main product is Bun, but the Keychain boundary may still use a
small native helper. That is acceptable. Pretending pure TypeScript solves the
Keychain trust problem would be dishonest.

## Implementation phases

## Phase 0: Repository bootstrap and documentation baseline

### Deliverables

- create `~/dev/opchainV2`
- initialize Bun package
- add TypeScript strict config
- add `bun test`
- add lint and format commands using the latest stable Biome
- add a Husky pre-commit hook definition for lint, format, and typecheck
- activate Husky once the repo has a `.git` directory
- add a unit and integration test harness for TDD slices
- add fake `op`, fake `security`, and fake helper fixtures
- add a telemetry interface plus text and JSON debug sinks
- verify and update `README.md` for humans and agents
- verify and update `SECURITY.md` with explicit trust boundaries and handling rules
- verify and update the `Justfile` so repository entrypoints stay accurate
- keep this roadmap and the execution checklist in sync with reality

### Acceptance criteria

- `bun test` runs
- `bun run lint`, `bun run format`, and `bun run typecheck` run
- `bun run src/index.ts --help` exits cleanly
- the Husky pre-commit hook is verified once the repo has a `.git` directory
- fixture-backed tests can stub `op`, `security`, and helper behavior
- `--debug-format json` emits valid structured events without leaking env
  values
- `README.md`, `SECURITY.md`, `ROADMAP.md`, and
  `EXECUTION_CHECKLIST.md` agree on the trust model and current status
- the `Justfile` does not claim non-existent build targets

## Phase 1: Config and identity model

### Deliverables

- config loader for `config.toml`
- validation for identities, profiles, defaults, and vault allowlists
- domain types for identity, profile, and access mode
- `identity list` and `doctor` basics
- debug events for config load and identity resolution

### Acceptance criteria

- invalid config fails fast with useful errors
- identities and profiles are not hardcoded in command handlers
- `doctor` can list configured identities and profiles
- `doctor` explains vault allowlist intent without overstating it as a hard
  boundary
- debug output shows redacted config and identity resolution events

## Phase 2: Token providers

### Deliverables

- explicit env override provider guarded by `--allow-env-token`
- Keychain helper provider
- `/usr/bin/security` fallback provider
- profile resolution logic
- token setup and removal commands
- provider attempt, success, and failure debug events
- token redaction helpers and tests

### Acceptance criteria

- ambient env tokens are ignored unless `--allow-env-token` is passed
- a token can be stored and fetched for `kevin.read`
- a token can be stored and fetched for `marrow.default`
- profile resolution chooses the right account name
- errors do not print token values
- debug output shows provider order without token values
- `token set` never accepts token values through argv

## Phase 3: `op` execution path

### Deliverables

- `opchain <identity> op ...`
- child-process-only token injection
- read-safe allowlist for `auto`
- explicit `--profile`, `--read`, and `--write` overrides
- command classification debug events
- telemetry rules that exclude child stdout and stderr

### Acceptance criteria

- `kevin` read operations use `kevin.read`
- `kevin` write operations use `kevin.write`
- single-profile identities use `default`
- token is not exported into the parent shell
- unknown or ambiguous `op` commands fail closed and require explicit profile
  selection
- debug output never includes child stdout or stderr

## Phase 4: `.env.op` features

### Deliverables

- `secrets list`
- `secrets check`
- `secrets inspect`
- `secrets validate`
- directory scanning for `.env.op`
- explicit project-wide validation flag using `projects_dir`
- `.env` preference warning
- scan and validation debug events

### Acceptance criteria

- unique refs are validated once per run
- output is readable for both success and failure cases
- quoted values, comments, and blank lines are handled correctly
- no-path validation scopes to the current working directory only
- project-wide validation works only when explicitly requested
- debug output does not print resolved secret values

## Phase 5: Expiry tracking

### Deliverables

- per-identity expiry state file
- lock-aware atomic state writer
- `expires list`
- `expires add`
- `expires remove`
- `expires scan`
- stable record format using vault UUID plus item UUID
- expiry scan and threshold evaluation debug events

### Acceptance criteria

- tracked items survive title changes
- tracked items survive vault-title changes
- expiring and expired states are correct
- missing or unreadable items are reported clearly
- threshold is configurable
- concurrent updates do not corrupt state
- debug output shows scan decisions without leaking secret data

## Phase 6: Migration from v1

### Deliverables

- `migrate-v1 --dry-run`
- `migrate-v1` apply path
- import of v1 Keychain account names into new profile names
- import of v1 expiry watch file into canonical ID records
- migration guide in docs
- migration planning and apply debug events

### Acceptance criteria

- `opchain-read` maps cleanly to `kevin.read`
- `opchain-write` maps cleanly to `kevin.write`
- v1 expiry records import without data loss
- migration is idempotent or clearly guarded
- dry-run output explains what would change before apply
- debug output can explain which records changed without exposing token values

## Phase 7: Packaging and trust setup

### Deliverables

- compiled Bun binary
- local install command or script
- helper build instructions or helper package
- code-signing notes for personal-machine trust setup
- docs for debug flags, redaction guarantees, and OTEL-compatible events
- final README updates for install and usage
- final Justfile updates for real build and test entrypoints

### Acceptance criteria

- the binary installs into `~/.local/bin`
- the compiled binary prints `--help`
- `doctor` reports binary path and helper status
- docs explain the difference between helper mode and `security` fallback
- docs explain `--debug`, redaction behavior, and OTEL-compatible JSON events
- README and Justfile reflect the implemented command surface, not the planned
  one

## Test plan

## TDD workflow

Every behavior phase should be implemented as vertical slices:

1. plan the next behavior
2. write one failing test
3. implement the minimum to pass
4. run the full suite
5. refactor with the suite still green
6. repeat

Do not queue multiple new tests before the current one is green.

## Unit tests

- config parsing
- identity and profile validation
- access-mode resolution
- read-safe allowlist and fail-closed behavior
- `.env.op` parser edge cases
- expiry status calculation
- canonical expiry record serialization and deserialization
- telemetry event schema and formatting
- redaction rules for tokens, secrets, sensitive arguments, and child output
- atomic state write helpers and lock behavior

## Integration tests

Use mocked `op`, mocked `security`, mocked helper behavior, and fixture
directories.

- token lookup through each provider
- env override behavior only when `--allow-env-token` is enabled
- `opchain <identity> op ...` process execution
- telemetry proves child stdout and stderr are not logged
- project-wide `.env.op` validation using an explicit flag
- expiry scan against fake `op item get` JSON
- migration from v1 config and state
- debug JSON mode for config load, provider selection, and `op` execution

## Manual smoke tests

### kevin machine

- `kevin.read`
- `kevin.write`
- helper enabled
- helper disabled fallback
- `--debug`
- confirm debug output is useful and redacted
- confirm ambient env tokens are ignored without `--allow-env-token`

### agent machine

- `human.default`
- `marrow.default`
- `marcusthorn.default`
- `--debug`
- confirm output does not leak tokens during normal use
- confirm state updates do not corrupt under repeated scans

## Migration notes

## What migrates automatically

- v1 expiry records
- v1 read and write token references for `kevin`
- `projects_dir`
- expiry threshold

## What does not migrate

- LLM settings
- `create` behavior
- assumptions that only read/write accounts exist
- any false assumption that vault names are stable identifiers

## Operational guidance after migration

- use `.env.op` for secret references
- use service accounts with narrow vault scopes
- only define write-capable profiles where justified
- do not assume same-user local identities are strongly isolated
- prefer helper mode over `security` fallback where practical

## Open risks and required decisions

## Risk: false sense of isolation

Same-user agents on the same macOS login are not strongly isolated by
opchainV2. This must be documented everywhere it matters.

### Decision

Ship with explicit docs and warnings. If hard identity separation becomes a
real requirement, move the identities onto separate macOS users or hosts.

## Risk: helper complexity

A native helper adds complexity, but dropping it weakens the Keychain trust
story.

### Decision

Keep the helper abstraction in the design. Ship fallback first only if it
unblocks delivery, but do not pretend it is equally strong.

## Risk: feature creep

The product can easily bloat back into a wrapper around all of `op`.

### Decision

Keep v2 focused on identity selection, `.env.op`, expiry tracking, and a thin
`op` execution path.

## Risk: noisy or unsafe debug output

Observability is necessary, but careless debug output can leak the exact data
the tool exists to protect.

### Decision

Ship debug mode in v2.0 with a redaction-aware design, keep the default sinks
local, and stay OTEL-compatible without pulling in full exporter complexity for
v2.0.

## Risk: file-state corruption under concurrent use

File-based state is simple, but same-user concurrent agents can corrupt it if
writes are sloppy.

### Decision

Require atomic writes and lock-aware updates from the first stateful slice.

## Definition of done for v2.0

v2.0 is done when all of the following are true:

- `kevin`, `human`, `marrow`, and `marcusthorn` can each run through their own
  configured identity
- `kevin` supports read and write profiles with `auto` mode based on a
  read-safe allowlist
- ambient env tokens are ignored unless explicitly enabled for that invocation
- `.env.op` validation is stable and useful across project trees
- expiry tracking works per identity using canonical IDs
- migration from v1 works for the current personal-machine setup
- docs are explicit about the limits of same-user isolation
- the installed binary is simpler to trust and maintain than v1
- runtime behavior is covered by TDD-built tests
- debug mode is useful, redacted, and OTEL-compatible
- README, SECURITY.md, ROADMAP.md, EXECUTION_CHECKLIST.md, and the Justfile
  all describe the same system without contradiction

## Recommended build order

Build in this order and do not skip ahead:

1. bootstrap repo, docs, tests, and telemetry foundation
2. config and identity model
3. token providers
4. `op` execution path
5. `.env.op` commands
6. expiry tracking
7. migration
8. packaging and helper trust story

Anything else is distraction until those are complete.
