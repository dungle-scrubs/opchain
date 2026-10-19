# opchain reference

Lookup reference for every opchain command, flag, refusal form, and configuration key. The threat model lives in [SECURITY.md](../SECURITY.md).

## opchain commands

| Command | Description |
| --- | --- |
| `opchain identity list` | List configured identities from `config.toml`. |
| `opchain token set --identity <name> --profile <name> [--stdin]` | Store a token in the macOS Keychain from a hidden prompt, or from stdin with `--stdin`. |
| `opchain token remove --identity <name> --profile <name> [--yes]` | Remove a stored token. `--yes` skips the interactive confirmation. |
| `opchain <identity> [flags] op <args...>` | Run one 1Password CLI command for the selected identity. |
| `opchain <identity> item-structure <item> [--vault <vault>]` | Print an item's field structure without values. |
| `opchain <identity> secrets list <file>` | List every `op://` reference in a `.env.op` file. |
| `opchain <identity> secrets check <file>` | Validate that every reference in one file resolves. |
| `opchain <identity> secrets inspect <op://...>` | Print metadata for one reference: vault, item, field labels, `expires_at`. |
| `opchain <identity> secrets validate [path] [--project-wide]` | Validate a file or directory, defaulting to the current directory. `--project-wide` selects `projects_dir` instead and cannot be combined with a path. |
| `opchain <identity> expires add <op://...>` | Track one expiring record. |
| `opchain <identity> expires remove <vault-uuid>/<item-uuid>` | Remove one tracked record. |
| `opchain <identity> expires list` | List tracked records by vault and item UUID. |
| `opchain <identity> expires scan` | Re-read every tracked record and report its status. |
| `opchain doctor` | Report binary path, config path, identities, profiles, and vault guidance. |
| `opchain migrate-v1 [--dry-run]` | Plan or apply migration from opchain v1. See [MIGRATION.md](../MIGRATION.md). |

Global flags, accepted before the command: `--debug` and `--debug-format text|json` (default `text`) emit redacted telemetry to stderr, and `-h, --help` prints help. Debug output never contains token values, resolved secret values, raw environment payloads, or child stdout and stderr. See [PACKAGING.md](../PACKAGING.md) for the event families.

## op-execution flags

These flags apply only to `op` commands and must appear before the `op` token. Other commands reject them.

| Flag | Effect |
| --- | --- |
| `--read` | Force the `read` profile. |
| `--write` | Force the `write` profile. |
| `--profile <name>` | Force a named profile. |
| `--allow-env-token` | Let `OPCHAIN_TOKEN_OVERRIDE` supply the token for this invocation. |
| `--allow-reveal` | Run an `op` command that prints secret values. Interactive terminal only. |
| `--pass-token` | Let an `op run` program see the service-account token. |
| `--value-fd <fd>` | Relay `op read`'s value to inherited descriptor `<fd>` instead of stdout. Requires `--read`; the relay grammar and descriptor checks apply. |

## Profile resolution

Only the exact `op vault list` command shape may run without explicit profile
selection. Other shapes fail before token resolution unless `--profile`,
`--read`, or `--write` is present.

For an accepted command, the profile resolves in this order:

1. `--profile <name>` selects that configured profile, or fails if it is absent.
2. `--read` or `--write` selects the configured profile with that name.
3. A single-profile identity selects its only profile, regardless of mode.
4. An identity in `auto` mode selects its `read` profile.

An identity with multiple profiles in `default` mode requires explicit selection.
A profile's name does not grant permissions; the service-account token's scope
determines which operations 1Password permits.

## Reveal guard

opchain inspects the `op` command line before resolving a token, loading config, or spawning anything. A refused command exits 1 with the safe alternative named in the message. Argument values are never echoed.

| Form | Command shape | Safe alternative |
| --- | --- | --- |
| `read-stdout` | `op read` without a valid out-file | `op run`, or `op read -o <file>` |
| `inject-stdout` | `op inject` without a valid out-file | `op inject -o <file>`, or `op run` |
| `document-get-stdout` | `op document get` without a valid out-file | `op document get <doc> --out-file <file>` |
| `item-get-reveal` | `op item get` with `--reveal`, `--otp`, or `--format json` | `opchain <identity> item-structure` |
| `item-write-reveal` | `op item create` or `op item edit` with `--reveal` or `--format json` | Drop `--reveal` and `--format json`; the default output conceals sensitive fields |
| `run-no-masking` | `op run --no-masking` | Drop `--no-masking`; masked `op run` still passes the values to the program |
| `signin` | `op signin` in every form, including `--raw` and `-f` | opchain injects a service-account token; `op signin` is not needed |
| `token-create` | `op service-account create`, `op connect token create`, `op events-api create` | Each prints a new token. Run from an interactive terminal with `--allow-reveal` |
| `unclassifiable-order` | An unknown dash token while the command path is still a prefix of a guarded form, or a `--` separator right after a possible value flag | Put `op` flags after the subcommand, for example `op item get <item> --vault <vault>` |

