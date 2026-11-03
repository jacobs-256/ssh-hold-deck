# Project Structure

The backend is Rust. Browser JavaScript and npm build/test tooling remain; no
Node executable or Node modules are loaded by the running application.

| Path | Responsibility |
| --- | --- |
| `backend-rust/src/lib.rs` | Axum HTTP routes, sessions, origins, SSE, listener lifecycle |
| `backend-rust/src/store.rs` | Bundled SQLite, encrypted configuration, session persistence |
| `backend-rust/src/crypto.rs` | Node-compatible AES-GCM and scrypt formats |
| `backend-rust/src/channels.rs` | CLI operations, jump routing, platform probes |
| `backend-rust/src/jumpserver.rs` | HTTPS, HMAC signing, permissions and temporary tokens |
| `backend-rust/src/terminal.rs` | PTY, WebSocket grants and shell cleanup |
| `backend-rust/src/backup.rs` | Encrypted portable backup and transactional restore |
| `backend-rust/src/host_keys.rs` | Fingerprint confirmation and known_hosts backup |
| `backend-rust/src/system.rs` | CLI installation, service settings and agent skills |
| `public/` | Browser interface and static assets |
| `src-tauri/` | Desktop lifecycle, windows, tray and updater |
| `tests/rust/` | HTTP/SQLite/PTY integration tests against the Rust executable |
| `tests/compat/` | Previous implementation for compatibility oracles and legacy JS regression tests |

Run `npm ci` and `npm run web:prepare` to prepare browser vendor bundles. Run
`npm start` to compile and start Rust, or launch the release executable directly.
`npm test` runs Rust unit tests, browser tests, compatibility tests and Rust HTTP
integration tests. Node is used only by the development harness.

Lists read persisted snapshots without waiting for SSH. Background probes push
updates through SSE. SSH masters remain owned by the external ssh-hold CLI;
closing a terminal ends only its PTY shell. Password changes and restored backups
revoke sessions. Backups cannot replace configuration during channel operations.

macOS uses the desktop executable itself in `--backend` mode as a supervised
child. Windows starts a compiled Linux Rust backend in WSL2. Desktop resources
contain static browser bundles, their licenses and a manifest; Windows also
carries the Linux executable. Data and keys live outside the application bundle.
