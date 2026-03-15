# opchainV2 Execution Checklist

This checklist turns `ROADMAP.md` into an execution order.

Build one vertical slice at a time. Do not batch speculative tests,
speculative abstractions, or placeholder commands.

## Current repository status

The repository now has the first verified Phase 0 slice.

What exists today:

- Bun + TypeScript baseline
- Biome lint and format scripts
- Husky pre-commit hook definition for lint, format, and typecheck
- config loader for `config.toml`
- minimal `src/index.ts` help path
- `identity list` and `doctor` basics
- helper-backed token mutation flows
- first `opchain <identity> op ...` slices for single-profile `vault list` and auto-mode read-profile resolution
- text and JSON debug telemetry
- redacted `config.load` and `identity.resolve` events
- helper token-provider slice
- unit and integration coverage for config loading, helper lookup, token mutation, and current CLI entrypoints

That means the job now is to keep stacking small verified slices while keeping
the docs honest.

## Global working rules

- Use strict TDD for core runtime behavior.
- Write one failing test before each implementation step.
- Run the full suite on every green cycle.
- Keep access selection fail-closed.
- Keep debug output redacted.
- Keep the internal telemetry model OTEL-compatible.
- Do not pull in a full OTEL exporter stack in v2.0.
- Keep `README.md`, `SECURITY.md`, `ROADMAP.md`, and this checklist aligned.
- Do not let the Justfile claim targets that do not exist yet.

## Cross-cutting definitions

### Minimum telemetry fields

Every debug event should support these fields from the start:

- `timestamp`
- `trace_id`
- `span_id`
- `parent_span_id`
- `name`
- `status`
- `duration_ms`
- `attributes`

### Redaction rules

Never log:

- token values
- resolved secret values
- full environment dumps
- unredacted sensitive arguments
- raw subprocess env payloads
- child process stdout
- child process stderr

### Token source rule

Ambient env tokens are ignored by default.

The env override path exists only when the current invocation explicitly passes
`--allow-env-token`. When that flag is absent, env token state is out of scope
for provider resolution.

### Fail-closed rule

If `op` command classification is unknown or ambiguous, require explicit
profile selection. Never guess.

### `auto` mode rule

`auto` is a read-safe allowlist, not a write-detection table.

Only allowlisted read-safe command shapes may resolve automatically. Anything
else must fail closed.

### Expiry identity rule

Persist expiry records by canonical identifiers:

- vault UUID
- item UUID

Display names are cached metadata only.

### File-state rule

Any persisted state update must use an atomic write path and a lock strategy.

## Phase 0: Repository bootstrap and documentation baseline

### Goal

Create the smallest runnable CLI plus the testing, telemetry, and
documentation baseline.

### Checklist

- [x] initialize Bun package and scripts
- [x] add strict `tsconfig.json`
- [x] add `bun test`, lint, format, and typecheck commands
- [x] use the latest stable Biome for lint and format
- [x] add a Husky pre-commit hook definition that runs lint, format, and typecheck
- [ ] activate Husky in a real Git repo and verify the hook runs
- [x] create `src/index.ts` entrypoint
- [x] create a subprocess-friendly integration test harness
- [x] create fake `op`, fake `security`, and fake helper fixtures
- [x] define minimal telemetry event types and sink functions
- [x] add text debug sink
- [x] add JSON debug sink
- [x] ensure `bun run src/index.ts --help` works
- [x] add full `README.md`
- [x] add `SECURITY.md`
- [x] add an accurate `Justfile`

### Suggested slice order

1. CLI help path works under test.
2. `--debug-format json` emits a valid redacted event.
3. text debug sink uses the same event model as JSON mode.
4. Biome backs the lint and format commands.
5. Husky pre-commit runs lint, format, and typecheck.
6. fixture-backed tests can stub external executables.
7. shared test helpers remove subprocess duplication.
8. repo docs explain the current status and read order accurately.

### Exit gate

Do not leave Phase 0 until all of these are true:

- `bun test` passes
- `bun run lint`, `bun run format`, and `bun run typecheck` pass
- `bun run src/index.ts --help` exits cleanly
- the Husky pre-commit hook is verified once the repo has a `.git` directory
- debug JSON output is valid and redacted
- fake executable fixtures are usable from tests
- repository docs agree on the trust model and current status
- the Justfile only exposes real, current workflows

