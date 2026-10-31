import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const sessionLifetime = 12 * 60 * 60 * 1000;
const cookieName = 'ssh_hold_session';
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
const invalid = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export function createAuth(db, { now = Date.now } = {}) {
  db.exec('CREATE TABLE IF NOT EXISTS web_sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
  const attempts = new Map();
  const credential = () => {
    const row = db.prepare("SELECT value FROM settings WHERE key='login_password'").get();
    return row ? JSON.parse(row.value) : null;
  };
  function token(req) {
    const value = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
  }
  function session(req) {
    const value = token(req);
    if (!value) return null;
    const hashed = digest(value);
    return db.prepare('SELECT token_hash FROM web_sessions WHERE token_hash=? AND expires>?').get(hashed, now())?.token_hash || null;
  }
  function cookie(res, value, maxAge) {
    res.setHeader('Set-Cookie', `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
  }
  function issue(res) {
    db.prepare('DELETE FROM web_sessions WHERE expires<=?').run(now());
    const value = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO web_sessions (token_hash, expires) VALUES (?, ?)').run(digest(value), now() + sessionLifetime);
    cookie(res, value, sessionLifetime / 1000);
  }
  function validatePassword(password, confirmPassword) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 256) invalid('密码长度须为 8–256 个字符');
    if (password !== confirmPassword) invalid('两次输入的密码不一致');
  }
  async function hashPassword(password) {
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
    return { salt, hash: hash.toString('hex') };
  }
  async function verify(password, record) {
    if (typeof password !== 'string' || password.length > 256 || !record) return false;
    const hash = await scrypt(password, record.salt, 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(hash, Buffer.from(record.hash, 'hex'));
  }
  function rateLimit(req) {
    const key = req.socket.remoteAddress;
    const previous = attempts.get(key);
    if (previous && previous.until > now() && previous.count >= 5) invalid('密码错误次数过多，请稍后再试', 429);
    const entry = previous && previous.until > now() ? previous : { count: 0, until: now() + 60000 };
    entry.count++; attempts.set(key, entry);
  }
  return {
    session,
    configured: () => Boolean(credential()),
    async setup(req, res, { password, confirmPassword }) {
      if (credential()) invalid('登录密码已设置，请使用密码登录', 409);
      validatePassword(password, confirmPassword);
      const record = await hashPassword(password);
      const result = db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('login_password',?)").run(JSON.stringify(record));
      if (!result.changes) invalid('登录密码已设置，请使用密码登录', 409);
      issue(res);
    },
    async login(req, res, { password }) {
      const record = credential();
      if (!record) invalid('请先设置登录密码', 409);
      rateLimit(req);
      if (!await verify(password, record)) invalid('密码错误', 401);
      // A concurrent password change must not resurrect an old login.
      if (credential().hash !== record.hash) invalid('密码已修改，请重新登录', 401);
      attempts.delete(req.socket.remoteAddress);
      const previous = session(req);
      if (previous) db.prepare('DELETE FROM web_sessions WHERE token_hash=?').run(previous);
      issue(res);
    },
    async change(req, res, { password }) {
      if (!session(req)) invalid('请先登录', 401);
      validatePassword(password, password);
      rateLimit(req);
      const record = credential();
      const replacement = await hashPassword(password);
      if (!session(req) || credential().hash !== record.hash) invalid('登录状态已失效，请重新登录', 401);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("UPDATE settings SET value=? WHERE key='login_password'").run(JSON.stringify(replacement));
        db.exec('DELETE FROM web_sessions'); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      attempts.delete(req.socket.remoteAddress);
      issue(res);
    },
    logout(req, res) {
      const id = session(req);
      if (id) db.prepare('DELETE FROM web_sessions WHERE token_hash=?').run(id);
      cookie(res, '', 0);
    },
  };
}
