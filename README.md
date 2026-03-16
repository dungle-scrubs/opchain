# opchainV2

opchainV2 is a macOS-first Bun CLI under construction for running
1Password service-account workflows with explicit identities,
child-process token injection, `.env.op` validation, expiry tracking, and
redacted debug telemetry.

## Status

The initial Phase 0 bootstrap is in place, Phases 1 through 7 are largely in
place, and only a small amount of cleanup remains.

Implemented so far:

- Bun + TypeScript project baseline with strict typecheck
- Biome 2.4.7 lint and format scripts
- config loader for `~/.config/opchain/config.toml`
- typed validation for defaults, identities, profiles, and vault arrays
- `opchain --help`
- `opchain identity list`
- `opchain doctor`
- `opchain token set --identity <id> --profile <profile> [--stdin]`
- `opchain token remove --identity <id> --profile <profile> [--yes]`
- `opchain <identity> op vault list` for single-profile identities and auto-mode read profiles
- `opchain <identity> --write op ...` for identities that define a write profile
- `opchain <identity> secrets list [path]`
- `opchain <identity> secrets check [path]`
- `opchain <identity> secrets inspect <op://...>`
- `opchain <identity> secrets validate [path]`
- `opchain <identity> secrets validate --project-wide`
- `opchain <identity> expires add <op://...>`
- `opchain <identity> expires remove <vault-uuid>/<item-uuid>`
- `opchain <identity> expires list`
- `opchain <identity> expires scan`
- `opchain migrate-v1 --dry-run`
- `opchain migrate-v1`
- text and JSON debug telemetry to stderr
- redacted `config.load` and `identity.resolve` debug events
- helper token-provider contract
- `/usr/bin/security` fallback token-provider contract
- deterministic provider resolution order: env override when explicitly allowed,
  then helper, then security fallback
- precise redacted provider-failure reporting when all attempted providers fail
- provider attempt, success, and failure telemetry during token resolution
- split unit and integration test entrypoints via `bun run test:unit` and
  `bun run test:integration`
- GitHub Actions CI workflow for lint, typecheck, unit tests, integration
  tests, and build verification
- unit and integration tests for help, config loading, provider resolution,
  provider redaction, provider telemetry, `identity list`, `doctor`,
  token mutation flows, and early `op` execution slices

Current repository contents:

- `README.md`
- `SECURITY.md`
- `ROADMAP.md`
- `EXECUTION_CHECKLIST.md`
- `MIGRATION.md`
- `PACKAGING.md`
- `Justfile`
- `package.json`
- `bun.lock`
- `tsconfig.json`
- `biome.json`
- `src/`
- `test/`
- `.github/workflows/ci.yml`
- `.husky/pre-commit`

The Husky hook is defined, but this folder is not a Git repo yet, so it is not
installed through `core.hooksPath` yet.

Most of the planned command surface is still unimplemented, especially
migration events/docs, packaging, and some deeper polish around multi-profile
`op` execution and richer reporting.

## Who this repo is for

Two audiences matter:

- humans maintaining the tool
- agents working on the tool without guessing

The docs are written to remove ambiguity for both.

## Read order

Read these files in order before making changes:

1. `README.md`
2. `SECURITY.md`
3. `ROADMAP.md`
4. `EXECUTION_CHECKLIST.md`

## Why opchainV2 exists

The existing `opchain` solves useful problems, but its shape is wrong.

Problems with v1:

- too much Bash
- too much implicit state
- too much wrapper surface area
- weak trust story around shell-heavy Keychain access

The v2 plan is intentionally smaller.

## Planned scope

The planned product is a compiled Bun CLI that does these things well:

- resolve named identities and profiles
- inject 1Password service-account tokens into child processes only
- validate `.env.op` files and push usage toward `.env.op`, not `.env`
- track expiring records by stable identifiers
- explain runtime decisions through redacted debug telemetry
- migrate the useful parts of v1 without carrying its baggage forward

## Non-goals

opchainV2 is not supposed to become:

- a general secret manager
- a policy engine
- a fake isolation layer between agents running as the same macOS user
- a broad wrapper around everything `op` can do

## Security posture in one page

The design goal is anti-ambient-leakage, not hard local multi-tenant
isolation.

What the planned tool should do well:

- keep tokens out of normal shell state
- reduce wrong-token mistakes
- reduce accidental secret leakage into logs and agent context
- keep expiry tracking operationally useful

What it does not magically solve:

- a malicious process running as the same macOS user
- an agent with permission to run arbitrary local commands
- hard identity separation on one shared macOS login

Read `SECURITY.md` before changing the token model, telemetry, or storage.

## Hard rules for implementation

