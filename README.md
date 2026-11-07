# SSH Hold Deck

**English** | [简体中文](README.zh-CN.md)

A Rust web management service built on top of the open-source [ssh-hold](https://github.com/CherryLover/ssh-hold) tool. SSH Hold Deck adds a browser-based console, SQLite configuration storage, multi-tab web terminals, and JumpServer integration while delegating SSH channel creation and lifecycle management to ssh-hold. The application runs without Node.js.

## Features

- Create, edit, connect, disconnect, and delete channels; filter by name, address, status, or authentication method.
- Separate username and host fields; password authentication, private-key paths, and private-key file selection.
- Use an existing connected channel as a jump host by reusing its ControlMaster socket.
- Read lists directly from SQLite; configure background status checks under Settings → Refresh Settings (5–3600 seconds, default 30). Changes are pushed to open pages through SSE and update affected rows automatically; manual refresh checks immediately.
- Paginated channels (10/20/50/100 rows, default 20), newest first, with independently scrolling rows, a fixed table header, and pinned actions.
- Use the toolbar import button to import `~/.ssh/hold/*/meta`, updating existing names while retaining saved credentials.
- Multi-tab xterm.js terminals, including multiple shells per channel, resizing, collapsing, and fullscreen.
- Password-protected web access, password changes, logout, and English/Simplified Chinese interface options.
- JumpServer configuration, authorized asset search, account selection, and connection-token authentication.

## Requirements

For the macOS desktop application and Windows/WSL2 installer build, see
[Desktop Builds](docs/DESKTOP.md). GitHub Release publication triggers the desktop
build workflow. Native Windows SSH execution is not used; the Windows backend
runs inside an initialized WSL2 distribution.

- Rust stable and native build tools to compile the backend; SQLite is bundled.
- Node.js 24 and npm for preparing browser assets and running development tests only.
- An OpenSSH client and an executable `ssh-hold` on PATH.
- Development currently targets macOS. Linux has not been fully verified; native Windows is outside the current support scope.

**Install [ssh-hold](https://github.com/CherryLover/ssh-hold) before installing or running this project.** The CLI is an external dependency and is not bundled here. Follow the [upstream README and installation instructions](https://github.com/CherryLover/ssh-hold#readme), including its authentication helpers and other prerequisites. Confirm that `ssh-hold list` works in the same environment used to start this web service.

Use a compatible version supporting `list`, `status <name>`, `start`, `stop <name>`, and `shell <name>`. The `start` command must support `-n`, `-p`, `-i`, `--password-stdin`, `--insecure`, repeated `-o` arguments, and `SSH_HOLD_DIR`.

## Quick Start

For existing installations, see [Rust migration and service operations](docs/MIGRATION.md).

From the cloned project directory:

```sh
cargo --version
ssh -V
command -v ssh-hold
ssh-hold list
npm ci
npm run web:prepare
npm start
```

Open [http://localhost:8787](http://localhost:8787). On first use, create a web login password of 8–256 characters. This password is separate from SSH credentials.

The service listens only on localhost. Open `http://localhost:8787` on this machine; other computers cannot connect. HTTP does not encrypt passwords or terminal traffic; use the service locally. The interface language selector offers Automatic, Simplified Chinese, and English. Automatic follows the browser language. This repository defaults to the English README; use the link above for Chinese documentation.

## Usage

### Import and Refresh

First startup imports CLI metadata and migrates credentials from the previous `.web-vault`, retaining the original file. Lists are read from SQLite without waiting for remote probes.

- **Import** uses the toolbar button next to Refresh to import current metadata, updating matching names without duplicates and preserving saved passwords and identity paths. Database records remain when source files disappear.
- **Refresh** checks live connection status without importing configuration.
- CLI metadata does not contain passwords or private-key paths. Imported channels may need editing before their connect button becomes available.
- Background probes update SQLite; an already-open page does not automatically poll the list.

### Channels and Jump Hosts

Enter a username, host, port, and authentication method when adding or editing a channel. Saving attempts a connection. A selected jump channel must already be connected; self-references and dependency cycles are rejected. Disconnecting retains configuration; deleting removes configuration and closes the connection. An expired one-time password cannot authenticate again merely because it was saved.

### Web Terminal

Connected channels can open independent terminal tabs. Closing a tab ends its shell without stopping the SSH master. Collapsing retains sessions; refreshing the browser or restarting the service ends terminal sessions. Up to 24 terminal sessions can run simultaneously. Terminal input/output is not deliberately recorded in the application database or logs, but remote shells and bastion systems may maintain their own history and audit logs.

### JumpServer

Configure an HTTPS API URL, Access Key ID/Secret, organization UUID, and SSH gateway host/port in the JumpServer view. API and SSH ports are independent. Leaving Secret blank while editing retains it only when the URL and Key ID are unchanged.

The JumpServer switch under Integrations enables or disables the integration. When off, the connection source field is hidden when adding or editing channels; already-connected JumpServer channels remain usable but must be re-enabled before editing. Turning it on without a saved configuration opens the configuration dialog immediately. While disabled, disconnected JumpServer channels are shown disabled, cannot connect, open a terminal, or be edited, but can still be deleted; connected channels remain usable and enter this state after disconnecting. The state is stored in the local configuration and included in configuration backups.

Choose a JumpServer asset when creating a channel, search authorized assets, and select an eligible account. Every connection obtains a fresh ordinary connection token for KoKo authentication. Channels retain asset/account references rather than temporary tokens. The integration was verified against **JumpServer v4.10.19 CE**. Accounts requiring manual credential entry are excluded; approval, extra authentication, and access restrictions require handling in JumpServer. Referenced JumpServer configurations cannot be deleted.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Local HTTP port |
| `SSH_HOLD_DIR` | `~/.ssh/hold` | CLI metadata and socket directory |
| `SSH_HOLD_WEB_DATA_DIR` | Project `data/` directory | SQLite and uploaded private-key storage |
| `SSH_HOLD_PUBLIC_DIR` | `desktop/backend/public`, falling back to `public` | Prepared browser resources |

```sh
PORT=8888 SSH_HOLD_WEB_DATA_DIR="$HOME/.local/share/ssh-hold-deck" npm start
```

## Storage and Security

When an SSH host key changes, the connection dialog shows the previous and currently offered fingerprints. Verify the new fingerprint through the server console or administrator before confirming. Deck backs up `~/.ssh/known_hosts`, replaces only the selected host entry, and retries the connection with normal host verification. Confirmation expires after two minutes. Unsupported or unverifiable conflicts retain the original SSH error.

The database is `data/channels.sqlite`; uploaded keys are stored in `data/keys/`. Database and uploaded key files use mode 0600. Web passwords use salted scrypt hashes. Session cookies are HttpOnly and SameSite=Strict and expire after 12 hours. Terminals require a valid login session and a single-use token valid for 30 seconds.

Connection configuration and JumpServer secrets use AES-256-GCM encryption, but the key is derived from the local username and hostname, **not an independent secret**. This is not a credential vault resistant to local attackers. Status snapshots are unencrypted. Uploaded private keys are plaintext files protected by filesystem permissions. Never commit databases, keys, credentials, sessions, or screenshots containing real infrastructure.

Stop the service before backing up the entire data directory. Moving to another user or host changes the derived encryption key; existing encrypted configuration cannot simply be read there. Key migration and password recovery tools are not currently provided. See [SECURITY.md](SECURITY.md) for protection boundaries and reporting guidance.

## Development and Verification

See [Project Structure](docs/ARCHITECTURE.md) for the directory layout and module responsibilities.

```sh
npm ci
npm test
```

Tests launch the Rust backend with mocked SSH commands and temporary directories. Compatibility tests verify existing JavaScript credential and backup formats without real JumpServer credentials.

Main modules are under `backend-rust/src/`: `lib.rs` (HTTP and authentication), `store.rs` (SQLite), `channels.rs` (SSH operations), `jumpserver.rs` (bastion API), and `terminal.rs` (PTY/WebSocket). `public/` contains the frontend. After compilation and asset preparation, run `./backend-rust/target/release/ssh-hold-backend` directly, without Node or npm. Set `SSH_HOLD_PUBLIC_DIR` when deploying the prepared `desktop/backend/public` directory elsewhere. Existing SQLite data, password hashes and encrypted credentials are reused on the same user and host.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| ssh-hold not found | Ensure the service PATH includes the CLI; run `ssh-hold list` in the same environment |
| Browser resources missing | Run `npm run web:prepare` or point `SSH_HOLD_PUBLIC_DIR` to prepared resources |
| PTY startup failure | Check that ssh-hold is executable and the operating system permits PTY allocation |
| Connect button disabled | Edit the channel to provide a username, host, and password or private-key path |
| Jump unavailable | Connect the jump channel first; use the import button to import its metadata if needed |
| Terminal rejected | Use localhost, sign in again, and confirm that the channel is connected |
| Connected but keepalive stopped | The SSH master and extra keepalive process are independent; Refresh to verify current status |

## Configuration Backup and Restore

Open **Settings → System → Configuration backup**, enter a backup password of at least 8 characters, and select **Export settings** to download an encrypted JSON file. The backup includes channels, connection passwords and private keys, JumpServer credentials, login configuration, service settings, and the current browser's appearance preferences. Desktop backups also include close behavior and tray preferences. Keep the file and password safe; the password cannot be recovered.

To restore, enter the backup password, select **Import settings**, choose the file, and confirm replacement. Validated settings are restored in a database transaction, private keys are saved with restricted local permissions, and existing logins are revoked. Sign in using the backed-up login password. Port settings take effect on the next application start. Running SSH/terminal sessions, system SSH configuration, and externally installed software are not included; importing does not automatically connect channels.

## Upstream Project and Acknowledgments

SSH Hold Deck builds on [CherryLover/ssh-hold](https://github.com/CherryLover/ssh-hold). Thank you to its author and contributors for the SSH channel management foundation.

- **ssh-hold**: the underlying CLI for SSH channel lifecycle and connection reuse. See its repository for installation, CLI usage, and its own license.
- **SSH Hold Deck**: this repository provides the web interface, persistent configuration, and browser terminals around that CLI.

If this project is useful, consider starring and watching both this repository and [ssh-hold](https://github.com/CherryLover/ssh-hold). For upstream maintainers, a reciprocal link to this project as a community web interface would help users discover both tools. This is an independently maintained companion project; a link does not imply upstream endorsement or an official partnership.

## Contributing and License

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and [docs/PUBLISHING.md](docs/PUBLISHING.md) for the release checklist.

**License selection is pending the project owner's decision.** No LICENSE is currently provided, so permission for open-source use, modification, or redistribution has not yet been granted. Add the chosen license before releasing this as open-source software. Third-party dependencies retain their own licenses.
