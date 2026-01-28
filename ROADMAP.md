# Roadmap

## Pending

### Create dedicated Homebrew tap repo

Create `dungle-scrubs/homebrew-opchain` on GitHub to follow the standard Homebrew tap naming convention.

**Steps:**

1. Create public repo `homebrew-opchain` at https://github.com/new (no template, no README init)
2. Push the prepared tap content:
   ```bash
   cd /tmp/homebrew-opchain && git push -u origin main
   ```
3. Add a `TAP_GITHUB_TOKEN` repo secret to `dungle-scrubs/opchain` — a PAT with `contents: write` scope on the tap repo, used by the release workflow to push formula updates

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
