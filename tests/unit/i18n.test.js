import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../public/i18n.js', import.meta.url), 'utf8');
function locale(language, preference) {
  const select = { addEventListener() {} };
  let elements = 0;
  const storage = new Map(preference ? [['ssh-hold-language', preference]] : []);
  const sandbox = {
    navigator: { language, languages: [language] },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    document: { documentElement: { dataset: {} }, body: { append() {} }, querySelector: () => null, addEventListener() {}, createTreeWalker: () => ({ nextNode: () => null }), createElement: () => { const control = elements++ === 0 ? select : { querySelectorAll: () => [] }; return { querySelector: () => control, addEventListener() {}, append() {} }; } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 }, lucide: { createIcons() {} },
    location: { reload() { sandbox.reloaded = true; } }, addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return { ...sandbox.I18n, sandbox, storage, select };
}

test('automatic locale follows the browser; explicit and persisted preferences override it', () => {
  assert.equal(locale('zh-CN').language, 'zh-CN');
  assert.equal(locale('zh-TW').language, 'zh-CN');
  assert.equal(locale('en-US').language, 'en');
  assert.equal(locale('fr-FR').language, 'en');
  assert.equal(locale('en-US', 'zh-CN').language, 'zh-CN');
  assert.equal(locale('zh-CN', 'en').language, 'en');
  assert.equal(locale('en-US', 'invalid').preference, 'auto');
  const selected = locale('en-US'); selected.select.onclick({ target: { closest: () => ({ dataset: { language: 'zh-CN' } }) } });
  assert.equal(selected.storage.get('ssh-hold-language'), 'zh-CN'); assert.equal(selected.sandbox.reloaded, true);
});

test('English translates dynamic labels and authentication errors while preserving names and terminal escapes', () => {
  const { t } = locale('en-US');
  assert.equal(t('显示 17 条结果'), '17 results');
  assert.equal(t('在跑 (pid 123)'), 'Running (pid 123)');
  assert.equal(t('密码错误'), 'Incorrect password');
  assert.equal(t('两次输入的密码不一致'), 'Passwords do not match');
  assert.equal(t('确定删除通道“我的服务器”？这会关闭当前连接。'), 'Delete channel “我的服务器”? This will close its connection.');
  assert.equal(t('连接成功 · jacobs · 126 个授权资产'), 'Connected · jacobs · 126 authorized assets');
  assert.equal(t('\r\n\x1b[90m连接已关闭\x1b[0m'), '\r\n\x1b[90mConnection closed\x1b[0m');
  assert.equal(t('root@10.0.0.1'), 'root@10.0.0.1');
  assert.equal(locale('zh-CN').t('显示 17 条结果'), '显示 17 条结果');
});
