import { access, lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { parse as parseYaml } from 'yaml';

const missing = error => ['ENOENT', 'ENOTDIR'].includes(error.code);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function exists(file, mode = constants.F_OK) {
  try { await access(file, mode); return true; } catch (error) { if (missing(error) || error.code === 'EACCES') return false; throw error; }
}

export function createAgentSkills({ home = os.homedir(), env = process.env, platform = process.platform,
  applications = platform === 'darwin' ? ['/Applications', path.join(home, 'Applications')] : [],
  source = new URL('../public/assets/ssh-hold-skill.md', import.meta.url) } = {}) {
  const config = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const catalog = [
    { id: 'codex', name: 'Codex', commands: ['codex'], apps: ['Codex.app', 'ChatGPT.app'],
      config: env.CODEX_HOME || path.join(home, '.codex'), roots: [path.join(env.CODEX_HOME || path.join(home, '.codex'), 'skills'), path.join(home, '.agents', 'skills')] },
    { id: 'claude', name: 'Claude Code', commands: ['claude'], apps: ['Claude.app'],
      config: env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), roots: [path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills')] },
    { id: 'copilot', name: 'GitHub Copilot', commands: ['copilot'], apps: [],
      config: path.join(home, '.copilot'), roots: [path.join(home, '.copilot', 'skills')] },
    { id: 'opencode', name: 'OpenCode', commands: ['opencode'], apps: ['OpenCode.app', 'OpenCode Desktop.app'],
      config: path.join(config, 'opencode'), roots: [path.join(config, 'opencode', 'skills'), path.join(home, '.agents', 'skills'), path.join(home, '.claude', 'skills')] },
    { id: 'deepseek', name: 'DeepSeek Harness', commands: ['dsh', 'deepseek'], apps: ['DeepSeek Harness.app'],
      config: env.DSH_HOME || path.join(home, '.dsh'), roots: [path.join(env.DSH_HOME || path.join(home, '.dsh'), 'skills')] },
    { id: 'trae', name: 'TRAE', commands: ['trae'], apps: ['Trae.app', 'TRAE.app'],
      config: path.join(home, '.trae'), roots: [path.join(home, '.trae', 'skills')] },
    { id: 'gemini', name: 'Gemini CLI', commands: ['gemini'], apps: [],
      config: path.join(home, '.gemini'), roots: [path.join(home, '.gemini', 'skills')] },
    { id: 'cursor', name: 'Cursor', commands: ['cursor', 'agent'], apps: ['Cursor.app'],
      config: path.join(home, '.cursor'), roots: [path.join(home, '.cursor', 'skills')] },
    { id: 'kiro', name: 'Kiro', commands: ['kiro', 'kiro-cli'], apps: ['Kiro.app'],
      config: path.join(home, '.kiro'), roots: [path.join(home, '.kiro', 'skills')] },
  ];
  const locks = new Set();
  async function detected(agent) {
    const directories = [...new Set([...(env.PATH || '').split(path.delimiter).filter(Boolean), path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin')])];
    const extensions = platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
    const candidates = agent.commands.flatMap(command => directories.flatMap(dir => extensions.map(ext => path.join(dir, command + ext))));
    const executable = (await Promise.all(candidates.map(file => exists(file, platform === 'win32' ? constants.F_OK : constants.X_OK)))).some(Boolean);
    const app = (await Promise.all(applications.flatMap(dir => agent.apps.map(name => exists(path.join(dir, name)))))).some(Boolean);
    // Config directories also detect IDE-managed agents that do not expose a CLI.
    return executable || app || await exists(agent.config);
  }
  async function entries(agent) {
    const found = [];
    for (const root of [...new Set(agent.roots)]) {
      let names;
      try { names = await readdir(root); } catch (error) { if (missing(error)) continue; throw error; }
      for (const name of names) {
        if (name.startsWith('.')) continue;
        const directory = path.join(root, name);
        try {
          const text = await readFile(path.join(directory, 'SKILL.md'), 'utf8');
          const metadata = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] || '';
          let skillName = false;
          try { skillName = ['ssh-hold', 'ssh-hold-skill'].includes(parseYaml(metadata)?.name); } catch { /* Unrelated malformed skills must not block detection. */ }
          if (skillName || ['ssh-hold', 'ssh-hold-skill'].includes(name)) found.push(directory);
        } catch (error) { if (!missing(error)) throw error; }
      }
    }
    return found;
  }
  async function list() {
    const agents = [];
    for (const agent of catalog) {
      try {
        if (!await detected(agent)) continue;
        const installedPaths = await entries(agent);
        agents.push({ id: agent.id, name: agent.name, skillInstalled: installedPaths.length > 0, paths: installedPaths, installPath: path.join(agent.roots[0], 'ssh-hold') });
      } catch (error) {
        agents.push({ id: agent.id, name: agent.name, skillInstalled: false, error: error.code || 'DETECTION_FAILED' });
      }
    }
    return { agents };
  }
  async function change(id, install, { confirmed = false } = {}) {
    const agent = catalog.find(item => item.id === id);
    if (!agent) throw fail('未知的 AI Agent');
    if (!install && !confirmed) throw fail('请先确认卸载 ssh-hold skill');
    if (locks.size) throw fail('另一个 skill 操作正在进行，请稍后重试', 409);
    locks.add(id);
    try {
      if (!await detected(agent)) throw fail('未检测到该 AI Agent', 404);
      const existing = await entries(agent);
      if (install && !existing.length) {
        const directory = path.join(agent.roots[0], 'ssh-hold');
        try { await lstat(directory); throw fail('目标目录已存在，请先检查目录内容', 409); } catch (error) { if (!missing(error)) throw error; }
        const markdown = await readFile(source, 'utf8');
        const content = `---\nname: ssh-hold\ndescription: Keep and reuse SSH connections with ssh-hold, including jump hosts, one-time passwords, remote commands and file transfers.\n---\n\n${markdown}`;
        await mkdir(agent.roots[0], { recursive: true });
        await mkdir(directory);
        await writeFile(path.join(directory, 'SKILL.md'), content, { flag: 'wx', mode: 0o644 });
      } else if (!install && existing.length) {
        // Move only discovered skill entries; renaming a symlink never follows its target.
        const backup = path.join(home, '.local', 'share', 'ssh-hold-deck', 'skill-backups', `${id}-${crypto.randomUUID()}`);
        await mkdir(backup, { recursive: true });
        const moved = [];
        try {
          for (const [index, directory] of existing.entries()) {
            const target = path.join(backup, `${index}-${path.basename(directory)}`);
            await rename(directory, target);
            moved.push({ from: directory, to: target });
          }
          await writeFile(path.join(backup, 'manifest.json'), JSON.stringify(moved, null, 2));
        } catch (error) {
          for (const item of moved.reverse()) await rename(item.to, item.from);
          throw error;
        }
      }
      return list();
    } finally { locks.delete(id); }
  }
  return { list, change };
}
