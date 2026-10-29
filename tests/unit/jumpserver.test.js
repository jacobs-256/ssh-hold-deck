import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { JumpServerClient, normalizeServer, publicServer, signatureHeaders } from '../../src/jumpserver.js';
import { connectionAvailability } from '../../src/connection-config.js';

const assetId = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
const server = normalizeServer({ name: 'Test', url: 'https://jms.example:8236', keyId: assetId, keySecret: 'test-secret', sshHost: 'ssh.example', sshPort: 2222 });
const detail = { id: assetId, name: 'Linux', address: '10.0.0.1', permed_protocols: [{ name: 'ssh', port: 2200 }], permed_accounts: [
  { alias: account, username: 'root', has_secret: true, has_username: true, actions: [{ value: 'connect' }] },
  { alias: 'input', username: '@INPUT', has_secret: false, actions: [{ value: 'connect' }] },
  { alias: 'denied', username: 'denied', has_secret: true, actions: [] },
] };

test('configuration validates HTTPS, retains secrets only for the same API identity, and redacts responses', () => {
  assert.equal(normalizeServer({ ...server, keySecret: '' }, server).keySecret, 'test-secret');
  assert.throws(() => normalizeServer({ ...server, url: 'http://jms.example' }), /HTTPS/);
  assert.throws(() => normalizeServer({ ...server, url: 'https://other.example', keySecret: '' }, server), /Secret/);
  assert.throws(() => normalizeServer({ ...server, sshHost: '-oProxyCommand=bad' }), /网关/);
  assert.equal(publicServer(server).keySecret, undefined);
  assert.equal(publicServer(server).hasSecret, true);
  assert.equal(connectionAvailability({ source: 'jumpserver', serverId: server.id, assetId, account }).canConnect, true);
  assert.equal(connectionAvailability({ source: 'jumpserver', serverId: server.id }).canConnect, false);
});

test('HTTP signature includes exact query string and UTC date', () => {
  const path = '/api/v1/perms/users/self/assets/?search=a%2Bb&limit=30';
  const date = 'Thu, 29 Oct 2026 08:00:00 GMT';
  const headers = signatureHeaders(server, 'GET', path, date);
  const expected = crypto.createHmac('sha256', 'test-secret').update(`(request-target): get ${path}\naccept: application/json\ndate: ${date}`).digest('base64');
  assert.ok(headers.Authorization.endsWith(`signature="${expected}"`));
  assert.equal(headers['X-JMS-ORG'], server.orgId);
});

test('organization discovery uses user permissions and excludes global and system scopes', async () => {
  const client = new JumpServerClient(server, async url => {
    assert.ok(url.endsWith('/api/v1/users/profile/permissions/'));
    return Response.json({ workbench_orgs: [
      { id: assetId, name: 'Default', is_default: true },
      { id: account, name: 'Operations' },
      { id: '00000000-0000-0000-0000-000000000000', name: 'All organizations', is_root: true },
      { id: '00000000-0000-0000-0000-000000000004', name: 'System', is_system: true },
    ] });
  });
  assert.deepEqual(await client.organizations(), [{ id: assetId, name: 'Default', isDefault: true }, { id: account, name: 'Operations', isDefault: false }]);
  await assert.rejects(new JumpServerClient(server, async () => Response.json({})).organizations(), /组织列表/);
});

test('asset permissions filter accounts; every connection gets a new token without mutating saved config', async () => {
  let tokens = 0;
  const requests = [];
  const client = new JumpServerClient(server, async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.includes('/connection-token/') ? { id: crypto.randomUUID(), value: `temporary-${++tokens}`, is_active: true } : detail);
  });
  const config = await client.channel({ assetId, account });
  assert.equal(config.port, 2200);
  assert.equal((await client.asset(assetId)).accounts.length, 1);
  const first = await client.resolve(config), second = await client.resolve(config);
  assert.notEqual(first.target, second.target);
  assert.notEqual(first.password, second.password);
  assert.equal(first.port, 2222);
  assert.match(first.target, /^JMS-.*@ssh\.example$/);
  assert.equal(config.password, undefined);
  assert.equal(config.auth, 'jumpserver');
  assert.deepEqual(JSON.parse(requests.find(r => r.options.method === 'POST').options.body), { asset: assetId, account, protocol: 'ssh', connect_method: 'ssh' });
  assert.ok(requests.every(r => r.options.redirect === 'error' && r.options.signal));
  await assert.rejects(client.channel({ assetId, account: 'denied' }), /连接权限/);
});

test('reject unsupported protocols, approvals, bad tokens and upstream errors without exposing response secrets', async () => {
  const noSSH = new JumpServerClient(server, async () => Response.json({ ...detail, permed_protocols: [{ name: 'rdp' }] }));
  await assert.rejects(noSSH.asset(assetId), /SSH/);
  for (const token of [{ is_active: false }, { id: 'bad', value: 'secret' }]) {
    const client = new JumpServerClient(server, async url => Response.json(url.includes('/connection-token/') ? token : detail));
    await assert.rejects(client.resolve({ assetId, account }), /审批|令牌无效/);
  }
  const denied = new JumpServerClient(server, async () => Response.json({ code: 'acl_review', secret: 'must-not-leak' }, { status: 400 }));
  await assert.rejects(denied.asset(assetId), e => e.message.includes('审批') && !e.message.includes('must-not-leak'));
  const redirect = new JumpServerClient(server, async () => { throw new Error('sensitive network message'); });
  await assert.rejects(redirect.test(), e => !e.message.includes('sensitive'));
});
