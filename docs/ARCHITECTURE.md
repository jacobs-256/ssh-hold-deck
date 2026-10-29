# Project Structure

```text
.
├── src/                    # Node.js application source
│   ├── server.js           # Entry point, HTTP routes, SQLite and channel operations
│   ├── auth.js             # Web login and sessions
│   ├── connection-config.js# Connection readiness validation
│   ├── jump.js             # Reuse existing channels as jump hosts
│   ├── jumpserver.js       # JumpServer API client
│   └── terminal-server.js  # WebSocket authorization and PTY lifecycle
├── public/                 # Browser HTML, JavaScript and CSS
├── tests/
│   ├── unit/               # Isolated module and translation tests
│   └── integration/        # HTTP, SQLite and terminal integration checks
├── scripts/                # Installation and maintenance scripts
├── docs/                   # Architecture and release documentation
├── data/                   # Local runtime data; ignored by Git
├── package.json            # Dependencies and standard npm commands
├── package-lock.json       # Reproducible dependency resolution
├── README.md               # Default English documentation
└── README.zh-CN.md          # Chinese translation
```

## Commands

- `npm ci`: install locked dependencies and prepare the PTY helper.
- `npm start`: run `src/server.js` from the project root.
- `npm test`: run unit tests, integration tests, and SQLite verification.

The server resolves static assets, node_modules, and the default data directory relative to the project root, independently of the source directory. Moving code into src does not relocate existing data or change the default URL.

The backend delegates SSH lifecycle operations to the external ssh-hold CLI. SQLite stores configuration and status snapshots; background probes update status without delaying list reads. Browser terminals communicate through authenticated WebSockets with PTY processes. Frontend assets are served locally without a build step.

Keep runtime data and private keys out of source control. See SECURITY.md and PUBLISHING.md for release boundaries. The source layout is intentionally flat inside src until module size and ownership justify further subdivision.
