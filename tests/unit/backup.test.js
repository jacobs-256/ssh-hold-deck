import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBackup, decodeBackup, validateBackup } from '../../src/backup.js';

const payload = () => ({ version: 1, channels: [{ name: 'production', config: { target: 'root@example.com', port: 22, auth: 'password', password: 'ssh-secret' } }],
  settings: [{ key: 'login_password', value: JSON.stringify({ salt: 'a'.repeat(64), hash: 'b'.repeat(128) }) }], preferences: { 'ssh-hold-language': 'en' }, desktop: { closeBehavior: 'tray', trayEnabled: true } });

test('encrypted backups round trip credentials and reject wrong passwords, tampering and versions', async () => {
  const source = payload(), backup = await encodeBackup(source, 'backup-password');
  assert.equal(JSON.stringify(backup).includes('ssh-secret'), false);
  assert.deepEqual(await decodeBackup(backup, 'backup-password'), source);
  await assert.rejects(decodeBackup(backup, 'wrong-password'), /密码错误或文件已损坏/);
  await assert.rejects(decodeBackup({ ...backup, tag: Buffer.alloc(16).toString('base64') }, 'backup-password'), /密码错误或文件已损坏/);
  await assert.rejects(decodeBackup({ ...backup, version: 2 }, 'backup-password'), /格式无效/);
  await assert.rejects(encodeBackup(source, 'short'), /8–256/);
});

test('validation rejects duplicate channels, unsafe names, invalid settings and missing private keys', () => {
  const duplicate = payload(); duplicate.channels.push(duplicate.channels[0]);
  assert.throws(() => validateBackup(duplicate), /通道配置无效/);
  const unsafe = payload(); unsafe.channels[0].name = '../escape';
  assert.throws(() => validateBackup(unsafe), /通道配置无效/);
  const key = payload(); key.channels[0].config.auth = 'key';
  assert.throws(() => validateBackup(key), /通道配置无效/);
  const port = payload(); port.settings.push({ key: 'service', value: '{"port":-1,"autoSelect":false}' });
  assert.throws(() => validateBackup(port), /备份设置无效/);
  const desktop = payload(); desktop.desktop.trayEnabled = false;
  assert.throws(() => validateBackup(desktop), /桌面配置无效/);
});
