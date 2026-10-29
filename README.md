# SSH Hold Deck

**English** | [简体中文](README.zh-CN.md)

A Node.js web management layer built on top of the open-source [ssh-hold](https://github.com/CherryLover/ssh-hold) tool. SSH Hold Deck adds a browser-based console, SQLite configuration storage, multi-tab web terminals, and JumpServer integration while delegating SSH channel creation and lifecycle management to ssh-hold.

## Features

- Create, edit, connect, disconnect, and delete channels; filter by name, address, status, or authentication method.
- Separate username and host fields; password authentication, private-key paths, and private-key file selection.
- Use an existing connected channel as a jump host by reusing its ControlMaster socket.
- Read lists directly from SQLite; check connection status in the background every 30 seconds or on demand.
- Import `~/.ssh/hold/*/meta` through Reload, updating existing names while retaining saved credentials.
- Multi-tab xterm.js terminals, including multiple shells per channel, resizing, collapsing, and fullscreen.
- Password-protected web access, password changes, logout, and English/Simplified Chinese interface options.
- JumpServer configuration, authorized asset search, account selection, and connection-token authentication.

## Requirements

- Node.js **22.13.0 or later**, including built-in `node:sqlite`.
- npm, an OpenSSH client, and an executable `ssh-hold` on PATH.
- Development currently targets macOS. Linux has not been fully verified; native Windows is outside the current support scope.
- Native build tools may be needed if `node-pty` cannot use a prebuilt binary. On macOS, install Xcode Command Line Tools when necessary.

**Install [ssh-hold](https://github.com/CherryLover/ssh-hold) before installing or running this project.** The CLI is an external dependency and is not bundled here. Follow the [upstream README and installation instructions](https://github.com/CherryLover/ssh-hold#readme), including its authentication helpers and other prerequisites. Confirm that `ssh-hold list` works in the same environment used to start this web service.

Use a compatible version supporting `list`, `status <name>`, `start`, `stop <name>`, and `shell <name>`. The `start` command must support `-n`, `-p`, `-i`, `--password-stdin`, `--insecure`, repeated `-o` arguments, and `SSH_HOLD_DIR`.

## Quick Start

From the cloned project directory:

```sh
node --version
ssh -V
command -v ssh-hold
ssh-hold list
npm ci
npm start
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). On first use, create a web login password of 8–256 characters. This password is separate from SSH credentials.

The service binds only to `127.0.0.1`; use that address to access it. The interface language selector offers Automatic, Simplified Chinese, and English. Automatic follows the browser language. This repository defaults to the English README; use the link above for Chinese documentation.

## Usage

### Import and Refresh

First startup imports CLI metadata and migrates credentials from the previous `.web-vault`, retaining the original file. Lists are read from SQLite without waiting for remote probes.

- **Reload** imports current metadata, updating matching names without duplicates and preserving saved passwords and identity paths. Database records remain when source files disappear.
- **Refresh** checks live connection status without importing configuration.
- CLI metadata does not contain passwords or private-key paths. Imported channels may need editing before their connect button becomes available.
- Background probes update SQLite; an already-open page does not automatically poll the list.

### Channels and Jump Hosts

Enter a username, host, port, and authentication method when adding or editing a channel. Saving attempts a connection. A selected jump channel must already be connected; self-references and dependency cycles are rejected. Disconnecting retains configuration; deleting removes configuration and closes the connection. An expired one-time password cannot authenticate again merely because it was saved.

### Web Terminal

Connected channels can open independent terminal tabs. Closing a tab ends its shell without stopping the SSH master. Collapsing retains sessions; refreshing the browser or restarting the service ends terminal sessions. Up to 24 terminal sessions can run simultaneously. Terminal input/output is not deliberately recorded in the application database or logs, but remote shells and bastion systems may maintain their own history and audit logs.

### JumpServer

Configure an HTTPS API URL, Access Key ID/Secret, organization UUID, and SSH gateway host/port in the JumpServer view. API and SSH ports are independent. Leaving Secret blank while editing retains it only when the URL and Key ID are unchanged.

Choose a JumpServer asset when creating a channel, search authorized assets, and select an eligible account. Every connection obtains a fresh ordinary connection token for KoKo authentication. Channels retain asset/account references rather than temporary tokens. The integration was verified against **JumpServer v4.10.19 CE**. Accounts requiring manual credential entry are excluded; approval, extra authentication, and access restrictions require handling in JumpServer. Referenced JumpServer configurations cannot be deleted.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Local HTTP port |
| `SSH_HOLD_DIR` | `~/.ssh/hold` | CLI metadata and socket directory |
| `SSH_HOLD_WEB_DATA_DIR` | Project `data/` directory | SQLite and uploaded private-key storage |

```sh
PORT=8888 SSH_HOLD_WEB_DATA_DIR="$HOME/.local/share/ssh-hold-deck" npm start
```

## Storage and Security

The database is `data/channels.sqlite`; uploaded keys are stored in `data/keys/`. Database and uploaded key files use mode 0600. Web passwords use salted scrypt hashes. Session cookies are HttpOnly and SameSite=Strict and expire after 12 hours. Terminals require a valid login session and a single-use token valid for 30 seconds.

Connection configuration and JumpServer secrets use AES-256-GCM encryption, but the key is derived from the local username and hostname, **not an independent secret**. This is not a credential vault resistant to local attackers. Status snapshots are unencrypted. Uploaded private keys are plaintext files protected by filesystem permissions. Never commit databases, keys, credentials, sessions, or screenshots containing real infrastructure.

Stop the service before backing up the entire data directory. Moving to another user or host changes the derived encryption key; existing encrypted configuration cannot simply be read there. Key migration and password recovery tools are not currently provided. See [SECURITY.md](SECURITY.md) for protection boundaries and reporting guidance.

## Development and Verification

See [Project Structure](docs/ARCHITECTURE.md) for the directory layout and module responsibilities.

```sh
npm ci
npm test
```

Tests use mocked dependencies and temporary directories rather than real JumpServer credentials. Terminal tests require a working `node-pty` installation.

Main modules: `src/server.js` (HTTP, SQLite, channel operations), `src/auth.js` (login), `src/jump.js` (jump routing), `src/jumpserver.js` (bastion API), `src/terminal-server.js` (PTY/WebSocket), and `public/` (frontend).

## Troubleshooting

| Problem | What to check |
| --- | --- |
| ssh-hold not found | Ensure the service PATH includes the CLI; run `ssh-hold list` in the same environment |
| node:sqlite unavailable | Upgrade to Node.js 22.13.0 or later |
| PTY startup failure | Reinstall with `npm ci`, run `node scripts/setup-pty.js`, and install native build tools if needed |
| Connect button disabled | Edit the channel to provide a username, host, and password or private-key path |
| Jump unavailable | Connect the jump channel first; Reload its metadata if needed |
| Terminal rejected | Use `127.0.0.1`, sign in again, and confirm that the channel is connected |
| Connected but keepalive stopped | The SSH master and extra keepalive process are independent; Refresh to verify current status |

## Upstream Project and Acknowledgments

SSH Hold Deck builds on [CherryLover/ssh-hold](https://github.com/CherryLover/ssh-hold). Thank you to its author and contributors for the SSH channel management foundation.

- **ssh-hold**: the underlying CLI for SSH channel lifecycle and connection reuse. See its repository for installation, CLI usage, and its own license.
- **SSH Hold Deck**: this repository provides the web interface, persistent configuration, and browser terminals around that CLI.

If this project is useful, consider starring and watching both this repository and [ssh-hold](https://github.com/CherryLover/ssh-hold). For upstream maintainers, a reciprocal link to this project as a community web interface would help users discover both tools. This is an independently maintained companion project; a link does not imply upstream endorsement or an official partnership.

## Contributing and License

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and [docs/PUBLISHING.md](docs/PUBLISHING.md) for the release checklist.

**License selection is pending the project owner's decision.** No LICENSE is currently provided, so permission for open-source use, modification, or redistribution has not yet been granted. Add the chosen license before releasing this as open-source software. Third-party dependencies retain their own licenses.
