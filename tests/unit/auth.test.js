import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAuth } from '../../src/auth.js';

function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  let time = Date.now(); const auth = createAuth(db, { now: () => time });
  const req = cookie => ({ headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } });
  const response = () => ({ setHeader(name, value) { this[name] = value; } });
  return { db, auth, req, response, advance: ms => { time += ms; } };
}
const initial = { password: 'initial-password', confirmPassword: 'initial-password' };

test('first setup is atomic, hashes passwords, and creates an HttpOnly session', async () => {
  const { db, auth, req, response } = fixture();
  try {
    assert.equal(auth.configured(), false);
    assert.equal(auth.session(req()), null);
    await assert.rejects(auth.setup(req(), response(), { password: 'short', confirmPassword: 'short' }), /8/);
    const responses = [response(), response()];
    const results = await Promise.allSettled(responses.map(res => auth.setup(req(), res, initial)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const accepted = responses.find(res => res['Set-Cookie']);
    assert.match(accepted['Set-Cookie'], /HttpOnly; SameSite=Strict/);
    assert.ok(auth.session(req(accepted['Set-Cookie'].split(';')[0])));
    const record = db.prepare("SELECT value FROM settings WHERE key='login_password'").get().value;
    assert.ok(!record.includes(initial.password)); assert.equal(JSON.parse(record).hash.length, 128);
    const session = db.prepare('SELECT token_hash FROM web_sessions').get().token_hash;
    assert.ok(!accepted['Set-Cookie'].includes(session));
    await assert.rejects(auth.setup(req(), response(), initial), e => e.status === 409);
  } finally { db.close(); }
});

test('login, password changes, logout and expiry revoke sessions correctly', async () => {
  const { db, auth, req, response, advance } = fixture();
  try {
    const first = response(); await auth.setup(req(), first, initial);
    const firstReq = req(first['Set-Cookie'].split(';')[0]);
    const second = response(); await auth.login(req(), second, { password: initial.password });
    const secondReq = req(second['Set-Cookie'].split(';')[0]);
    await assert.rejects(auth.change(secondReq, response(), { currentPassword: 'wrong', password: 'replacement-password', confirmPassword: 'replacement-password' }), /原密码/);
    assert.ok(auth.session(firstReq));
    const changed = response();
    await auth.change(secondReq, changed, { currentPassword: initial.password, password: 'replacement-password', confirmPassword: 'replacement-password' });
    assert.equal(auth.session(firstReq), null); assert.equal(auth.session(secondReq), null);
    const changedReq = req(changed['Set-Cookie'].split(';')[0]); assert.ok(auth.session(changedReq));
    await assert.rejects(auth.login(req(), response(), { password: initial.password }), /密码错误/);
    const third = response(); await auth.login(req(), third, { password: 'replacement-password' });
    const thirdReq = req(third['Set-Cookie'].split(';')[0]);
    auth.logout(thirdReq, response()); assert.equal(auth.session(thirdReq), null);
    advance(12 * 60 * 60 * 1000 + 1); assert.equal(auth.session(changedReq), null);
  } finally { db.close(); }
});

test('incorrect logins are rate limited and recover after the cooldown', async () => {
  const { db, auth, req, response, advance } = fixture();
  try {
    await auth.setup(req(), response(), initial);
    for (let i = 0; i < 5; i++) await assert.rejects(auth.login(req(), response(), { password: 'wrong' }), e => e.status === 401);
    await assert.rejects(auth.login(req(), response(), { password: initial.password }), e => e.status === 429);
    advance(60001); const result = response(); await auth.login(req(), result, { password: initial.password });
    assert.ok(result['Set-Cookie']);
  } finally { db.close(); }
});
