# Desktop Builds

SSH Hold Deck uses Tauri 2 with a bundled Node.js 24 runtime. End users do not
need Node, npm, Rust or a compiler. The SSH CLI remains a separate dependency;
the existing dashboard can install ssh-hold into the backend user's directory.
An OpenSSH client is required; password authentication also requires sshpass.

## Local macOS Build

Prerequisites: Node 24.22.0, Rust 1.90 or later, and Xcode Command Line Tools.

```sh
npm ci
npm run desktop:prepare
npm run desktop:verify
npm run desktop:build -- --bundles app,dmg -- --locked
```

Outputs are under `src-tauri/target/release/bundle/`. `npm run desktop:dev`
prepares the backend and starts the development application.

Runtime, production dependencies and static assets are prepared in the ignored
`desktop/backend/` directory. Preparation runs on the target OS and architecture;
do not copy macOS native dependencies to Windows/Linux or across architectures.
The preparation script copies the current Node executable, so use the documented
Node version for reproducible local builds. CI pins that version explicitly.

## Windows / WSL2

The native Windows application requires an initialized **WSL2 x64** distribution.
Ubuntu 22.04 or newer is recommended. Launch the distribution once and finish
creating its Linux user before opening the desktop application.

The application uses the default distribution. Set `SSH_HOLD_WSL_DISTRO` before
launching to choose another distribution. It does not install WSL or modify the
default distribution. Missing WSL2 is reported in the startup window.

The Windows build downloads the Linux backend artifact from the Linux job;
it never builds Linux PTY modules on the Windows runner. The Windows job then
runs Tauri/NSIS with the prepared resources. To reproduce this locally, prepare
the backend on Linux x64, preserve it with tar, extract to `desktop/backend` on
Windows, copy `build/icons/default/icon.png` to `desktop/loading/icon.png`, and run:

```sh
npm ci
npm run desktop:build -- --bundles nsis -- --locked
```

On startup, resources are copied to the selected WSL user's
`~/.local/share/ssh-hold-deck/backend/<version>/`. SQLite and uploaded SSH keys
live separately in `~/.local/share/ssh-hold-deck/data/`; backend replacement does
not replace this data. SSH configuration and sockets use the WSL user's `~/.ssh`.

In the Windows desktop build, Agent skill management targets the Windows user's
home directory mounted in WSL (`/mnt/c/Users/...`). It discovers Windows Agent
configuration directories and skill paths, not WSL Agent installations. Standalone
CLI tools that have never created a configuration directory may not be detected.
Displayed paths are the WSL-mounted paths actually used by the backend.

WSL localhost forwarding must be enabled so the Windows window can access the
loopback service. SSH private-key paths refer to Linux paths in the selected WSL
distribution. Uploading a private key through the existing UI stores it in that
backend's data directory. Windows/WSL end-to-end operation still requires a real
Windows validation run; Linux backend tests alone cannot prove WSL integration.

## Lifecycle and Data

On macOS, allow SSH Hold Deck to access the local network when prompted. If a
LAN connection reports `No route to host` while Terminal can reach the same
server, check System Settings > Privacy & Security > Local Network and enable
SSH Hold Deck, then fully quit and reopen the application. The app bundle
includes `NSLocalNetworkUsageDescription`; it cannot override a denied permission.

The desktop service binds only to `127.0.0.1`, initially using a free port.
The window follows backend readiness and permits navigation only to its current
service origin; external HTTP(S) links open in the system browser. Remote pages
have no Tauri capabilities. Existing web authentication remains enabled.

On macOS data lives in
`~/Library/Application Support/com.jacobs256.sshholddeck/data/`.
Logs use the Tauri application log directory (`backend.log`). The packaged app
is read-only. Updating or replacing it does not delete the user data directory.
The desktop database is separate from an existing development checkout's `data/`.

Closing the application closes its web terminals and backend. It does not run
`ssh-hold stop` and does not intentionally terminate SSH master connections.
Service port changes report their new origin to the desktop window supervisor.

## GitHub Release Workflow

Commit the desktop sources, lock files, icons and workflows to the repository.
Do not commit generated backend resources, installer outputs or local data.

1. Set a version with `npm run release:prepare -- 1.0.1`.
2. Run `cargo check --manifest-path src-tauri/Cargo.toml` to update Cargo.lock.
3. Commit and push the version changes to `main`.
4. In Actions > **Desktop Release** > **Run workflow**, select `main` and enter
   `v1.0.1`. The workflow validates the version, creates the missing annotated
   tag and pushes it. An existing tag is reused without moving it.
