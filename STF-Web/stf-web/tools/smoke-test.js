'use strict';
// Prueba de humo: arranca el servidor en un directorio temporal y recorre API y vistas.
// Uso: STF_TEST_USER=... STF_TEST_PASS=... node tools/smoke-test.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const PORT = 3900 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-test-'));
const USER = process.env.STF_TEST_USER || 'stf_director', PASS = process.env.STF_TEST_PASS;
let ok = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { ok++; } else { fail++; console.log('FALLA:', name, extra ?? ''); } };

async function call(method, url, body, cookie, headers = {}) {
  const h = { 'X-Requested-With': 'stf', ...headers };
  if (cookie) h.Cookie = cookie;
  let b; if (body instanceof Buffer) b = body; else if (body !== undefined) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(BASE + url, { method, headers: h, body: b });
  let data = null; const txt = await r.text(); try { data = JSON.parse(txt); } catch (_) { data = txt; }
  return { status: r.status, data, headers: r.headers };
}

(async () => {
  const srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, DATA_DIR: DATA }, stdio: 'pipe' });
  srv.stderr.on('data', () => {});
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/health'); break; } catch (_) { await new Promise(r => setTimeout(r, 100)); } }
  try {
    // --- público ---
    const st = await call('GET', '/api/state');
    t('estado 200', st.status === 200);
    const S = st.data;
    t('32 equipos', S.teams.length === 32, S.teams.length);
    t('Getafe presente', S.teams.some(x => x.name === 'Getafe CF' && /2922/.test(x.crest)));
    t('Tiburones ausente', !S.teams.some(x => /Tiburones/.test(x.name)));
    t('6 competiciones', S.leagues.length === 6);
    t('112 partidos', S.matches.length === 112, S.matches.length);
    t('cabeceras de seguridad', /default-src 'self'/.test(st.headers.get('content-security-policy')) && st.headers.get('x-content-type-options') === 'nosniff');
    t('sin cookie no hay admin', st.data.admin === null);
    const idx = await fetch(BASE + '/'); t('index 200', idx.status === 200);
    t('app.js 200', (await fetch(BASE + '/app.js')).status === 200);
    t('path traversal bloqueado', (await fetch(BASE + '/..%2f..%2fserver.js')).status === 404 && (await fetch(BASE + '/%2e%2e/server.js')).status !== 200);
    t('data/ no expuesto', (await fetch(BASE + '/uploads/../stf.db')).status === 404);

    // --- seguridad admin ---
    t('admin sin sesión 401', (await call('POST', '/api/admin/news', { title: 'x' })).status === 401);
    t('CSRF sin header 403', (await fetch(BASE + '/api/admin/news', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
    t('origen ajeno 403', (await call('POST', '/api/login', { username: USER, password: 'x' }, null, { Origin: 'http://evil.example' })).status === 403);
    t('login falso 401', (await call('POST', '/api/login', { username: USER, password: 'incorrecta' })).status === 401);
    t('contraseña vieja no sirve', (await call('POST', '/api/login', { username: 'adminstf1', password: '12345678' })).status === 401);
    const login = await call('POST', '/api/login', { username: USER, password: PASS });
    t('login correcto', login.status === 200, JSON.stringify(login.data));
    const setc = login.headers.get('set-cookie') || '';
    t('cookie HttpOnly+SameSite', /HttpOnly/.test(setc) && /SameSite=Strict/.test(setc));
    const ck = setc.split(';')[0];
    t('estado con admin', (await call('GET', '/api/state', undefined, ck)).data.admin === USER);

    // --- CRUD ---
    const tm = await call('POST', '/api/admin/teams', { name: 'Equipo Prueba', short_name: 'EQP', league_id: 1, crest: 'javascript:alert(1)' }, ck);
    t('crest javascript: rechazado', tm.status === 400, JSON.stringify(tm.data));
    const tm2 = await call('POST', '/api/admin/teams', { name: 'Equipo Prueba', short_name: 'EQP', league_id: 1 }, ck);
    t('equipo creado', tm2.status === 201);
    t('equipo duplicado 409', (await call('POST', '/api/admin/teams', { name: 'Equipo Prueba' }, ck)).status === 409);
    // subida
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const up = await call('POST', '/api/admin/upload', png, ck, { 'Content-Type': 'application/octet-stream' });
    t('subida png', up.status === 201 && /^\/uploads\/[a-f0-9]{32}\.png$/.test(up.data.url), JSON.stringify(up.data));
    const img = await fetch(BASE + up.data.url); t('imagen servida', img.status === 200 && img.headers.get('content-type') === 'image/png');
    t('subida no-imagen rechazada', (await call('POST', '/api/admin/upload', Buffer.from('<svg onload=alert(1)></svg>'), ck, { 'Content-Type': 'application/octet-stream' })).status === 400);
    t('subida sin sesión 401', (await call('POST', '/api/admin/upload', png, null, { 'Content-Type': 'application/octet-stream' })).status === 401);
    t('asignar escudo subido', (await call('PUT', `/api/admin/teams/${tm2.data.id}`, { crest: up.data.url }, ck)).status === 200);
    // resultado
    const m = S.matches[0];
    t('resultado sin marcador 400', (await call('PUT', `/api/admin/matches/${m.id}`, { played: true }, ck)).status === 400);
    t('publicar resultado', (await call('PUT', `/api/admin/matches/${m.id}`, { home_goals: 3, away_goals: 1, played: true }, ck)).status === 200);
    const S2 = (await call('GET', '/api/state')).data;
    t('resultado visible', S2.matches.find(x => x.id === m.id).played === 1);
    // fixtures
    const gen = await call('POST', '/api/admin/fixtures', { season_id: S.seasonId, league_id: 1, start: '2026-12-01', replace: true, double: true, days: 7, time: '19:00' }, ck);
    t('fixture ida y vuelta (8 equipos + nuevo = 9 → impar)', gen.status === 200 && gen.data.created > 0, JSON.stringify(gen.data));
    // copa
    const cup = S.leagues.find(l => l.kind === 'COPA');
    t('equipos de copa', (await call('POST', '/api/admin/comp-teams', { league_id: cup.id, team_ids: [1, 2, 3, 4] }, ck)).status === 200);
    t('comp-teams en liga rechazado', (await call('POST', '/api/admin/comp-teams', { league_id: 1, team_ids: [1] }, ck)).status === 400);
    // squad
    const pl = await call('POST', '/api/admin/players', { name: 'Jugador Uno', team_id: m.home_id, number: 7, position: 'Delantero' }, ck);
    t('jugador creado', pl.status === 201);
    t('squad guardada', (await call('POST', '/api/admin/squad', { match_id: m.id, team_id: m.home_id, formation: '4-3-3', coach: 'DT', captain_id: pl.data.id, players: [{ player_id: pl.data.id, starter: true }] }, ck)).status === 200);
    t('squad equipo ajeno 400', (await call('POST', '/api/admin/squad', { match_id: m.id, team_id: 31, players: [] }, ck)).status === 400);
    t('stats jugador', (await call('POST', '/api/admin/player-stats', { player_id: pl.data.id, season_id: S.seasonId, apps: 1, goals: 2, assists: 0 }, ck)).status === 200);
    t('noticia', (await call('POST', '/api/admin/news', { title: 'Prueba <b>', content: 'x', image: 'https://example.com/a.png' }, ck)).status === 201);
    t('honor', (await call('POST', '/api/admin/honors', { season_id: S.seasonId, kind: 'Liga', competition: 'LPF', champion_id: 1 }, ck)).status === 201);
    t('regla', (await call('POST', '/api/admin/rules', { category: 'General', title: 'R1', content: 'c' }, ck)).status === 201);
    t('ajustes', (await call('POST', '/api/admin/settings', { points_win: 3, points_draw: 1, points_loss: 0, tiebreakers: 'DG,GF' }, ck)).status === 200);
    t('ajustes inválidos', (await call('POST', '/api/admin/settings', { tiebreakers: 'XX' }, ck)).status === 400);
    t('temporada actual no se borra', (await call('DELETE', `/api/admin/seasons/${S.seasonId}`, undefined, ck)).status === 400);
    t('tabla desconocida 404', (await call('POST', '/api/admin/admin_users', { username: 'x' }, ck)).status === 404);
    t('borrar equipo', (await call('DELETE', `/api/admin/teams/${tm2.data.id}`, undefined, ck)).status === 200);

    // --- vistas del cliente con DOM simulado ---
    const els = {};
    const el = () => ({ innerHTML: '', textContent: '', hidden: false, value: '', classList: { toggle() {}, remove() {}, add() {} }, addEventListener() {}, appendChild() {}, querySelector: () => el(), querySelectorAll: () => [] });
    const ctx = { window: { __STF_TEST__: true, scrollY: 0, scrollTo() {} }, location: { hash: '#/' }, history: { length: 1, back() {} }, document: { querySelector: s => els[s] || (els[s] = el()), querySelectorAll: () => [], addEventListener() {}, createElement: () => el() },
      fetch: (u, o) => fetch(BASE + u, o), console, setTimeout, FormData: class {}, confirm: () => true };
    ctx.window.scrollY = 0; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), ctx);
    await vm.runInContext('load()', ctx);
    const routes = ['#/', '#/noticias', '#/noticia/1', '#/ligas', '#/liga/1', '#/liga/3/fixture', '#/liga/1/resultados', '#/liga/1/proxima', '#/liga/1/stats', '#/liga/1/equipos', '#/liga/5', '#/resultados', '#/fixtures', '#/equipos', '#/equipo/1', '#/partido/1', '#/squadsheets', `#/squad/${m.id}`, '#/estadisticas', '#/palmares', '#/reglamento', '#/buscar/getafe', '#/buscar/%3Cscript%3E', '#/noexiste', '#/liga/999', '#/equipo/999', '#/admin'];
    for (const r of routes) { try { const out = vm.runInContext(`view(${JSON.stringify(r)})`, ctx); t('vista ' + r, typeof out[1] === 'string' && out[1].length > 20 && !/undefined|NaN|\[object/.test(out[1].replace(/Sin liga/g, '')), out[1].slice(0, 150)); } catch (e) { t('vista ' + r, false, e.stack.split('\n').slice(0, 3).join(' | ')); } }
    t('XSS escapado en búsqueda', !vm.runInContext('view("#/buscar/%3Cscript%3Ex")', ctx)[1].includes('<script>'));
    // vistas admin (requieren sesión): simulamos S.admin
    vm.runInContext('S.admin="x"', ctx);
    for (const tab of ['partidos', 'fixtures', 'squads', 'comps', 'equipos', 'jugadores', 'noticias', 'palmares', 'reglas', 'temporadas', 'ajustes']) {
      try { const out = vm.runInContext(`view("#/admin/${tab}")`, ctx); t('admin ' + tab, out[1].length > 100 && !/\[object|NaN/.test(out[1]), out[1].slice(0, 150)); } catch (e) { t('admin ' + tab, false, e.stack.split('\n').slice(0, 3).join(' | ')); }
    }
    vm.runInContext(`ui.sqMatch=${m.id}; ui.admLeague=String(${m.league_id})`, ctx);
    t('editor squads', vm.runInContext('view("#/admin/squads")', ctx)[1].includes('Guardar squadsheet'));
    t('formularios por tabla', ['news', 'teams', 'players', 'matches', 'honors', 'rules', 'leagues', 'seasons'].every(x => { vm.runInContext(`fieldsFor("${x}").map(f=>fieldHtml(f,""))`, ctx); return true; }));
  } catch (e) { fail++; console.log('EXCEPCIÓN', e); }
  srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(`\n${ok} pruebas correctas, ${fail} fallidas`);
  process.exit(fail ? 1 : 0);
})();
