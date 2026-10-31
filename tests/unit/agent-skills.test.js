import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { createAgentSkills } from '../../src/agent-skills.js';

async function fixture(t, options = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'deck-agent-skills-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const service = createAgentSkills({ home, env: {}, applications: [], ...options });
  return { home, service };
}
async function skill(directory, name = 'ssh-hold') {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n---\n# Test\n`);
}

test('detects CLI, app and config installations without executing agent commands', async t => {
  const { home } = await fixture(t);
  const bin = path.join(home, 'bin'); await mkdir(bin);
  await writeFile(path.join(bin, 'codex'), '#!/bin/sh\nexit 99\n'); await chmod(path.join(bin, 'codex'), 0o755);
  await mkdir(path.join(home, 'apps', 'DeepSeek Harness.app'), { recursive: true });
  await mkdir(path.join(home, '.claude'));
  const service = createAgentSkills({ home, env: { PATH: bin }, applications: [path.join(home, 'apps')] });
  const { agents } = await service.list();
  assert.deepEqual(agents.map(agent => agent.id), ['codex', 'claude', 'deepseek']);
  assert(agents.every(agent => !agent.skillInstalled));
  const empty = await fixture(t); assert.deepEqual(await empty.service.list(), { agents: [] });
});

test('installs a valid skill, is idempotent, requires uninstall confirmation and preserves unrelated files', async t => {
  const { home, service } = await fixture(t);
  await mkdir(path.join(home, '.claude'));
  await skill(path.join(home, '.claude', 'skills', 'other'), 'other');
  await service.change('claude', true);
  const file = path.join(home, '.claude', 'skills', 'ssh-hold', 'SKILL.md');
  const original = await readFile(file, 'utf8');
  assert.equal(parse(original.split('---')[1]).name, 'ssh-hold');
  assert(original.includes('ssh-hold run'));
  await service.change('claude', true); assert.equal(await readFile(file, 'utf8'), original);
  await assert.rejects(service.change('claude', false), /确认/);
  await access(file);
  const result = await service.change('claude', false, { confirmed: true });
  assert.equal(result.agents[0].skillInstalled, false);
  await assert.rejects(access(file), { code: 'ENOENT' });
  await access(path.join(home, '.claude', 'skills', 'other', 'SKILL.md'));
  const backups = path.join(home, '.local', 'share', 'ssh-hold-deck', 'skill-backups');
  const backup = path.join(backups, (await readdir(backups))[0]);
  assert.equal(await readFile(path.join(backup, '0-ssh-hold', 'SKILL.md'), 'utf8'), original);
});

test('detects aliases and YAML names; removes symlink entries without touching their targets', async t => {
  const { home, service } = await fixture(t);
  const root = path.join(home, '.codex', 'skills');
  const target = path.join(home, 'shared-source'); await skill(target);
  await mkdir(root, { recursive: true }); await symlink(target, path.join(root, 'ssh-hold'));
  await skill(path.join(root, 'ssh-hold-skill'));
  await skill(path.join(root, 'custom-name'), '"ssh-hold"');
  assert.equal((await service.list()).agents[0].paths.length, 3);
  await service.change('codex', false, { confirmed: true });
  await access(path.join(target, 'SKILL.md'));
  assert.equal((await service.list()).agents[0].skillInstalled, false);
});

test('respects configured roots, inherited skills and protects existing directories and unknown IDs', async t => {
  const { home } = await fixture(t);
  const custom = path.join(home, 'custom-codex'); await mkdir(custom);
  const service = createAgentSkills({ home, env: { CODEX_HOME: custom }, applications: [] });
  await service.change('codex', true);
  await access(path.join(custom, 'skills', 'ssh-hold', 'SKILL.md'));
  await assert.rejects(access(path.join(home, '.codex')), { code: 'ENOENT' });
  await assert.rejects(service.change('../escape', true), /未知/);
  await assert.rejects(service.change('trae', true), /未检测/);
  const root = path.join(home, '.claude', 'skills', 'ssh-hold'); await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'keep.txt'), 'keep');
  await assert.rejects(service.change('claude', true), /已存在/);
  assert.equal(await readFile(path.join(root, 'keep.txt'), 'utf8'), 'keep');
  await mkdir(path.join(home, '.config', 'opencode'), { recursive: true });
  await skill(path.join(home, '.claude', 'skills', 'ssh-hold-skill'));
  const result = await service.list();
  assert.equal(result.agents.find(agent => agent.id === 'opencode').skillInstalled, true);
  assert.equal(result.agents.find(agent => agent.id === 'claude').skillInstalled, true);
});

test('detects Kiro CLI and app, installs its skill, and preserves other Kiro skills on uninstall', async t => {
  const { home } = await fixture(t);
  const bin = path.join(home, 'bin'); await mkdir(bin);
  await writeFile(path.join(bin, 'kiro-cli'), '#!/bin/sh\nexit 99\n');
  await chmod(path.join(bin, 'kiro-cli'), 0o755);
  const cli = createAgentSkills({ home, env: { PATH: bin }, applications: [] });
  assert.equal((await cli.list()).agents.find(agent => agent.id === 'kiro').skillInstalled, false);
  const apps = path.join(home, 'apps'); await mkdir(path.join(apps, 'Kiro.app'), { recursive: true });
  const desktop = createAgentSkills({ home, env: {}, applications: [apps] });
  assert.equal((await desktop.list()).agents.find(agent => agent.id === 'kiro').skillInstalled, false);
  await desktop.change('kiro', true);
  await access(path.join(home, '.kiro', 'skills', 'ssh-hold', 'SKILL.md'));
  assert.equal((await cli.list()).agents.find(agent => agent.id === 'kiro').skillInstalled, true);
  await skill(path.join(home, '.kiro', 'skills', 'other'), 'other');
  await desktop.change('kiro', false, { confirmed: true });
  await access(path.join(home, '.kiro', 'skills', 'other', 'SKILL.md'));
  assert.equal((await cli.list()).agents.find(agent => agent.id === 'kiro').skillInstalled, false);
});
