# Roadmap

## Pending

### Weekly expiry check via launchd

Create a macOS `launchd` plist that runs `opchain expires` weekly and sends a notification for EXPIRING/EXPIRED items.

**Steps:**

1. Add a `com.opchain.expires-check.plist` template to the repo
2. Schedule weekly via `StartCalendarInterval` (e.g., every Monday at 9 AM)
3. Run `opchain expires` and pipe output to a notification (e.g., `osascript` or `terminal-notifier`)
4. Add `opchain schedule install` / `opchain schedule uninstall` subcommands to manage the plist in `~/Library/LaunchAgents/`

### One vault per app

Enforce a convention of one 1Password vault per application/project. opchain would:

1. Auto-detect the project name (from directory name, `package.json`, or config)
2. Map `op://` references to a vault matching the project name
3. Optionally scaffold a new vault with `opchain vault init <project-name>`
4. Validate that `.env.op` references only use the project's vault (or a shared vault)
