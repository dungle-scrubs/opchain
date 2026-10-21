# opchain

Run programs with 1Password secrets, without fingerprint prompts.

With `oprun`, your programs get the 1Password item values referenced in `.env.op`,
without inheriting the service-account token. Store that token in the macOS
Keychain instead of exporting it in your shell. Your agents can launch programs
without reading the token or asking for your fingerprint on every run.

```console
$ oprun sh -c 'test -z "$OP_SERVICE_ACCOUNT_TOKEN" && echo "Service token not inherited"'
Service token not inherited
```

## Install

Requirements: an Apple silicon Mac, npm for installation, and
[1Password CLI 2](https://developer.1password.com/docs/cli/get-started/) (`op`) on your `PATH`.
[Create a service account](https://developer.1password.com/docs/service-accounts/get-started/)
scoped to the vaults your programs need.

```bash
npm install -g @dungle-scrubs/opchain
```

The package installs signed, notarized `opchain` and `oprun` binaries.
Neither Node.js nor Bun is needed to run them.
For a source build, see [PACKAGING.md](PACKAGING.md).

Create `~/.config/opchain/config.toml`:

```toml
[defaults]
projects_dir = "~/dev"
expires_threshold_days = 14

[identities.primary]
default_mode = "auto"
vaults = ["Services"]

[identities.primary.profiles.read]
keychain_account = "opchain:primary:read"
```

Store the service-account token through the hidden prompt. Do not put its value
on the command line or export it in your shell:

```bash
opchain token set --identity primary --profile read
```

Put references, not secret values, in your project's `.env.op`.
Replace the example with an item and field your service account can read:

```dotenv
STRIPE_API_KEY=op://Services/Stripe/api_key
```

Confirm the setup:

```bash
opchain identity list
opchain primary op vault list
```

From the directory containing `.env.op`, run the opening example.
It prints `Service token not inherited` without printing any credential.

## Usage

### Run a program with its secrets

```bash
oprun npm start
```

In a project with a `start` script, this runs
`opchain primary --read op run --env-file .env.op -- npm start`.
`oprun` defaults to `primary`, the `read` profile, and `.env.op` in the current
directory. `op run` masks secret values in output. Use `OPRUN_ENV_FILE` to
select another env file, or `OPRUN_IDENTITY` to select another configured identity.

### Let a program call `op` itself

For a trusted script that calls `op` itself, set `OPRUN_PASS_TOKEN=1`.
This exposes the service-account token to the script and its children:

```bash
OPRUN_PASS_TOKEN=1 oprun ./script-that-calls-op.sh
```

The full form is `opchain primary --read --pass-token op run --env-file .env.op -- ./script-that-calls-op.sh`.
Without this opt-in, the program does not inherit the token and its 1Password
biometric integration is disabled.

### Run one `op` command

```bash
opchain primary op vault list
opchain primary --read op item list --vault Services
```

Only the exact `op vault list` shape can select a profile automatically.
Every other `op` command requires `--read`, `--write`, or `--profile <name>`.
For mutations, configure and store a separate write token first; see
[profile configuration](docs/reference.md#configuration).
Secret-printing commands are refused before token resolution. The
[reveal guard reference](docs/reference.md#reveal-guard) covers exceptions and the
interactive `--allow-reveal` override.

### Inspect an item without seeing any value

```bash
opchain primary item-structure "Stripe API Key" --vault Services
```

The JSON report includes the item title, vault, category, and each field's label,
type, value presence, and value length. It never includes field values.

### Check `.env.op` references before they ship

```bash
opchain primary secrets list .env.op
opchain primary secrets check .env.op
opchain primary secrets validate --project-wide
```

`check` validates one named file. `validate` accepts a file or directory;
`--project-wide` scans every `.env.op` under `projects_dir`.
Neither prints resolved secret values. `secrets inspect <op://...>` reports
metadata for one reference, including `expires_at` when present.

### Track items that expire

```bash
opchain primary expires add op://Services/Stripe/api_key
opchain primary expires list
opchain primary expires scan
```

`scan` refreshes explicitly tracked items and reports their status against
`expires_threshold_days`; it does not send notifications or rotate tokens.
Tracking requires the item's top-level `expires_at` date, not a custom date field.
See [expiry tracking](docs/reference.md#expiry-tracking) for statuses and storage.

## Reference

### Commands

```text
opchain [--debug] [--debug-format text|json] <command>
opchain identity list
opchain token set --identity <name> --profile <name> [--stdin]
opchain token remove --identity <name> --profile <name> [--yes]
opchain <identity> [--read|--write|--profile <name>] [--allow-env-token]
         [--allow-reveal] [--pass-token] [--value-fd <fd>] op <args...>
opchain <identity> item-structure <item> [--vault <vault>]
opchain <identity> secrets <list|check|inspect|validate> [path-or-ref]
opchain <identity> expires <add|remove|list|scan> [args]
opchain doctor
opchain migrate-v1 [--dry-run]
oprun <command>
```

Every command, flag, refusal form, and configuration key is documented in [docs/reference.md](docs/reference.md).

### Configuration

Configuration lives in `~/.config/opchain/config.toml`; Install shows all required keys.
`projects_dir` sets the root for `secrets validate --project-wide`, and
`expires_threshold_days` sets the scan window.
Each identity has a `default_mode`, a `vaults` list, and named profiles.
The vault list records intent and is not enforced. Each profile's
`keychain_account` identifies its token under the Keychain service `opchain`.

### Exit codes

Successful built-in commands exit 0; refusals and errors exit 1.
Delegated `op` exit codes pass through. Signal termination exits 128 plus the signal number.
Other `op` commands time out after 30 seconds by default, configurable with
`OPCHAIN_OP_TIMEOUT_MS`. `op run` has no deadline.
opchain forwards SIGTERM, SIGINT, and SIGHUP to `op` and waits for it to exit.

### Security

opchain reduces accidental exposure. It does not stop a process running as your macOS user.

- By default, token lookup passes the stored token to the delegated `op` process, not your shell or the program it starts. `--pass-token` explicitly exposes it to that program.
- Secret-printing `op` commands are refused by default. `--allow-reveal` requires an interactive terminal and is a speed bump, not a boundary. `opchain <identity> --read --value-fd <fd> op read <ref>` relays one value to an inherited private descriptor instead of stdout: opchain prints nothing itself, captures the child's output privately, and refuses the relay when the descriptor is a TTY, a regular file, or its own stdout or stderr endpoint by number or duplication.
- The `--value-fd` relay runs in opchain's process group. Callers follow one recipe: start opchain with `Setpgid` in its own process group, and send `SIGKILL` to `-pgid` on cancellation and again after `Wait` returns - before waiting for the inherited pipe's EOF - so nothing a read started can outlive it.
- `token set` reads from a hidden prompt or stdin. Storing the token shells out to `/usr/bin/security add-generic-password`, which takes the token on that child's argv while it runs, so a same-user process can see it there.
- The real boundary is the service-account token's scope. opchain does not isolate identities that share one macOS account.

Read [SECURITY.md](SECURITY.md) for the threat model and every rule.

### Other docs

- [docs/reference.md](docs/reference.md) - commands, flags, refusal forms, configuration keys, exit codes
- [SECURITY.md](SECURITY.md) - threat model, trust boundaries, data handling
- [MIGRATION.md](MIGRATION.md) - migrating from opchain v1
- [PACKAGING.md](PACKAGING.md) - build, signing, notarization, release
- [CONTRIBUTING.md](CONTRIBUTING.md) - setup, TDD workflow, security boundaries

## Contributing

Development needs [Bun](https://bun.sh) 1.3 or later.

```bash
git clone https://github.com/dungle-scrubs/opchain.git
cd opchain
bun install --frozen-lockfile
bun test
bun run typecheck
bun run lint
bun run build
codesign --force --sign - dist/opchain dist/oprun
```

The final command ad-hoc signs the binaries for local runs; it does not notarize them.
[CONTRIBUTING.md](CONTRIBUTING.md) covers the test-driven workflow and security boundaries.
[PACKAGING.md](PACKAGING.md) covers local installation and release signing.

## License

[MIT](LICENSE)