## First TDD slice for Phase 0

### Why this slice first

If the first slice does not prove subprocess execution, CLI argument parsing,
and JSON debug output, the rest of Phase 0 will drift into scaffolding without
behavior.

### Target behavior

When the CLI is invoked with `--debug --debug-format json --help`, it:

- exits with status `0`
- prints help output
- emits at least one valid JSON debug event to stderr
- does not leak environment values in that debug event

### Proposed public surface

- `src/index.ts` as the CLI entrypoint
- a minimal help command path
- a telemetry sink interface used by the CLI runtime

### RED

Write exactly one failing integration test, likely at:

- `test/integration/help-debug-json.test.ts`

The test should:

1. spawn the CLI as a child process
2. pass `--debug --debug-format json --help`
3. assert exit code `0`
4. assert stdout contains `Usage:` or equivalent help text
5. parse stderr as newline-delimited JSON
6. assert the first event includes the required telemetry keys
7. assert stderr does not contain an injected fake env value like
   `SHOULD_NOT_LEAK`

The first run should fail because the CLI and sink do not exist yet.

### GREEN

Implement the minimum needed to pass:

- minimal argument parsing for `--debug`, `--debug-format`, and `--help`
- a tiny help renderer
- a telemetry event factory with static IDs if needed
- a JSON sink that writes one event to stderr
- redaction that drops env payloads entirely for this slice

Do not add spans, commands, config loading, or provider logic yet.

### REFACTOR

Only after the test is green:

- extract a tiny telemetry type
- extract CLI option parsing if the file becomes messy
- keep one event model shared by future text and JSON sinks

Do not broaden behavior during refactor.

### Done condition

This slice is done when the single integration test passes and the full suite
is still green.

## Phase 1: Config and identity model

### Goal

Load config safely, validate identities and profiles, and expose `identity
list` and `doctor` basics.

### Checklist

- [x] define config schema and parser
- [x] validate identities, profiles, defaults, and vault allowlists
- [x] model access mode as domain data
- [x] implement `identity list`
- [x] implement minimal `doctor`
- [x] emit `config.load` and `identity.resolve` events
- [x] add redaction for config-derived debug attributes

### Suggested slice order

1. valid config loads into typed domain data
2. invalid config fails with a precise error
3. `identity list` prints configured identities
4. `doctor` prints configured identities and profiles
5. `doctor` explains declared vault scope without overstating it as isolation
6. debug output includes redacted config load events

### Exit gate

- invalid config fails fast
- handlers do not hardcode identity names
- `doctor` output is useful
- debug output shows config and identity decisions without secrets

## Phase 2: Token providers

### Goal

Resolve tokens through a provider chain without leaking token data.

### Checklist

- [x] implement env override provider guarded by `--allow-env-token`
- [x] implement helper provider contract
- [x] implement `/usr/bin/security` fallback provider
- [x] implement provider resolution order
- [x] implement token set command
- [x] implement token remove command
- [x] add interactive confirmation for `token remove` TTY mode
- [x] emit provider attempt, success, and failure events
- [x] test token redaction paths

### Suggested slice order

1. helper provider resolves a token
2. security fallback resolves a token when helper is absent
3. env override resolves only when `--allow-env-token` is present
4. provider failure reports a precise redacted error
5. token set uses hidden prompt or `--stdin`, never argv
6. token remove confirms or requires `--yes`

### Exit gate

- provider order is deterministic
- ambient env tokens do not override normal runs
- no token value appears in output or debug events
- profile resolution selects the correct keychain account
- token mutation commands do not accept token values through argv

## Phase 3: `op` execution path

### Goal

Run `op` with child-only token injection and safe profile selection.

### Checklist

- [x] implement `opchain <identity> op ...`
- [x] inject token into child process only
- [x] define read-safe allowlist for `auto`
- [x] fail closed on unknown or ambiguous command shapes
- [x] support `--profile`, `--read`, and `--write`
- [x] support `--allow-env-token` without bypassing profile resolution
- [x] emit classification and execution events
- [x] forbid telemetry capture of child stdout and stderr

