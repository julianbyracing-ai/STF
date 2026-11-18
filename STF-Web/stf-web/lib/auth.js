'use strict';
const crypto = require('crypto');
const { get, run } = require('./db');

/** Formato: scrypt$<salt hex>$<hash hex> (scrypt N=2^15, r=8, p=1) */
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, PARAMS);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, saltHex, keyHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(keyHex, 'hex');
    const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, PARAMS);
    return crypto.timingSafeEqual(key, expected);
  } catch (_) { return false; }
}
// Hash falso para igualar el tiempo de respuesta cuando el usuario no existe
const DUMMY = hashPassword(crypto.randomBytes(18).toString('hex'));
function checkLogin(username, password) {
  const u = get('SELECT * FROM admin_users WHERE username = ?', String(username || ''));
  const ok = verifyPassword(String(password || ''), u ? u.pwd : DUMMY);
  return ok && u ? u : null;
}
function setPassword(userId, pw) { run('UPDATE admin_users SET pwd = ? WHERE id = ?', hashPassword(pw), userId); }

/** Cuenta inicial: variables de entorno ADMIN_USER/ADMIN_PASSWORD o el hash incluido en lib/default-admin.json */
function ensureAdmin() {
  const envUser = process.env.ADMIN_USER, envPass = process.env.ADMIN_PASSWORD;
  if (envPass) {
    if (envPass.length < 12) throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres');
    const name = envUser || 'stfdirector';
    const u = get('SELECT id FROM admin_users WHERE username = ?', name);
    if (u) setPassword(u.id, envPass); else run('INSERT INTO admin_users (username, pwd) VALUES (?, ?)', name, hashPassword(envPass));
    return;
  }
  if (!get('SELECT id FROM admin_users LIMIT 1')) {
    const d = require('./default-admin.json');
    run('INSERT INTO admin_users (username, pwd) VALUES (?, ?)', d.username, d.pwd);
  }
}

// ---- sesiones en memoria ----
const sessions = new Map(); // token -> {userId, username, expires}
const SESSION_MS = 8 * 3600 * 1000;
function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, username: user.username, expires: Date.now() + SESSION_MS });
  return token;
}
function getSession(token) {
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  s.expires = Date.now() + SESSION_MS;
  return s;
}
function destroySession(token) { sessions.delete(token); }
function destroyUserSessions(userId, keep) {
  for (const [t, s] of sessions) if (s.userId === userId && t !== keep) sessions.delete(t);
}
setInterval(() => { const now = Date.now(); for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t); }, 600000).unref();

// ---- límite de intentos de acceso ----
const fails = new Map(); // ip -> {count, until}
function lockedFor(ip) { const f = fails.get(ip); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
function registerFail(ip) {
  const f = fails.get(ip) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) { f.until = Date.now() + Math.min(3600000, 60000 * 2 ** (f.count - 5)); }
  fails.set(ip, f);
}
function clearFails(ip) { fails.delete(ip); }
setInterval(() => { const now = Date.now(); for (const [ip, f] of fails) if (f.until < now && f.count < 5) fails.delete(ip); }, 900000).unref();

module.exports = { hashPassword, verifyPassword, checkLogin, setPassword, ensureAdmin, createSession, getSession,
  destroySession, destroyUserSessions, lockedFor, registerFail, clearFails };
