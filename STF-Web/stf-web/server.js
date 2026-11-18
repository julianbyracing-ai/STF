'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { all, get, run, tx, DATA_DIR } = require('./lib/db');
const auth = require('./lib/auth');
const { seedIfEmpty } = require('./lib/seed');
const { generate } = require('./lib/fixtures');

seedIfEmpty();
auth.ensureAdmin();

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const TRUST_PROXY = process.env.TRUST_PROXY !== '0';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = msg => new HttpError(400, msg);

// ---------- utilidades ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json' };

function clientIp(req) {
  if (TRUST_PROXY) { const f = req.headers['x-forwarded-for']; if (f) return String(f).split(',')[0].trim(); }
  return req.socket.remoteAddress || 'unknown';
}
function isHttps(req) { return req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https'; }
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function securityHeaders(res, req) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, headers); res.end(body);
}
function json(res, status, obj, extra = {}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Contenido demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw bad('Se esperaba JSON');
  const buf = await readBody(req, 1024 * 1024);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch (_) { throw bad('JSON inválido'); }
}

// ---------- validación de campos ----------
const TABLES = {
  news: { text: ['title', 'subtitle', 'content', 'category', 'published'], img: ['image'], bool: ['featured'], req: ['title'], max: { content: 20000 } },
  teams: { text: ['name', 'short_name', 'coach'], img: ['crest'], int: ['league_id'], req: ['name'] },
  players: { text: ['name', 'position'], int: ['team_id', 'number'], req: ['name'] },
  matches: { text: ['match_date', 'venue', 'details', 'result_at'], int: ['season_id', 'league_id', 'round', 'home_id', 'away_id', 'home_goals', 'away_goals'], bool: ['played'], req: ['season_id', 'league_id', 'round', 'home_id', 'away_id'] },
  honors: { text: ['kind', 'competition', 'notes'], int: ['season_id', 'champion_id', 'runner_up_id'], req: ['season_id', 'kind', 'competition'] },
  rules: { text: ['category', 'title', 'content'], int: ['sort_order'], req: ['category', 'title'], max: { content: 20000 } },
  leagues: { text: ['name', 'short_name', 'tagline', 'kind'], int: ['sort_order'], req: ['name'] },
  seasons: { text: ['name'], bool: ['is_current'], req: ['name'] },
};
const IMG_RE = /^(https?:\/\/[^\s"'<>]{4,1000}|\/uploads\/[a-f0-9]{32}\.(png|jpg|gif|webp))$/i;

function clean(table, body, partial) {
  const spec = TABLES[table], out = {};
  const keys = [...(spec.text || []), ...(spec.img || []), ...(spec.int || []), ...(spec.bool || [])];
  for (const k of keys) {
    if (!(k in body)) { if (!partial && spec.req.includes(k)) throw bad(`Falta el campo ${k}`); continue; }
    let v = body[k];
    if ((spec.text || []).includes(k)) {
      v = v == null ? null : String(v).trim();
      if (v && v.length > ((spec.max && spec.max[k]) || 500)) throw bad(`El campo ${k} es demasiado largo`);
      if (v === '') v = null;
    } else if ((spec.img || []).includes(k)) {
      v = v == null ? null : String(v).trim();
      if (v === '') v = null;
      if (v && !IMG_RE.test(v)) throw bad('La imagen debe ser un enlace http(s) o un archivo subido');
    } else if ((spec.int || []).includes(k)) {
      if (v === '' || v == null) v = null;
      else { v = Number(v); if (!Number.isInteger(v) || v < -1e9 || v > 1e9) throw bad(`Valor numérico inválido en ${k}`); }
    } else { v = v ? 1 : 0; }
    if (spec.req.includes(k) && (v == null || v === '')) throw bad(`El campo ${k} es obligatorio`);
    out[k] = v;
  }
  if (table === 'matches') {
    if (out.played === 1 && (out.home_goals == null || out.away_goals == null)) throw bad('Un partido jugado necesita ambos marcadores');
    if (out.played === 1 && !out.result_at) out.result_at = new Date().toISOString();
    if (out.played === 0) { out.result_at = null; }
    if (out.home_id && out.home_id === out.away_id) throw bad('Local y visitante no pueden ser el mismo equipo');
  }
  if (table === 'leagues' && out.kind && !['LIGA', 'COPA'].includes(out.kind)) throw bad('Tipo de competición inválido');
  if (table === 'news' && !('published' in out) && !partial) out.published = new Date().toISOString().slice(0, 10);
  return out;
}
function dbError(e) {
  if (e instanceof HttpError) return e;
  const m = String(e.message || '');
  if (/UNIQUE/.test(m)) return new HttpError(409, 'Ya existe un registro con ese nombre');
  if (/FOREIGN KEY/.test(m)) return new HttpError(400, 'Referencia inválida a otro registro');
  console.error(e);
  return new HttpError(500, 'Error interno');
}

// ---------- estado público ----------
function currentSeasonId() { const s = get('SELECT id FROM seasons WHERE is_current = 1') || get('SELECT id FROM seasons ORDER BY id DESC LIMIT 1'); return s && s.id; }
function publicState(seasonParam) {
  const seasons = all('SELECT * FROM seasons ORDER BY id DESC');
  let sid = Number(seasonParam);
  if (!seasons.some(s => s.id === sid)) sid = currentSeasonId();
  const settings = {};
  for (const r of all('SELECT key, value FROM settings')) settings[r.key] = r.value;
  return {
    seasonId: sid, seasons, settings,
    leagues: all('SELECT * FROM leagues ORDER BY (kind = \'COPA\'), sort_order, id'),
    teams: all('SELECT * FROM teams ORDER BY name'),
    compTeams: all('SELECT * FROM competition_teams'),
    players: all('SELECT * FROM players ORDER BY name'),
    playerStats: all('SELECT * FROM player_stats WHERE season_id = ?', sid),
    matches: all('SELECT * FROM matches WHERE season_id = ? ORDER BY league_id, round, id', sid),
    squads: all('SELECT s.* FROM squads s JOIN matches m ON m.id = s.match_id WHERE m.season_id = ?', sid),
    squadPlayers: all('SELECT sp.* FROM squad_players sp JOIN squads s ON s.id = sp.squad_id JOIN matches m ON m.id = s.match_id WHERE m.season_id = ? ORDER BY sp.sort_order, sp.id', sid),
    news: all('SELECT * FROM news ORDER BY featured DESC, published DESC, id DESC'),
    honors: all('SELECT * FROM honors ORDER BY season_id DESC, id'),
    rules: all('SELECT * FROM rules ORDER BY category, sort_order, id'),
  };
}

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname, method = req.method;
  const cookies = parseCookies(req);
  const sess = auth.getSession(cookies.stf_session);

  if (method === 'GET' && p === '/api/state') {
    return json(res, 200, { ...publicState(url.searchParams.get('season')), admin: sess ? sess.username : null });
  }
  if (method === 'GET' && p === '/api/health') return json(res, 200, { ok: true });

  // Protección CSRF para toda operación que modifica datos
  if (method !== 'GET') {
    if (req.headers['x-requested-with'] !== 'stf') throw new HttpError(403, 'Solicitud no permitida');
    const origin = req.headers.origin;
    if (origin) {
      let ok = false; try { ok = new URL(origin).host === req.headers.host; } catch (_) {}
      if (!ok) throw new HttpError(403, 'Origen no permitido');
    }
  }

  if (method === 'POST' && p === '/api/login') {
    const ip = clientIp(req);
    const wait = auth.lockedFor(ip);
    if (wait) return json(res, 429, { error: `Demasiados intentos. Espera ${Math.ceil(wait / 60)} min.` });
    const b = await readJson(req);
    const user = auth.checkLogin(b.username, b.password);
    if (!user) { auth.registerFail(ip); await new Promise(r => setTimeout(r, 600)); return json(res, 401, { error: 'Usuario o contraseña incorrectos' }); }
    auth.clearFails(ip);
    const token = auth.createSession(user);
    const cookie = `stf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${isHttps(req) ? '; Secure' : ''}`;
    return json(res, 200, { ok: true, admin: user.username }, { 'Set-Cookie': cookie });
  }
  if (method === 'POST' && p === '/api/logout') {
    auth.destroySession(cookies.stf_session);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'stf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (!p.startsWith('/api/admin/')) throw new HttpError(404, 'No encontrado');
  if (!sess) throw new HttpError(401, 'Sesión requerida');
  const parts = p.slice('/api/admin/'.length).split('/').filter(Boolean);

  // ----- subir escudo / imagen -----
  if (method === 'POST' && parts[0] === 'upload') {
    const buf = await readBody(req, 2 * 1024 * 1024);
    let ext = null;
    if (buf.length > 12) {
      if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') ext = 'png';
      else if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) ext = 'jpg';
      else if (buf.toString('latin1', 0, 4) === 'GIF8') ext = 'gif';
      else if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') ext = 'webp';
    }
    if (!ext) throw bad('Formato no válido. Usa PNG, JPG, GIF o WEBP (máx. 2 MB).');
    const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UPLOADS, name), buf);
    return json(res, 201, { url: '/uploads/' + name });
  }

  const body = method === 'GET' || method === 'DELETE' ? {} : await readJson(req);

  if (method === 'POST' && parts[0] === 'password') {
    const u = get('SELECT * FROM admin_users WHERE username = ?', sess.username);
    if (!auth.verifyPassword(String(body.current || ''), u.pwd)) throw new HttpError(403, 'La contraseña actual no es correcta');
    const np = String(body.next || '');
    if (np.length < 12 || !/[a-z]/.test(np) || !/[A-Z]/.test(np) || !/\d/.test(np)) throw bad('La nueva contraseña necesita 12+ caracteres, mayúscula, minúscula y número');
    auth.setPassword(u.id, np);
    auth.destroyUserSessions(u.id, cookies.stf_session);
    return json(res, 200, { ok: true });
  }
  if (method === 'POST' && parts[0] === 'settings') {
    const w = ['points_win', 'points_draw', 'points_loss'];
    tx(() => {
      for (const k of w) if (k in body) { const v = Number(body[k]); if (!Number.isInteger(v) || v < 0 || v > 10) throw bad('Los puntos deben ser enteros entre 0 y 10'); run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v)); }
      if ('tiebreakers' in body) {
        const list = String(body.tiebreakers).split(',').map(s => s.trim()).filter(Boolean);
        if (list.some(c => !['DG', 'GF', 'GC', 'PG'].includes(c))) throw bad('Criterio de desempate inválido');
        run("INSERT INTO settings (key,value) VALUES ('tiebreakers',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", list.join(','));
      }
    });
    return json(res, 200, { ok: true });
  }
  if (method === 'POST' && parts[0] === 'fixtures') {
    const league = get('SELECT * FROM leagues WHERE id = ?', Number(body.league_id));
    const season = get('SELECT id FROM seasons WHERE id = ?', Number(body.season_id));
    if (!league || !season) throw bad('Competición o temporada inválida');
    let start = null;
    if (body.start) { if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start)) throw bad('Fecha de inicio inválida'); start = body.start; }
    const time = /^\d{2}:\d{2}$/.test(body.time || '') ? body.time : '20:00';
    const days = Math.min(60, Math.max(1, Number(body.days) || 7));
    const existing = get('SELECT COUNT(*) c FROM matches WHERE season_id=? AND league_id=?', season.id, league.id).c;
    if (body.replace) run('DELETE FROM matches WHERE season_id=? AND league_id=? AND played=0', season.id, league.id);
    else if (existing) throw bad('Ya hay partidos en esta competición. Marca "reemplazar partidos sin jugar" para regenerar.');
    const n = generate(season.id, league, { double: !!body.double, start, days, time });
    return json(res, 200, { created: n });
  }
  if (method === 'POST' && parts[0] === 'round-date') {
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(body.date || '')) throw bad('Fecha inválida');
    const date = body.date.length === 10 ? body.date + 'T20:00' : body.date;
    const r = run('UPDATE matches SET match_date=? WHERE season_id=? AND league_id=? AND round=?', date, Number(body.season_id), Number(body.league_id), Number(body.round));
    return json(res, 200, { updated: r.changes });
  }
  if (method === 'POST' && parts[0] === 'comp-teams') {
    const league = get("SELECT id FROM leagues WHERE id = ? AND kind = 'COPA'", Number(body.league_id));
    if (!league) throw bad('Solo las copas admiten selección manual de equipos');
    const ids = [...new Set((body.team_ids || []).map(Number))].filter(Number.isInteger);
    tx(() => { run('DELETE FROM competition_teams WHERE league_id=?', league.id); for (const t of ids) run('INSERT INTO competition_teams VALUES (?,?)', league.id, t); });
    return json(res, 200, { ok: true });
  }
  if (method === 'POST' && parts[0] === 'player-stats') {
    const n = k => { const v = Number(body[k] || 0); if (!Number.isInteger(v) || v < 0 || v > 9999) throw bad('Estadística inválida'); return v; };
    run('INSERT INTO player_stats (player_id, season_id, apps, goals, assists) VALUES (?,?,?,?,?) ON CONFLICT(player_id, season_id) DO UPDATE SET apps=excluded.apps, goals=excluded.goals, assists=excluded.assists',
      Number(body.player_id), Number(body.season_id), n('apps'), n('goals'), n('assists'));
    return json(res, 200, { ok: true });
  }
  if (method === 'POST' && parts[0] === 'squad') {
    const m = get('SELECT * FROM matches WHERE id = ?', Number(body.match_id));
    const teamId = Number(body.team_id);
    if (!m || (m.home_id !== teamId && m.away_id !== teamId)) throw bad('El equipo no participa en ese partido');
    const formation = body.formation ? String(body.formation).slice(0, 20) : null;
    const coach = body.coach ? String(body.coach).slice(0, 120) : null;
    const list = Array.isArray(body.players) ? body.players.slice(0, 60) : [];
    tx(() => {
      run('DELETE FROM squads WHERE match_id=? AND team_id=?', m.id, teamId);
      const cap = list.some(x => Number(x.player_id) === Number(body.captain_id)) ? Number(body.captain_id) : null;
      const sid = run('INSERT INTO squads (match_id, team_id, formation, coach, captain_id) VALUES (?,?,?,?,?)', m.id, teamId, formation, coach, cap).lastInsertRowid;
      list.forEach((x, i) => {
        const pl = get('SELECT id FROM players WHERE id=? AND team_id=?', Number(x.player_id), teamId);
        if (pl) run('INSERT OR IGNORE INTO squad_players (squad_id, player_id, starter, sort_order) VALUES (?,?,?,?)', sid, pl.id, x.starter ? 1 : 0, i);
      });
    });
    return json(res, 200, { ok: true });
  }
  if (method === 'DELETE' && parts[0] === 'squad') {
    run('DELETE FROM squads WHERE match_id=? AND team_id=?', Number(url.searchParams.get('match_id')), Number(url.searchParams.get('team_id')));
    return json(res, 200, { ok: true });
  }

  // ----- CRUD genérico -----
  const table = parts[0];
  if (!TABLES[table]) throw new HttpError(404, 'No encontrado');
  const id = parts[1] ? Number(parts[1]) : null;

  if (method === 'POST' && !id) {
    const d = clean(table, body, false);
    const result = tx(() => {
      if (table === 'seasons' && d.is_current) run('UPDATE seasons SET is_current=0');
      const cols = Object.keys(d);
      const r = run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(c => d[c]));
      return r.lastInsertRowid;
    });
    return json(res, 201, { id: Number(result) });
  }
  if (method === 'PUT' && id) {
    const d = clean(table, body, true);
    const cols = Object.keys(d);
    if (!cols.length) throw bad('Sin cambios');
    tx(() => {
      if (table === 'seasons' && d.is_current) run('UPDATE seasons SET is_current=0');
      run(`UPDATE ${table} SET ${cols.map(c => c + '=?').join(',')} WHERE id=?`, ...cols.map(c => d[c]), id);
    });
    return json(res, 200, { ok: true });
  }
  if (method === 'DELETE' && id) {
    if (table === 'seasons') {
      const s = get('SELECT * FROM seasons WHERE id=?', id);
      if (s && s.is_current) throw bad('No puedes eliminar la temporada actual');
      if (get('SELECT COUNT(*) c FROM seasons').c <= 1) throw bad('Debe existir al menos una temporada');
    }
    run(`DELETE FROM ${table} WHERE id=?`, id);
    return json(res, 200, { ok: true });
  }
  throw new HttpError(404, 'No encontrado');
}

// ---------- archivos estáticos ----------
function serveFile(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res, req);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido');
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (_) { throw bad('Ruta inválida'); }
    if (rel.includes('\0')) throw bad('Ruta inválida');
    if (rel.startsWith('/uploads/')) {
      const f = path.join(UPLOADS, path.basename(rel));
      if (!/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(path.basename(rel))) throw new HttpError(404, 'No encontrado');
      return serveFile(req, res, f, 'public, max-age=31536000, immutable');
    }
    if (rel === '/') rel = '/index.html';
    const f = path.normalize(path.join(PUBLIC, rel));
    if (!f.startsWith(PUBLIC + path.sep)) throw new HttpError(404, 'No encontrado');
    return serveFile(req, res, f, rel === '/index.html' ? 'no-cache' : 'public, max-age=300');
  } catch (e) {
    const err = dbError(e);
    if (!res.headersSent) json(res, err.status, { error: err.message });
  }
});
server.requestTimeout = 30000;
server.listen(PORT, () => console.log(`STF web escuchando en http://localhost:${PORT}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
