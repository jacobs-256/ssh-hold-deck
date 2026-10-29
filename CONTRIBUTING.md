# Contributing

Thank you for considering a contribution. The repository license must be selected by the project owner before accepting contributions for an open-source release.

## Development

Use Node.js 22.13.0 or later and install dependencies with `npm ci`. A compatible `ssh-hold` CLI is required to run the application; it is not bundled. See [README.md](README.md) for prerequisites and configuration.

Keep changes focused. Preserve same-origin checks, session authorization, argument-array subprocess execution, and credential redaction. Never include real SSH passwords, private keys, JumpServer secrets, SQLite databases, or production host information in patches, logs, tests, or screenshots.

Run the relevant checks before proposing a change:

```sh
npm test
```

For UI changes, verify desktop and narrow layouts, loading/error states, and both interface languages. Update both README translations when behavior or setup requirements change. Test fixtures should use temporary directories and mocked SSH/API behavior rather than production connections.

## Bug Reports and Pull Requests

Include the Node.js version, OS, reproduction steps, expected behavior, actual behavior, and sanitized diagnostics. For terminal issues, distinguish opening a shell from connecting the underlying channel.

Pull requests should explain the problem, the behavior after the change, and verification performed. Discuss significant dependencies or architectural changes before implementing them. Follow [SECURITY.md](SECURITY.md) for vulnerabilities rather than posting sensitive details in public issues.
