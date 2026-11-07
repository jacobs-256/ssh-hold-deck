# Rust Migration and Service Operations

## Build

Use stable Rust, native build tools, Node.js and npm on the build machine.
Node is needed only for browser assets and development tests.

```sh
npm ci
npm test
cargo build --release --locked --manifest-path backend-rust/Cargo.toml
```

Deploy the release `ssh-hold-backend` and prepared `desktop/backend/public/`.
OpenSSH, the external ssh-hold CLI and its authentication helpers must be on the
service user's PATH. No Node executable is needed on the service machine.

## Migration and rollback

Channel opening time represents creation time and remains fixed across edits and
reconnections. Existing records without `createdAt` are backfilled from saved
opening time or the last status snapshot, falling back to migration time if neither
exists. An original creation time already overwritten by older versions cannot
be recovered accurately from the current database.

1. Export an encrypted portable backup from the old UI and retain the old binary.
2. Stop the old service and copy its entire web data directory, including uploaded
   keys and SQLite sidecars. Keep the original snapshot untouched.
3. Preserve SSH configuration and `SSH_HOLD_DIR` (normally `~/.ssh/hold`).
4. Run Rust under the same OS user and hostname: credential encryption depends on
   that identity. To change host/user, restore the portable backup instead.
5. Set absolute `SSH_HOLD_WEB_DATA_DIR` and `SSH_HOLD_PUBLIC_DIR` paths. Set
   `PORT=8787` and PATH for ssh-hold/helpers. The service listens only on localhost.
6. Verify login, saved channels, credential decryption, JumpServer, a terminal
   session and backup export before replacing the old installation.

The default web data location is `data/` under the working directory. Do not run
old and new processes against the same database. To roll back, stop Rust, retain
its current data for diagnosis, then restore the old executable, assets and
complete pre-migration snapshot together. Changes after that snapshot are lost.

## macOS login service

Install outside protected Documents/Desktop directories so launchd can read the
files. Suggested layout: `~/.local/libexec/ssh-hold-deck/ssh-hold-backend` and
`~/.local/share/ssh-hold-deck/service/{public,data}`. Create these directories,
copy the binary/assets/data, then create
`~/Library/LaunchAgents/com.utec.ssh-hold-deck.plist` from this template.
Replace every `/Users/USERNAME`; adapt PATH to your CLI/helper installation.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.utec.ssh-hold-deck</string>
  <key>ProgramArguments</key><array><string>/Users/USERNAME/.local/libexec/ssh-hold-deck/ssh-hold-backend</string></array>
  <key>WorkingDirectory</key><string>/Users/USERNAME/.local/share/ssh-hold-deck/service</string>
  <key>EnvironmentVariables</key><dict>
    <key>PORT</key><string>8787</string>
    <key>PATH</key><string>/Users/USERNAME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>SSH_HOLD_WEB_DATA_DIR</key><string>/Users/USERNAME/.local/share/ssh-hold-deck/service/data</string>
    <key>SSH_HOLD_PUBLIC_DIR</key><string>/Users/USERNAME/.local/share/ssh-hold-deck/service/public</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/USERNAME/.local/share/ssh-hold-deck/service/stdout.log</string>
  <key>StandardErrorPath</key><string>/Users/USERNAME/.local/share/ssh-hold-deck/service/stderr.log</string>
</dict></plist>
```

```sh
plutil -lint ~/Library/LaunchAgents/com.utec.ssh-hold-deck.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.utec.ssh-hold-deck.plist
launchctl print "gui/$(id -u)/com.utec.ssh-hold-deck"
```

A LaunchAgent starts when the user logs in after reboot. Stop before an upgrade:
`launchctl bootout "gui/$(id -u)/com.utec.ssh-hold-deck"`. Replace the executable
and prepared assets, then bootstrap again. Check logs and `/api/auth/status`,
then verify login and channel access manually.

## Releases and generated files

`npm run release:prepare -- 1.2.0` (substitute the intended version) updates npm,
Tauri, Cargo manifests/locks and UI labels. Verify with
`RELEASE_TAG=v1.2.0 node scripts/check-release-version.mjs`. Rebuild resources and
installers after a version change. Verify macOS using the built `.app` resource
directory; Linux verification executes the packaged backend.

`backend-rust/target`, `src-tauri/target`, `node_modules` and `desktop/backend`
are generated. Preserve wanted installers from `src-tauri/target` before cleaning
caches. Regenerate with npm/cargo and desktop preparation commands.
Keep format compatibility tests; legacy test scope is documented in
[tests/compat/README.md](../tests/compat/README.md).