A valid out-file is `-o` or `--out-file` with a non-empty value that is not `-` and does not resolve under `/dev/`. Aliases `items`, `documents`, `sa`, and `connect tokens` are canonicalized before matching.

The only override is `--allow-reveal`, accepted before the identity or between the identity and `op`. It requires an interactive stdin (a TTY); stdout may stay piped, for example `| pbcopy`.

Known limits, all within the same-user threat model in [SECURITY.md](../SECURITY.md):

- The TTY gate is a speed bump, not a boundary. A same-user process can fake a pty with `script` or `expect`.
- A value transformed inside masked `op run` (base64, a substring) still prints. opchain cannot detect transformations.
- A child of `op run --pass-token` that calls `op` itself, and bare `op` invoked without opchain, bypass the guard entirely.
- An out-file path that is a symlink to a device is not detected. Only lexical `/dev/` prefixes are checked.
- Command aliases are matched from a fixed list, so an alias a future `op` release adds may not be covered.

## Value relay (`--value-fd`)

`opchain <identity> --read --value-fd <fd> op read <op://reference>` is the
unattended read route: the value is written byte-exact to inherited descriptor
`<fd>`, and opchain's own stdout and stderr stay empty. The descriptor must be
a pipe or socket that is not descriptor 0, 1, or 2 and does not name the same
endpoint as opchain's stdout or stderr (a duplicated pipe is refused like
stdout itself). opchain never closes the descriptor; the caller owns it.

Relay mode validates independently of the reveal guard, before token
resolution, config load, or child spawn. The op argv must be exactly `read`
plus one `op://` reference: every out-file spelling, global flag, `--`
separator, unknown dash token, extra or missing reference, second command
word, and non-read path are refused as `opchain: relay: grammar`. `--value-fd`
with `--allow-reveal` or `--pass-token` is also refused as `grammar`.

One overall deadline - the `OPCHAIN_OP_TIMEOUT_MS` value - covers token
resolution, the `op` child, and the descriptor write. Acceptance is a child
exit 0 inside the deadline; a failed or timed-out child writes nothing to the
descriptor. A stalled peer or a failed write stops the relay with `write-failed`
or `deadline`; a prefix may already have been delivered. Relay failures exit 1
and print exactly one stable identifier on stderr:

| Identifier | Meaning |
| --- | --- |
| `opchain: relay: grammar` | Out-of-grammar op argv, out-file spelling, `--allow-reveal` or `--pass-token` mix, non-read path |
| `opchain: relay: descriptor-not-open` | The fd number does not parse or the descriptor is not open |
| `opchain: relay: descriptor-standard` | The fd is 0, 1, or 2 |
| `opchain: relay: descriptor-not-pipe` | The fd is not a pipe or socket (TTY, regular file, directory, device) |
| `opchain: relay: descriptor-alias` | The fd names the same endpoint as stdout or stderr |
| `opchain: relay: spawn` | The `op` child could not start |
| `opchain: relay: config` | The identity's config or profile could not be resolved |
| `opchain: relay: token` | The identity's token could not be resolved |
| `opchain: relay: child-timeout` | The `op` child hit the deadline |
| `opchain: relay: child-failed:<class>` | The child exited nonzero; `<class>` is `denied`, `notfound`, `unreachable`, or `unknown` |
| `opchain: relay: write-failed` | The descriptor write failed after a possible prefix |
| `opchain: relay: deadline` | The overall relay deadline expired |

The identifier line carries no appended detail; under `--debug`, metadata such
as the descriptor number and deadline appears on separately prefixed
`opchain debug: relay:` lines that never match the identifier pattern. The
classifier orders permission wording before existence wording before transport
wording, with `unknown` as the fallback; the child's diagnostics are captured
privately and never printed. Telemetry (`op.reveal.fd_relay`) records the
identity, the form id, a byte count, and one outcome from a fixed enum - never
content. Known limits: a same-user process can deliberately relay and read a
value, and the descriptor checks cannot bind what the receiving peer does with
the bytes afterward.

## Environment handling

By default, the service-account token authenticates `op`, while the program
receives only the item values it needs:

- The service-account token is injected as `OP_SERVICE_ACCOUNT_TOKEN` into the delegated `op` process. Provider children receive a sanitized environment without ambient token values.
- The delegated `op run` receives the caller's environment minus `OP_` and `OPCHAIN_` variables, except the fixture controls `OPCHAIN_TEST_OP_*`. This prevents ambient 1Password settings from changing its authentication. Its program starts through `/usr/bin/env -u OP_SERVICE_ACCOUNT_TOKEN OP_BIOMETRIC_UNLOCK_ENABLED=false`, unless `--pass-token` is given. The program receives resolved values from its env file but does not inherit the service token by default. `--pass-token` removes this protection for programs that call `op` themselves.

An ambient `OP_SERVICE_ACCOUNT_TOKEN` in the parent environment is stripped from every `op` child and replaced with the Keychain-resolved token. Ambient env tokens participate in resolution only when `--allow-env-token` is passed and `OPCHAIN_TOKEN_OVERRIDE` is set.

