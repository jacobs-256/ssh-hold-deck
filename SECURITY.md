# Security

SSH Hold Deck can execute commands on connected servers. It is a single-password local console, not a public multi-user service. The server listens only on `127.0.0.1`; use `localhost` to access it. Host headers must identify a local interface or hostname, and browser API and terminal requests must be same-origin. HTTP does not encrypt login credentials or terminal traffic, so keep access local. Public Internet deployment is not supported by the current design.

## Data Protection Boundaries

- Web login passwords are salted scrypt hashes. Login sessions expire after 12 hours; cookies are HttpOnly and SameSite=Strict. The default local HTTP deployment does not use Secure cookies.
- SSH configuration and JumpServer secrets are encrypted with AES-256-GCM. The encryption key is a random 32-byte value stored in `vault.key` inside the data directory (mode 0600, created on first start). It stays stable when the machine's hostname or network changes. Earlier releases derived the key from the local username and hostname; when the key file is missing, the legacy derivation is matched against existing records and adopted. Records that still cannot be decrypted are shown as undecryptable rather than stopping the service, and can be deleted and recreated. This provides limited at-rest protection, not protection from an attacker who can read the data directory or the local account, and copying the directory elsewhere copies the key with it.
- SQLite status snapshots are not encrypted. Uploaded private keys are plaintext files with mode 0600. Treat the entire data directory as sensitive.
- Terminals require a login session, same-origin validation, and a single-use token expiring after 30 seconds. Terminal input/output is not deliberately persisted by the application. Remote systems and shell history may still record commands.
- Disabling SSH host fingerprint checks weakens host authentication. Use it only when you understand the endpoint and risk.
- Host key replacement requires explicit confirmation of the offered fingerprint. Verify it independently before accepting; a changed key can indicate interception. Pending confirmations are session-bound, single-use, expire after two minutes, and reject changes to the known-hosts file. Backups are saved beside that file as `.deck-backup-*`.
- No automated secret rotation, key migration, or password recovery workflow is provided.

Do not commit data directories, SSH metadata, private keys, credentials, session cookies, tokens, or unredacted connection diagnostics. Secure backups and restrict local account access.

## Reporting a Vulnerability

If the published repository offers GitHub private vulnerability reporting, use its Security tab. Otherwise contact the maintainer through a private channel listed in the repository profile. Do not publish credentials, a working exploit against live infrastructure, or sensitive logs in a public issue. A private reporting contact should be established before the first public release.

No supported-version or response-time commitment has been established yet. Dependency advisories and security fixes should be evaluated before deployment or release.
