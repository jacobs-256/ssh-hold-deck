# Security

SSH Hold Deck can execute commands on connected servers. It is designed as a local, single-password console, not a public multi-user service. The current server binds to `127.0.0.1`; exposing it through a proxy or changing the bind address requires a separate security review. Public Internet deployment is not supported by the current design.

## Data Protection Boundaries

- Web login passwords are salted scrypt hashes. Login sessions expire after 12 hours; cookies are HttpOnly and SameSite=Strict. The default local HTTP deployment does not use Secure cookies.
- SSH configuration and JumpServer secrets are encrypted with AES-256-GCM. The encryption key is derived from the local username and hostname; these values are not secrets. This provides limited at-rest protection, not protection from an attacker who can access the local account or reproduce those values.
- SQLite status snapshots are not encrypted. Uploaded private keys are plaintext files with mode 0600. Treat the entire data directory as sensitive.
- Terminals require a login session, same-origin validation, and a single-use token expiring after 30 seconds. Terminal input/output is not deliberately persisted by the application. Remote systems and shell history may still record commands.
- Disabling SSH host fingerprint checks weakens host authentication. Use it only when you understand the endpoint and risk.
- No automated secret rotation, key migration, or password recovery workflow is provided.

Do not commit data directories, SSH metadata, private keys, credentials, session cookies, tokens, or unredacted connection diagnostics. Secure backups and restrict local account access.

## Reporting a Vulnerability

If the published repository offers GitHub private vulnerability reporting, use its Security tab. Otherwise contact the maintainer through a private channel listed in the repository profile. Do not publish credentials, a working exploit against live infrastructure, or sensitive logs in a public issue. A private reporting contact should be established before the first public release.

No supported-version or response-time commitment has been established yet. Dependency advisories and security fixes should be evaluated before deployment or release.
