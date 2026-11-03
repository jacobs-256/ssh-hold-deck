import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../public/session.js', import.meta.url), 'utf8');
function fixture() {
  let response = { ok: true, status: 200, json: async () => ({ authenticated: true }) };
  let reloads = 0, locked = false;
  const events = {};
  const context = {
    URL, AbortSignal,
    location: { href: 'http://localhost:8787/', origin: 'http://localhost:8787', reload() { reloads++; } },
    document: { visibilityState: 'visible', body: { classList: { add() { locked = true; } } },
      addEventListener(name, fn) { events[name] = fn; } },
    addEventListener(name, fn) { events[name] = fn; },
    setInterval(fn) { events.interval = fn; },
    fetch: async () => { if (response instanceof Error) throw response; return response; },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { context, events, set response(value) { response = value; }, get reloads() { return reloads; }, get locked() { return locked; } };
}
test('protected API 401 locks the UI and returns to login across API consumers', async () => {
  const app = fixture();
  app.context.Session.activate();
  app.response = { status: 401 };
  await app.context.fetch('/api/auth/login');
  await app.context.fetch('https://example.com/api/settings');
  assert.equal(app.reloads, 0);
  await app.context.fetch('/api/system/agent-skills');
  await app.context.fetch({ url: 'http://localhost:8787/api/settings/service' });
  assert.equal(app.reloads, 1);
  assert.equal(app.locked, true);
});
test('foreground and periodic checks detect expiration without treating network failures as logout', async () => {
  const app = fixture();
  app.response = { ok: true, json: async () => ({ authenticated: false }) };
  await app.events.focus();
  assert.equal(app.reloads, 0);
  app.context.Session.activate();
  app.context.document.visibilityState = 'hidden';
  await app.events.interval();
  assert.equal(app.reloads, 0);
  app.context.document.visibilityState = 'visible';
  app.response = new Error('offline');
  await app.events.focus();
  assert.equal(app.reloads, 0);
  app.response = { ok: true, json: async () => ({ authenticated: false }) };
  await app.events.visibilitychange();
  assert.equal(app.reloads, 1);
});
