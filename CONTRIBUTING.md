# Contributing

## Setup

```bash
bun install --frozen-lockfile
```

## Development workflow

```bash
bun run typecheck       # tsc --noEmit
bun run lint            # biome lint .
bun run format          # biome format --write .
bun run test:unit       # fast, no external dependencies
bun run test:integration # fixture-based, uses test bin stubs
bun test                # full suite
```

Keep all three gates green before opening a pull request:

```bash
bun run typecheck && bun run lint && bun run test:unit && bun run test:integration
```

## Security boundaries

Read `SECURITY.md` before changing anything related to:

- token handling or provider resolution
- child-process environment construction
- debug telemetry
- persisted state files
- argv parsing for secret-bearing commands

The tool must not log token values, resolved secret values, raw subprocess env
payloads, or child-process stdout/stderr in telemetry or error messages.

## Test-driven development

Core runtime behavior changes must follow strict TDD:

1. Write one failing test for the next slice.
2. Implement the minimal fix.
3. Commit.

Fixture-backed integration tests live under `test/fixtures/bin/`.
Unit tests live alongside their covered modules.

## Commit conventions

Keep commits atomic and descriptive. The repository does not yet enforce a
commit-lint rule; prefer imperative present-tense summaries.

## Pull requests

- Link against a filed issue when there is one.
- Include verification output in the PR body or a comment.
- If the change affects command behavior, update `README.md` in the same PR.
- If the change modifies a security boundary, update `SECURITY.md` in the same
  PR.
