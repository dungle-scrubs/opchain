## Checklist

- [ ] Typecheck passes: `bun run typecheck`
- [ ] Lint passes: `bun run lint`
- [ ] Unit tests pass: `bun run test:unit`
- [ ] Integration tests pass: `bun run test:integration`

### Security checklist (mark N/A when not applicable)

- [ ] No token values, resolved secret values, raw subprocess env payloads, or
  child stdout/stderr appear in telemetry, error messages, or debug output.
- [ ] Token mutation still rejects input through argv.
- [ ] Any new subprocess environment respects `SECURITY.md` boundaries.
- [ ] Any new persisted state uses atomic writes.

### Docs checklist

- [ ] `README.md` updated if command surface changed.
- [ ] `SECURITY.md` updated if token, telemetry, subprocess, or state-file
  behavior changed.
- [ ] `MIGRATION.md` updated if migration behavior changed.
- [ ] `CHANGELOG.md` updated with an Unreleased entry.
