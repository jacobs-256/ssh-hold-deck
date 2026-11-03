# Desktop Builds

SSH Hold Deck uses Tauri 2 and a Rust backend. End users do not
need Node, npm, Rust or a compiler. The SSH CLI remains a separate dependency;
the existing dashboard can install ssh-hold into the backend user's directory.
An OpenSSH client is required; password authentication also requires sshpass.

## Local macOS Build

Prerequisites: Node 24.22.0, Rust 1.90 or later, and Xcode Command Line Tools.

```sh
npm ci
npm run desktop:prepare
npm run desktop:build -- --bundles app,dmg -- --locked
npm run desktop:verify -- 'src-tauri/target/release/bundle/macos/SSH Hold Deck.app/Contents/Resources/backend'
```

Outputs are under `src-tauri/target/release/bundle/`. `npm run desktop:dev`
prepares the backend and starts the development application.

Static assets, browser vendor bundles, licenses and the resource manifest are
prepared in the ignored `desktop/backend/` directory. macOS runs the same desktop
executable in `--backend` child mode; no separate backend binary is bundled.
For Windows, prepare on Linux and include the Linux Rust executable for WSL2.
No Node runtime, node_modules or node-pty binaries are included. Node is used
only for build tooling and development tests. Run `npm run desktop:verify`
against the built macOS app resource directory (or prepared Linux bundle) to
check authentication, SQLite, resources and shutdown.

## macOS Background Service

For a macOS LaunchAgent, deploy the release executable, prepared public resources
and writable data outside protected development folders such as Documents.
Use absolute `SSH_HOLD_PUBLIC_DIR` and `SSH_HOLD_WEB_DATA_DIR` paths and a working
directory under the user's application data directory. Preserve a SQLite backup
before relocating data, and update uploaded private-key paths when relocating
the keys directory. The development checkout can link its ignored `data` path
to the deployed data directory. Rebuilds must also update the deployed executable
and public resources before restarting the LaunchAgent.

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
configuration directories and skill paths, ignoring WSL environment overrides
and Linux PATH executables. Standalone
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
service origin; external HTTP(S) links open in the system browser. The main
window's loopback origin has explicit permission for `desktop_settings` and
`desktop_save_backup`; both commands also verify the current backend port in
Rust. External pages have no Tauri capabilities. Existing web authentication
remains enabled. Keep these commands in the build-time app manifest and the
`desktop-settings` capability: an empty permission list prevents desktop settings
from loading in packaged applications.

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
   NSIS EXE, signed update archives, `latest.json` and `SHA256SUMS.txt`. An existing
   Release receives updated assets. Updater signing setup below is required.

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
claim publicly trusted publisher signing. Updater signatures are configured
separately as described below.

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
For Developer ID builds, Tauri signs and notarizes the Rust application.
The backend is part of that executable; browser resources contain no native
Node modules or runtime binaries requiring a separate signing pass. JIT and
unsigned executable memory entitlements are no longer required.
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

## Online Updates via GitHub Releases

Desktop settings include a software update row with manual checks, release notes,
download progress, verified-download status and an explicit install/restart button.
An automatic check runs after login at most once per successful check per day.
Installation asks the user to save work because web terminals and the backend
will close. SSH master connections are not intentionally stopped. The updater
uses the same backend-origin validation as other desktop commands; the web app
does not expose an HTTP update endpoint or direct updater plugin permissions.

The stable endpoint is:
`https://github.com/jacobs-256/ssh-hold-deck/releases/latest/download/latest.json`.
GitHub's latest endpoint excludes prereleases. A build without an updater public
key offers manual download and disables online update actions. Existing versions
without this feature must be upgraded manually once.

### One-time Signing Setup

Generate an updater key pair outside the checkout and back up the private key:

```sh
npx tauri signer generate -w "$HOME/.ssh/ssh-hold-deck-updater.key"
```

Configure the GitHub repository (or the `release` environment used by build jobs):

| Type | Name | Value |
| --- | --- | --- |
| Actions variable | `TAURI_UPDATER_PUBLIC_KEY` | Complete contents of the generated `.pub` file |
| Actions secret | `TAURI_SIGNING_PRIVATE_KEY` | Complete contents of the generated private key file |
| Actions secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password used when generating the key, if any |

The public key is embedded at Rust compile time. For a local signed build, export
these three environment variables before `npm run desktop:build`. Keep using the
same public key in both the CLI configuration and the compiled Rust updater;
the build wrapper supplies this automatically. Without a public key, local
builds skip updater artifacts and remain installable manually. Keep using the
same key pair across releases; replacing the public key breaks updates from
installed clients that trust the previous key. Updater signing is independent of
Apple Developer ID / notarization and Windows publisher signing.

Release builds without either key publish standalone installers and checksums,
without an online update manifest. Configuring only one key fails validation;
online updates require both the public key and private key. Tauri creates signed
`.app.tar.gz` macOS updates and signed Windows NSIS installers. Collection records
the actual artifact name and signature for each architecture. Publication checks
all three artifacts, creates `latest.json` with release notes, uploads packages
before the manifest, and publishes a new draft only after all uploads succeed.
Existing published releases receive assets and the manifest last; avoid changing
artifacts of a version already installed by users. Publish a new version instead.

Configuration changes, the updater source and scripts must be committed before
creating the release tag. An old tag still builds its old sources and cannot gain
the updater from a newer workflow alone. After setup, publish a new version,
install it manually, then publish a higher version to verify the complete update
flow on macOS and Windows. GitHub connectivity errors retain the manual-download
link and allow retrying. Database and key files stay in the separate data folder.

## Verification Status

The local Apple Silicon checks verify SQLite, Rust PTY/WebSocket behavior,
HTTP resources and clean shutdown when the desktop owner closes stdin. Rust
unit tests and the development HTTP test suite also run locally. macOS Intel and Windows
installer generation are configured in the committed GitHub workflows. Confirm
actual CI results and test on real Windows/WSL before declaring those platforms
verified; local macOS checks do not establish Windows compatibility.