## oprun

`oprun <command>` runs `<command>` through `opchain <identity> --profile <profile> op run --env-file <file> -- <command>`.

| Variable | Default | Effect |
| --- | --- | --- |
| `OPRUN_IDENTITY` | `primary` | Identity name. |
| `OPRUN_PROFILE` | `read` | Profile name. |
| `OPRUN_ENV_FILE` | `.env.op` | Env template path. |
| `OPRUN_PASS_TOKEN` | unset | Set to `1` to pass the service-account token to the program. |
| `OPCHAIN_BIN` | sibling `opchain`, else `PATH` | opchain executable `oprun` delegates to. |

## Configuration

Read from `~/.config/opchain/config.toml`.

| Key | Requirement | Meaning |
| --- | --- | --- |
| `defaults.projects_dir` | required, non-empty string, `~` expanded | Root for `secrets validate --project-wide`. |
| `defaults.expires_threshold_days` | required, positive integer | Days ahead that `expires scan` reports an item `expiring`. |
| `identities.<name>.default_mode` | required, `auto` or `default` | `auto` selects `read` for `op vault list` when multiple profiles exist. A single profile resolves automatically in either mode for that command. |
| `identities.<name>.vaults` | required, non-empty string array | Records intent. `doctor` displays it; opchain does not enforce it. |
| `identities.<name>.profiles.<name>.keychain_account` | required, non-empty string | macOS Keychain account name for that profile's token, under Keychain service name `opchain`. |

At least one identity and one profile per identity are required. Identity and profile names may contain only letters, numbers, underscores, and hyphens.
The [installation example](../README.md#install) defines a read profile.
An additional write profile has its own Keychain account and service-account token:

```toml
[identities.primary.profiles.write]
keychain_account = "opchain:primary:write"
```

Its token is stored with `opchain token set --identity primary --profile write`.
An invocation such as `opchain primary --write op item edit Stripe --vault Services`
then selects that profile explicitly.

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `OPCHAIN_OP_TIMEOUT_MS` | `30000` | Deadline for a delegated `op` command. `op run` has no deadline. Also the overall deadline for the `--value-fd` relay, covering token resolution, the child, and the descriptor write. On timeout opchain exits 1 with a timeout message. |
| `OPCHAIN_TOKEN_OVERRIDE` | unset | Token source, used only when `--allow-env-token` is passed. |
| `OPCHAIN_CONFIG_PATH` | `~/.config/opchain/config.toml` | Config path override. |
| `OPCHAIN_OP_PATH` | `op` | `op` executable path override. |
| `OPCHAIN_SECURITY_PATH` | `/usr/bin/security` | `security` executable path override. |
| `OPCHAIN_LEGACY_CONFIG_PATH`, `OPCHAIN_LEGACY_EXPIRES_PATH` | v1 paths | Legacy input paths for `migrate-v1`. |

The path overrides exist for the test suite and for pointing opchain at instrumented binaries.

## Exit codes

- A delegated `op` command's exit status passes through unchanged.
- An `op` process ended by a signal exits 128 plus the signal number.
- opchain's own refusals and errors exit 1. This includes reveal refusals, unknown identities or profiles, config errors, and the `op` timeout. In `--value-fd` relay mode every failure exits 1 with one `opchain: relay: ...` identifier on stderr; the child's own exit code is not propagated.
- `op run` needs `--` before the program. Without it, opchain exits 1 and explains how to pass it, unless `--pass-token` is given.

While `op` runs, opchain forwards SIGTERM, SIGINT, and SIGHUP to the `op` process and waits for it to end, so Ctrl+C stops the delegated command instead of orphaning it.

## Expiry tracking

State is stored per identity in `~/.config/opchain/state/expires/<identity>.json`. Records are keyed by vault UUID and item UUID; vault and item titles are display metadata only. State writes go through a same-directory temporary file, a rename into place, and a lock for concurrent writers.

`expires add` resolves the reference with `op item get --format json` and fails when the item has no top-level `expires_at` date: an expiry kept in a custom date field cannot be tracked. `expires scan` reports each record as `healthy`, `expiring`, `expired`, or `missing` against `expires_threshold_days`. `missing` means the item lookup failed; it does not establish that the item was deleted. Nothing scans automatically: there are no notifications, no background jobs, and no rotation.

## Security notes

The full threat model is [SECURITY.md](../SECURITY.md). In short:

- opchain reduces accidental leakage. It does not defend against a malicious process running as the same macOS user, and it does not isolate identities that share one macOS account.
- The real trust boundary is the 1Password service-account token scope. The `vaults` list in config records intent; scoping tokens is up to you.
- `token set` reads the token from a hidden TTY prompt or stdin, never from opchain's own argv. Internally it stores the token through `/usr/bin/security add-generic-password`, which has no stdin mode for the password, so the token is passed on that child's argv for the brief lifetime of that process and is visible to same-user processes during that time. This is within the documented threat model.