5. All checks and three platform builds must pass before the workflow creates
   the GitHub Release with generated notes and attaches the two DMGs, Windows
   NSIS EXE and `SHA256SUMS.txt`. An existing Release receives updated assets.

Alternatively, push a matching `v*` tag to trigger the same workflow directly.
Publishing a Release manually remains supported. All build jobs use the exact
commit resolved by the prepare job. Manual runs always publish after successful
builds; there is no separate upload switch. Tags containing a prerelease suffix
must match the complete package version and create a prerelease automatically.
Tags created by the workflow's `GITHUB_TOKEN` do not trigger a second workflow;
the current run performs the builds and publication itself. A failed build may
leave a tag, but does not create a new Release. Rerun with that tag to retry.
For the existing `v1.0.0` tag, run this updated workflow from `main` and enter
`v1.0.0`; the workflow definition comes from `main`, while the packaged code
comes from the existing tag.

Workflows use the repository-provided `GITHUB_TOKEN`; no personal token is needed.
Only the prepare and publish jobs request `contents: write`. Fork PR checks have read-only
permissions. PR/main checks run backend tests and a macOS Rust compile check.

## Signing

Without signing credentials, macOS builds use an **ad-hoc signature** with the
application bundle identifier and sealed Info.plist/resources. This is required
for consistent local-network permission attribution; a linker-only executable
signature can use a different identifier from the permission shown in Settings.
The release workflow verifies the final application signature and identifier.
These are still **test installers without trusted publisher signing**. They
can trigger macOS Gatekeeper or Windows SmartScreen. This implementation does not
claim publicly trusted signing or application auto-updates.

For macOS Developer ID signing/notarization, configure Tauri-supported repository
Secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
The build job binds to the GitHub environment named `release`, so these secrets
can also be stored under Settings > Environments > release > Environment secrets.
Environment secrets override repository secrets with the same names. Any approval
or branch/tag restrictions on that environment apply before build jobs start.
Manual runs default to `apple_signing: false`: the build process removes all
Apple credential environment variables and explicitly uses an ad-hoc signature,
even if signing secrets exist in the repository. Tag pushes and Release events
also use this test mode. To create a Developer ID build, manually run the workflow
from `main` and enable **apple_signing**. Empty Apple variables are removed before
invoking Tauri because an empty `APPLE_CERTIFICATE` can still trigger import.
Provide the complete credential set; signing/notarization errors fail the build.
For Developer ID builds, the workflow signs every embedded Mach-O binary before
Tauri bundles and notarizes the app, including Node and all node-pty `.node`
modules and extensionless `spawn-helper` binaries across bundled architectures.
Each signature requires the configured team, a secure timestamp and hardened
runtime. Node receives the project's runtime entitlements. The signing step
adds its temporary keychain to the user search list and resolves
the imported Developer ID identity to its certificate fingerprint. It restores
the original search list and deletes the temporary keychain on completion or failure.
The runtime manifest
hash is refreshed after signing, then SQLite, PTY and service smoke checks run
again. Signing only the outer application does not cover these resource binaries
and causes Apple notarization to reject the archive.
`APPLE_CERTIFICATE` must contain the Base64-encoded contents of a `.p12` exported
from Keychain Access with its matching private key. A `.cer` download, file path,
certificate name or PEM text is not the required value. On your Mac, copy the
encoded file directly to the clipboard without printing it:

```sh
base64 -i /path/to/Developer-ID-Application.p12 | pbcopy
```

Paste into the repository Actions secret `APPLE_CERTIFICATE`. Set
`APPLE_CERTIFICATE_PASSWORD` to the password chosen when exporting that `.p12`
(not the Apple ID password), and `APPLE_SIGNING_IDENTITY` to its full
`Developer ID Application: Your Name (TEAMID)` identity. `APPLE_PASSWORD` is a
separate Apple app-specific password for notarization. The workflow tests import
and private-key identity in a disposable keychain before compiling; invalid
credentials fail early without exposing certificate data in logs. To build a
test installer without Developer ID signing, remove the signing/notarization
secrets as a complete set rather than leaving an invalid certificate configured.

Windows code signing is not configured yet. Add the selected certificate/signing
service configuration before distributing trusted Windows installers.

## Verification Status

The local Apple Silicon build verifies the bundled runtime hash, SQLite, PTY,
HTTP resources and clean shutdown when the desktop owner closes stdin. The Node
test suite and Rust compile checks also run locally. macOS Intel and Windows
installer generation are configured for GitHub runners and need their first CI
run; no workflow has been pushed or Release published automatically.
