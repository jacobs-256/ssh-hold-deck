# Dashboard Agent Skills

The dashboard detects agents on the machine running the web server, not on the
computer visiting the page. Detection checks executable paths, macOS application
bundles and existing user configuration directories. A configuration directory can
remain after an agent is removed; detection reports that local installation footprint.
No agent executable is launched during detection.

| Agent | Primary skill directory | Additional discovered directories |
| --- | --- | --- |
| Codex | `$CODEX_HOME/skills` or `~/.codex/skills` | `~/.agents/skills` |
| Claude Code | `$CLAUDE_CONFIG_DIR/skills` or `~/.claude/skills` | |
| GitHub Copilot | `~/.copilot/skills` | |
| OpenCode | `$XDG_CONFIG_HOME/opencode/skills` or `~/.config/opencode/skills` | `~/.agents/skills`, `~/.claude/skills` |
| DeepSeek Harness | `$DSH_HOME/skills` or `~/.dsh/skills` | |
| TRAE | `~/.trae/skills` | |
| Gemini CLI | `~/.gemini/skills` | |
| Cursor | `~/.cursor/skills` | |
| Kiro | `~/.kiro/skills` | |

The UI fetches status asynchronously on dashboard entry and window focus. Icons
are colored when a matching skill is installed and gray otherwise. Click to
install, or confirm the dialog to uninstall. Shared discovered directories are
identified in the confirmation when another detected agent uses the same entry.
Some agents require a new session or skill reload to discover an installation.

Settings > Service Configuration also shows agent cards with installation switches
and full `SKILL.md` paths. Uninstalled skills display the intended destination.
Both views share state and use the same uninstall confirmation. Paths are read-only.

The service recognizes `ssh-hold`, `ssh-hold-skill`, and other directories whose
`SKILL.md` frontmatter declares either name. New installations use `ssh-hold/SKILL.md`
with valid YAML metadata and the bundled Markdown guide. Existing installations
are never overwritten. The CLI itself is installed separately.

Uninstall moves the discovered entries to
`~/.local/share/ssh-hold-deck/skill-backups/<agent>-<id>/`. `manifest.json` records
their original locations. Symlink entries are moved without removing their shared
source files. Other skills and SSH channels are not modified.

API routes require a logged-in session:

- `GET /api/system/agent-skills`: discovered agents and skill status.
- `POST /api/system/agent-skills/:id`: install the bundled skill.
- `DELETE /api/system/agent-skills/:id`: uninstall; requires `{"confirmed":true}`.

Mutations also require an Origin header matching the current service origin.
Agent identifiers and destination directories come from a fixed registry; clients
cannot submit arbitrary filesystem paths.

Format references:

- https://developers.openai.com/codex/skills/
- https://code.claude.com/docs/en/skills
- https://opencode.ai/docs/skills/
- https://kiro.dev/docs/skills/