### Suggested slice order

1. single-profile identity can run an allowlisted read-safe `op` command
2. `kevin` read command resolves `kevin.read`
3. `kevin` write command resolves `kevin.write`
4. unknown command shape fails closed
5. explicit overrides bypass auto classification cleanly
6. debug telemetry proves child output is not logged

### Exit gate

- parent shell env stays clean
- classification is deterministic
- unknown commands do not guess
- debug mode never mirrors child stdout or stderr

## Phase 4: `.env.op` features

### Goal

Parse and validate `.env.op` files without exposing resolved secret values.

### Checklist

- [x] parse `.env.op` files
- [x] implement `secrets list`
- [x] implement `secrets check`
- [x] implement `secrets inspect`
- [x] implement `secrets validate`
- [x] scan directories for `.env.op`
- [x] add explicit project-wide validation flag using `projects_dir`
- [x] emit `.env` preference warnings
- [x] emit scan and validation events

### Suggested slice order

1. parser handles comments, blanks, and quoted values
2. `secrets list` extracts unique refs
3. `secrets check` validates refs once per run
4. `secrets inspect` reports metadata without printing secret values
5. pathless `secrets validate` scopes to the current directory only
6. project-wide validation scans `projects_dir` only when explicitly asked

### Exit gate

- duplicate refs are deduplicated per run
- output is readable
- debug mode never prints resolved secret data
- default scan scope is obvious and bounded

## Phase 5: Expiry tracking

### Goal

Track expiring records per identity with stable item references.

### Checklist

- [x] define canonical state file schema
- [x] implement lock-aware atomic writer
- [x] implement `expires add`
- [x] implement `expires remove`
- [x] implement `expires list`
- [x] implement `expires scan`
- [x] compute expiring and expired states
- [x] emit scan and threshold events

### Suggested slice order

1. state file can persist one canonical tracked item
2. `expires add` resolves display refs into vault UUID plus item UUID
3. `expires list` reads persisted state
4. scan updates status from fake `op` metadata
5. missing items report clearly
6. threshold configuration changes status classification
7. concurrent updates stay uncorrupted

### Exit gate

- title changes do not break tracking
- vault-title changes do not break tracking
- state survives restarts
- state writes remain valid under repeated updates
- debug output explains scan decisions safely

## Phase 6: Migration from v1

### Goal

Import v1 token references and expiry records without corrupting data.

### Checklist

- [x] detect v1 config and state inputs
- [x] implement `migrate-v1 --dry-run`
- [x] map v1 token names to v2 identities and profiles
- [x] import v1 expiry records
- [x] make migration idempotent or explicitly guarded
- [x] emit migration plan and apply events
- [x] document migration behavior

### Suggested slice order

1. dry-run shows planned token mappings
2. v1 read and write mappings import for `kevin`
3. expiry watch records import cleanly into canonical IDs
4. repeated migration is safe or blocked with a clear message

### Exit gate

- no silent data loss
- mapping behavior is explicit
- dry-run is available before apply
- debug mode explains changes without leaking token values

## Phase 7: Packaging and trust setup

### Goal

Produce an installable local binary and document trust boundaries honestly.

### Checklist

- [x] build compiled Bun binary
- [x] add local install script or command
- [x] document helper build steps
- [x] document code-signing and trust notes
- [x] document debug flags and OTEL-compatible JSON events
- [x] document helper versus `security` fallback behavior
- [x] update README for implemented install and usage flows
- [x] update Justfile for real build and test entrypoints

### Suggested slice order

1. local binary builds
2. local install path works
3. compiled binary prints `--help`
4. `doctor` reports binary path and helper status
5. packaging docs explain trust and fallback limits
6. repo docs stop describing the project as docs-only

### Exit gate

- binary installs into `~/.local/bin`
- docs are honest about trust boundaries
- docs explain debug mode and event format
- README and Justfile reflect implemented behavior

## Immediate next action

Start the next Phase 6 RED test for documenting migration behavior and then
re-check packaging acceptance against the installed binary flow.

Before that, keep the current slices green with `bun test`, `bun run lint`,
and `bun run typecheck`. If this folder becomes a real Git repo, run
`bun run prepare` and verify the Husky hook actually fires.
