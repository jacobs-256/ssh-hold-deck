import crypto from 'node:crypto';

export const DEFAULT_ORG = '00000000-0000-0000-0000-000000000002';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail = message => { throw new Error(message); };

export function normalizeServer(input, previous = {}) {
  const name = String(input.name || '').trim();
  if (!name || name.length > 100) fail('请填写 JumpServer 名称（最多 100 字）');
  let url;
  try { url = new URL(input.url); } catch { fail('JumpServer API 地址无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) fail('API 地址须为 HTTPS 服务地址，不含路径或登录信息');
  const keyId = String(input.keyId || '').trim();
  const keySecret = input.keySecret || (previous.url === url.origin && previous.keyId === keyId ? previous.keySecret : '');
  const orgId = String(input.orgId || DEFAULT_ORG).trim();
  const sshHost = String(input.sshHost || url.hostname).trim();
  const sshPort = Number(input.sshPort || 2222);
  if (!uuid(keyId) || typeof keySecret !== 'string' || !keySecret.trim() || keySecret.length > 4096) fail('请填写有效的 Key ID 和 Key Secret；更换地址或 Key ID 时须重新输入 Secret');
  if (!uuid(orgId)) fail('组织 ID 须为有效 UUID');
  if (!/^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(sshHost) || !Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) fail('SSH 网关地址或端口无效');
  return { id: previous.id || crypto.randomUUID(), name, url: url.origin, keyId, keySecret, orgId, sshHost, sshPort };
}

export function publicServer(server) {
  const { keySecret, ...safe } = server;
  return { ...safe, hasSecret: Boolean(keySecret) };
}

export function signatureHeaders(server, method, requestPath, date = new Date().toUTCString()) {
  const signature = crypto.createHmac('sha256', server.keySecret)
    .update(`(request-target): ${method.toLowerCase()} ${requestPath}\naccept: application/json\ndate: ${date}`).digest('base64');
  return {
    Accept: 'application/json', Date: date, 'X-JMS-ORG': server.orgId,
    Authorization: `Signature keyId="${server.keyId}",algorithm="hmac-sha256",headers="(request-target) accept date",signature="${signature}"`,
    'Content-Type': 'application/json',
  };
}

export class JumpServerClient {
  constructor(server, request = fetch) { this.server = server; this.request = request; }

  async api(requestPath, method = 'GET', body) {
    let response;
    try {
      response = await this.request(this.server.url + requestPath, {
        method, headers: signatureHeaders(this.server, method, requestPath),
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
    } catch { fail('JumpServer 请求失败，请检查网络、HTTPS 证书和服务地址'); }
    let data;
    try { data = await response.json(); } catch { fail(`JumpServer 未返回 JSON（HTTP ${response.status}），请检查 API 地址`); }
    if (!response.ok) {
      const messages = {
        acl_review: '该资产需要登录审批，请先在 JumpServer 完成审批',
        acl_reject: 'JumpServer 登录规则拒绝了连接',
        perm_expired: 'JumpServer 资产授权已过期',
        perm_account_invalid: 'JumpServer 账号未授权或已不可用',
      };
      fail(messages[data?.code] || ({ 401: 'JumpServer 认证失败，请检查密钥和本机时间', 403: 'JumpServer 权限不足或要求额外认证', 404: 'JumpServer 资产或 API 不存在', 400: 'JumpServer 拒绝了请求，请检查资产、账号或连接策略' })[response.status] || `JumpServer 请求失败（HTTP ${response.status}）`);
    }
    return data;
  }

  async test() {
    const profile = await this.api('/api/v1/users/profile/');
    const assets = await this.assets('', 0, 1);
    return { username: profile.username, assetCount: assets.count };
  }

  async organizations() {
    const data = await this.api('/api/v1/users/profile/permissions/');
    if (!Array.isArray(data.workbench_orgs)) fail('JumpServer 未返回可访问的组织列表');
    return data.workbench_orgs.filter(org => uuid(org.id) && !org.is_root && !org.is_system)
      .map(org => ({ id: org.id, name: org.name, isDefault: Boolean(org.is_default) }));
  }

  async assets(search = '', offset = 0, limit = 30) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset), search });
    const data = await this.api(`/api/v1/perms/users/self/assets/?${query}`);
    const results = Array.isArray(data) ? data : data.results;
    if (!Array.isArray(results)) fail('JumpServer 资产列表格式不兼容');
    return { count: data.count ?? results.length, results: results.map(asset => ({
      id: asset.id, name: asset.name, address: asset.address, orgId: asset.org_id,
      orgName: asset.org_name, active: asset.is_active !== false,
    })) };
  }

  async asset(id) {
    if (!uuid(id)) fail('资产 ID 无效');
    const asset = await this.api(`/api/v1/perms/users/self/assets/${id}/`);
    const protocols = asset.permed_protocols || [];
    if (asset.is_active === false || !protocols.some(p => (typeof p === 'string' ? p : p.name) === 'ssh')) fail('该资产未启用或没有 SSH 访问授权');
    return {
      id: asset.id, name: asset.name, address: asset.address, orgId: asset.org_id,
      sshPort: protocols.find(p => p.name === 'ssh')?.port || 22,
      accounts: (asset.permed_accounts || []).filter(account => account.has_secret && account.has_username !== false && account.username !== '@INPUT' &&
        (account.actions || []).some(action => (action.value || action) === 'connect'))
        .map(account => ({ alias: account.alias || account.id || account.username, name: account.name, username: account.username })),
    };
  }

  async channel(input) {
    const asset = await this.asset(input.assetId);
    const account = asset.accounts.find(a => a.alias === input.account);
    if (!account) fail('请选择有连接权限且已托管凭据的资产账号');
    return {
      source: 'jumpserver', serverId: this.server.id, assetId: asset.id, assetName: asset.name,
      assetAddress: asset.address, account: account.alias, accountUsername: account.username,
      target: `${account.username}@${asset.address}`, port: asset.sshPort,
      auth: 'jumpserver', jump: '', insecure: Boolean(input.insecure),
    };
  }

  async resolve(config) {
    // Revalidate permissions and obtain a fresh, single-use token for each new SSH master.
    await this.channel(config);
    const token = await this.api('/api/v1/authentication/connection-token/', 'POST', {
      asset: config.assetId, account: config.account, protocol: 'ssh', connect_method: 'ssh',
    });
    if (token.is_active === false || token.from_ticket) fail('该连接需要 JumpServer 审批，请在堡垒机完成审批后重试');
    if (!uuid(token.id) || typeof token.value !== 'string' || !token.value) fail('JumpServer 返回的连接令牌无效');
    return { ...config, target: `JMS-${token.id}@${this.server.sshHost}`, port: this.server.sshPort, auth: 'password', password: token.value };
  }
}