These are not suggestions.

- Use strict TDD for core runtime behavior.
- Write one failing test before each implementation step.
- Keep `auto` mode fail-closed.
- Treat `auto` as a read-safe allowlist, not a write detector.
- Ignore ambient env tokens unless the invocation explicitly passes
  `--allow-env-token`.
- Never log token values, resolved secret values, raw subprocess env payloads,
  or child process stdout/stderr.
- Persist expiry state by vault UUID plus item UUID.
- Use atomic file writes and a lock strategy for persisted state.
- Keep docs and implementation aligned. If the code changes, the docs change.

## Command surface

Implemented now:

```text
opchain doctor
opchain identity list
opchain token set --identity <id> --profile <profile> [--stdin]
opchain token remove --identity <id> --profile <profile> [--yes]
opchain <identity> op vault list   # single-profile identities and auto-mode read profiles
opchain <identity> --write op ...  # explicit write-profile override
opchain <identity> secrets list [path]
opchain <identity> secrets check [path]
opchain <identity> secrets inspect <op://...>
opchain <identity> secrets validate [path]
opchain <identity> secrets validate --project-wide
opchain <identity> expires add <op://vault/item-or-uuid>
opchain <identity> expires remove <vault-uuid>/<item-uuid>
opchain <identity> expires list
opchain <identity> expires scan
opchain migrate-v1 --dry-run
opchain migrate-v1
```

Still planned:

```text
opchain <identity> op ...          # broader profile selection and fail-closed coverage
opchain <identity> --profile <name> op ...
opchain <identity> --read op ...
opchain <identity> --allow-env-token op ...
```

## Primary source documents

### `SECURITY.md`

The threat model, trust boundaries, and data-handling rules. Read this before
changing anything related to tokens, env handling, subprocess execution,
telemetry, or state files.

### `ROADMAP.md`

The full implementation plan. It explains the architecture, command model,
security invariants, phases, risks, and definition of done.

### `MIGRATION.md`

The current v1 to v2 migration behavior, including dry-run, apply mode, and
its guard rails.

### `PACKAGING.md`

The local build, install, helper fallback, debug, and trust notes for the
current binary packaging flow.

### `EXECUTION_CHECKLIST.md`

The ordered build sequence. This is the file to follow when turning the roadmap
into concrete vertical slices.

### `Justfile`

The repository entrypoints for humans and agents. It must stay accurate. It
must not advertise commands that do not exist yet.

## Current workflow

The repository now has a substantial runnable baseline, so the workflow is:

1. read the docs in order
2. keep `bun run test:unit`, `bun run test:integration`, `bun run lint`, and
   `bun run typecheck` green
3. use `bun test` when you want the full suite in one command
4. add one failing test for the next slice
5. implement only the smallest passing change
6. keep the docs honest as the codebase grows

## Repo conventions for humans and agents

- Do not invent new abstractions before the current slice is green.
- Do not broaden the CLI surface without updating the roadmap first.
- Use the latest stable Biome for lint and format once the package baseline
  exists.
- Add a Husky pre-commit hook that runs lint, format, and typecheck.
- Do not treat local config as the real trust boundary; the token scope is the
  real boundary.
- Do not add persistent debug logs by default.
- Do not create duplicate test trees.
- Do not leave README or checklist statements stale after implementation work.

## Build and install locally

Build a compiled binary:

```bash
bun run build
```

Install it into `~/.local/bin/opchain`:

```bash
bun run install-local
```

`doctor` now reports the current binary path and helper availability.

See `PACKAGING.md` for:

- helper versus `security` fallback guidance
- debug flag and JSON event notes
- local trust and code-signing notes

## Run the fixture-backed demo

Use the built-in demo entrypoint when you want to see the current CLI surface
without touching your real 1Password setup:

```bash
just demo
```

This script uses the fake helper and fake `op` binaries from `test/fixtures/`
and creates a temporary `HOME` plus a temporary project with `.env.op` files.
It demonstrates:

- `doctor`
- `identity list`
- `secrets list`, `check`, `validate`, and `inspect`
- read-safe `op` execution
- explicit `--write` profile selection
- `expires add`, `list`, and `scan`

If you want to inspect the generated temp files after the run:

```bash
just demo-keep
```

## Immediate next step

The next real steps are:

- keep the current slices green with `bun run test:unit`,
  `bun run test:integration`, `bun run lint`, and `bun run typecheck`
- use `just ci` or the GitHub Actions workflow when you want the full local or
  remote verification path
- if this folder becomes a real Git repo, run `bun run prepare` so Husky is
  actually installed
- add migration plan/apply telemetry documentation
- start packaging and trust setup documentation
