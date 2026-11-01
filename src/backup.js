import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { normalizeServer } from './jumpserver.js';

const scrypt = promisify(crypto.scrypt);
export const backupLimit = 20 * 1024 * 1024;
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function passwordCheck(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) invalid('备份密码须为 8–256 个字符');
}

export function validateBackup(payload) {
  if (!object(payload) || payload.version !== 1 || !Array.isArray(payload.channels) || !Array.isArray(payload.settings)
    || payload.channels.length > 10000 || payload.settings.length > 100) invalid('备份文件格式无效');
  const names = new Set();
  for (const item of payload.channels) {
    const config = item?.config;
    if (!object(item) || typeof item.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(item.name)
      || ['.', '..'].includes(item.name) || names.has(item.name) || !object(config)
      || !['manual', 'jumpserver'].includes(config.source || 'manual')
      || typeof config.target !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(config.target)
      || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535
      || !['password', 'key', 'jumpserver'].includes(config.auth)
      || (config.auth === 'key' && (typeof item.identityContent !== 'string' || Buffer.byteLength(item.identityContent) > 65536
        || !/-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/.test(item.identityContent)))) invalid('备份通道配置无效');
    names.add(item.name);
  }
  const keys = new Set();
  for (const item of payload.settings) {
    if (!object(item) || !['initialized', 'login_password', 'jumpservers', 'refreshSeconds', 'service'].includes(item.key)
      || keys.has(item.key) || typeof item.value !== 'string') invalid('备份设置无效');
    keys.add(item.key);
    let value;
    try { value = JSON.parse(item.value); } catch { invalid('备份设置无效'); }
    if (item.key === 'refreshSeconds' && (!Number.isInteger(value) || value !== 0 && (value < 5 || value > 3600))) invalid('备份设置无效');
    if (item.key === 'service' && (!object(value) || !Number.isInteger(value.port) || value.port !== 0 && (value.port < 1024 || value.port > 65535) || typeof value.autoSelect !== 'boolean')) invalid('备份设置无效');
    if (item.key === 'login_password' && (!object(value) || !/^[a-f0-9]{64}$/.test(value.salt) || !/^[a-f0-9]{128}$/.test(value.hash))) invalid('备份设置无效');
    if (item.key === 'jumpservers') {
      if (!object(value) || !Array.isArray(value.servers)) invalid('备份设置无效');
      const ids = new Set();
      for (const server of value.servers) {
        if (!object(server) || typeof server.id !== 'string' || !server.id || ids.has(server.id)) invalid('备份设置无效');
        try { normalizeServer(server, server); } catch { invalid('备份设置无效'); }
        ids.add(server.id);
      }
    }
  }
  if (!keys.has('login_password')) invalid('备份缺少登录配置');
  const preferences = payload.preferences;
  const preferenceOptions = {
    'ssh-hold-language': ['auto', 'zh-CN', 'en'], 'ssh-hold-theme': ['auto', 'light', 'dark'],
    'ssh-hold-text-size': ['small', 'default', 'large', 'xlarge'],
    'channelPageSize': ['10', '20', '50', '100'],
  };
  if (!object(preferences) || Object.entries(preferences).some(([key, value]) => !Object.hasOwn(preferenceOptions, key) || !preferenceOptions[key].includes(value))) invalid('备份界面配置无效');
  if (payload.desktop != null && (!object(payload.desktop) || !['ask', 'tray', 'quit'].includes(payload.desktop.closeBehavior)
    || typeof payload.desktop.trayEnabled !== 'boolean' || !payload.desktop.trayEnabled && payload.desktop.closeBehavior === 'tray')) invalid('备份桌面配置无效');
  return payload;
}

export async function encodeBackup(payload, password) {
  passwordCheck(password);
  validateBackup(payload);
  const salt = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const key = await scrypt(password, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { format: 'ssh-hold-deck-backup', version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export async function decodeBackup(envelope, password) {
  passwordCheck(password);
  if (!object(envelope) || envelope.format !== 'ssh-hold-deck-backup' || envelope.version !== 1
    || ['salt', 'iv', 'tag', 'data'].some(key => typeof envelope[key] !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(envelope[key]))) invalid('备份文件格式无效');
  const salt = Buffer.from(envelope.salt, 'base64'), iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
  if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16 || envelope.data.length > backupLimit) invalid('备份文件格式无效');
  let payload;
  try {
    const key = await scrypt(password, salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch { invalid('备份密码错误或文件已损坏'); }
  return validateBackup(payload);
}
