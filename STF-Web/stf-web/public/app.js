'use strict';
/* STF · Superliga de Touch Football — cliente (SPA sin dependencias) */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NEWS_CATS = ['Anuncios de competición', 'Comunicados oficiales', 'Resultados', 'Fichajes', 'Entrevistas', 'Análisis'];
const RULE_CATS = ['General', 'Competición', 'Partidos', 'Disciplina', 'Fichajes'];
const POSITIONS = ['Portero', 'Defensa', 'Mediocampista', 'Delantero'];
const FORMATIONS = ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1', '3-4-3', '5-3-2'];
const HONOR_KINDS = ['Liga', 'Copa', 'Supercopa', 'Otro'];
const NAV = [['#/', 'INICIO'], ['#/noticias', 'NOTICIAS'], ['#/ligas', 'LIGAS'], ['#/resultados', 'RESULTADOS'], ['#/fixtures', 'FIXTURES'],
  ['#/equipos', 'EQUIPOS'], ['#/squadsheets', 'SQUADSHEETS'], ['#/estadisticas', 'ESTADÍSTICAS'], ['#/palmares', 'PALMARÉS'], ['#/reglamento', 'REGLAMENTO'], ['#/admin', 'ADMINISTRACIÓN']];

let S = null, M = {};
const ui = { homeLeague: null, resLeague: '', resRound: '', fixLeague: '', fixRound: '', statLeague: '', admTab: 'partidos', adm: {} };

// ---------- datos ----------
async function request(method, url, body, raw) {
  const opt = { method, headers: { 'X-Requested-With': 'stf' }, credentials: 'same-origin' };
  if (raw) opt.body = raw;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  let data = {}; try { data = await r.json(); } catch (_) {}
  if (!r.ok) { const e = new Error(data.error || 'Error ' + r.status); e.status = r.status; throw e; }
  return data;
}
async function load(season) {
  S = await request('GET', '/api/state' + (season ? '?season=' + season : ''));
  M.team = Object.fromEntries(S.teams.map(t => [t.id, t]));
  M.league = Object.fromEntries(S.leagues.map(l => [l.id, l]));
  M.player = Object.fromEntries(S.players.map(p => [p.id, p]));
  M.match = Object.fromEntries(S.matches.map(m => [m.id, m]));
  M.stat = Object.fromEntries(S.playerStats.map(s => [s.player_id, s]));
  const sel = $('#seasonSelect');
  sel.innerHTML = S.seasons.map(s => `<option value="${s.id}" ${s.id === S.seasonId ? 'selected' : ''}>${esc(s.name)}${s.is_current ? ' (actual)' : ''}</option>`).join('');
  $('#footSeason').textContent = (S.seasons.find(s => s.id === S.seasonId) || {}).name || '';
  $('#adminPill').hidden = !S.admin;
  if (!ui.homeLeague || !M.league[ui.homeLeague]) ui.homeLeague = (S.leagues.find(l => l.kind === 'LIGA') || {}).id;
}
const leagues = () => S.leagues.filter(l => l.kind !== 'COPA');
const cups = () => S.leagues.filter(l => l.kind === 'COPA');
function leagueTeams(l) {
  if (!l) return [];
  if (l.kind === 'COPA') { const ids = new Set(S.compTeams.filter(c => c.league_id === l.id).map(c => c.team_id)); return S.teams.filter(t => ids.has(t.id)); }
  return S.teams.filter(t => t.league_id === l.id);
}
function standings(leagueId) {
  const L = M.league[leagueId], acc = {};
  for (const t of leagueTeams(L)) acc[t.id] = { id: t.id, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, form: [] };
  const W = +S.settings.points_win, D = +S.settings.points_draw, Lo = +S.settings.points_loss;
  const played = S.matches.filter(m => m.league_id === leagueId && m.played).sort((a, b) => a.round - b.round || a.id - b.id);
  for (const m of played) {
    const h = acc[m.home_id] || (acc[m.home_id] = { id: m.home_id, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, form: [] });
    const a = acc[m.away_id] || (acc[m.away_id] = { id: m.away_id, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, form: [] });
    const hg = m.home_goals || 0, ag = m.away_goals || 0;
    h.pj++; a.pj++; h.gf += hg; h.gc += ag; a.gf += ag; a.gc += hg;
    if (hg > ag) { h.g++; a.p++; h.form.push('w'); a.form.push('l'); } else if (hg < ag) { a.g++; h.p++; h.form.push('l'); a.form.push('w'); } else { h.e++; a.e++; h.form.push('d'); a.form.push('d'); }
  }
  const rows = Object.values(acc).map(r => ({ ...r, dg: r.gf - r.gc, pts: r.g * W + r.e * D + r.p * Lo }));
  const tb = (S.settings.tiebreakers || 'DG,GF,GC').split(',');
  rows.sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    for (const c of tb) { const d = c === 'DG' ? y.dg - x.dg : c === 'GF' ? y.gf - x.gf : c === 'GC' ? x.gc - y.gc : c === 'PG' ? y.g - x.g : 0; if (d) return d; }
    return (M.team[x.id]?.name || '').localeCompare(M.team[y.id]?.name || '');
  });
  return rows;
}

// ---------- formato ----------
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'], MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtDate(s, long) {
  if (!s) return 'Fecha por definir';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s); if (!m) return esc(s);
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const base = `${long ? DAYS[d.getDay()] + ' ' : ''}${+m[3]} ${MONTHS[+m[2] - 1]}${long ? ' ' + m[1] : ''}`;
  return m[4] ? `${base} · ${m[4]}:${m[5]}` : base;
}
const fmtDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : ''; };
const safeUrl = u => (/^(https?:\/\/|\/uploads\/)/i.test(u || '') ? u : '');
function crest(t, size = 28) {
  if (!t) return `<span class="crest-fb" style="width:${size}px;height:${size}px">?</span>`;
  const fb = `<span class="crest-fb" style="width:${size}px;height:${size}px;font-size:${Math.max(9, size * .36)}px">${esc((t.short_name || t.name).slice(0, 3).toUpperCase())}</span>`;
  const u = safeUrl(t.crest);
  return u ? `<img class="crest" src="${esc(u)}" width="${size}" height="${size}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fb="1">` + `<template>${fb}</template>` : fb;
}
const tl = (t, size = 26) => t ? `<a class="team" href="#/equipo/${t.id}">${crest(t, size)}<span>${esc(t.name)}</span></a>` : '—';
function newsPic(n) { const u = safeUrl(n.image); return u ? `style="background-image:url('${esc(u)}')"` : ''; }
const empty = msg => `<div class="empty">${esc(msg)}</div>`;
const sorted = (a, f) => a.slice().sort(f);

// ---------- componentes ----------
function matchRow(m, opt = {}) {
  const h = M.team[m.home_id], a = M.team[m.away_id], L = M.league[m.league_id];
  const score = m.played ? `<span class="score">${m.home_goals} - ${m.away_goals}</span>` : `<span class="score pend">VS</span>`;
  return `<a class="match" href="#/partido/${m.id}">
    <span class="t r">${esc(h?.name)} ${crest(h, 28)}</span>${score}<span class="t">${crest(a, 28)} ${esc(a?.name)}</span>
    <span class="mmeta">${opt.noLeague ? '' : esc(L?.short_name || L?.name) + ' · '}Jornada ${m.round} · ${fmtDate(m.match_date, true)}${m.venue ? ' · ' + esc(m.venue) : ''}</span></a>`;
}
function standingsTable(leagueId, compact) {
  const rows = standings(leagueId);
  if (!rows.length) return empty('Esta competición aún no tiene equipos.');
  const total = rows.length;
  return `<div class="scroll"><table><thead><tr><th>#</th><th class="l">EQUIPO</th><th>PJ</th>${compact ? '' : '<th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th>'}<th>PTS</th>${compact ? '' : '<th>FORMA</th>'}</tr></thead><tbody>
  ${rows.map((r, i) => `<tr><td><span class="pos ${i === 0 ? 'q1' : ''}">${i + 1}</span></td><td class="l">${tl(M.team[r.id], compact ? 22 : 28)}</td><td>${r.pj}</td>
  ${compact ? '' : `<td>${r.g}</td><td>${r.e}</td><td>${r.p}</td><td>${r.gf}</td><td>${r.gc}</td><td>${r.dg > 0 ? '+' : ''}${r.dg}</td>`}<td class="pts">${r.pts}</td>
  ${compact ? '' : `<td><span class="wdl">${r.form.slice(-5).map(f => `<i class="${f}">${f === 'w' ? 'G' : f === 'd' ? 'E' : 'P'}</i>`).join('')}</span></td>`}</tr>`).join('')}</tbody></table></div>${total ? '' : ''}`;
}
function tabsHtml(list, cur, act, extra = '') {
  return `<div class="tabs">${list.map(([v, label]) => `<button class="tab ${String(v) === String(cur) ? 'on' : ''}" data-act="${act}" data-v="${esc(v)}" ${extra}>${esc(label)}</button>`).join('')}</div>`;
}
function topPlayers(key, limit, leagueId) {
  const L = leagueId ? M.league[leagueId] : null, ids = L ? new Set(leagueTeams(L).map(t => t.id)) : null;
  return S.playerStats.filter(s => s[key] > 0 && M.player[s.player_id] && (!ids || ids.has(M.player[s.player_id].team_id)))
    .sort((a, b) => b[key] - a[key] || b.apps - a.apps).slice(0, limit).map(s => ({ p: M.player[s.player_id], v: s[key], apps: s.apps }));
}
function rankCard(title, rows, unit) {
  return `<div class="card"><div class="card-title">${esc(title)}</div>${rows.length ? `<ol class="rank">${rows.map((r, i) => `<li><span class="n">${i + 1}</span>${r.html}<span class="v">${r.v}${unit || ''}</span></li>`).join('')}</ol>` : '<div class="muted small">Sin datos todavía</div>'}</div>`;
}
const playerRank = (rows) => rows.map(r => ({ html: `${crest(M.team[r.p.team_id], 24)}<a href="#/equipo/${r.p.team_id}"><b>${esc(r.p.name)}</b> <span class="muted small">${esc(M.team[r.p.team_id]?.short_name || '')}</span></a>`, v: r.v }));

// ---------- vistas públicas ----------
function vHome() {
  const news = S.news, feat = news.find(n => n.featured) || news[0], others = news.filter(n => n !== feat);
  const side = others.slice(0, 2), latest = others.slice(0, 3);
  const played = sorted(S.matches.filter(m => m.played), (a, b) => (b.result_at || '').localeCompare(a.result_at || '') || b.round - a.round || b.id - a.id);
  const upcoming = sorted(S.matches.filter(m => !m.played), (a, b) => (a.match_date || '9').localeCompare(b.match_date || '9') || a.round - b.round || a.id - b.id).slice(0, 5);
  const heroHtml = feat ? `<a class="hero-main ${newsPic(feat) ? '' : 'nopic'}" ${newsPic(feat)} href="#/noticia/${feat.id}"><div class="hero-txt"><span class="badge">${esc(feat.category || 'NOTICIA')}</span><h1>${esc(feat.title)}</h1><div>${esc(feat.subtitle || '')}</div><div class="muted small">${fmtDay(feat.published)}</div></div></a>` : `<div class="hero-main nopic"><div class="hero-txt"><h1>STF</h1><div>Superliga de Touch Football</div></div></div>`;
  const sideHtml = side.map(n => `<a ${newsPic(n)} href="#/noticia/${n.id}"><div class="hero-txt"><span class="badge">${esc(n.category || 'NOTICIA')}</span><h3>${esc(n.title)}</h3></div></a>`).join('');
  const leaders = leagues().map(l => { const r = standings(l.id)[0]; return r && { l, r }; }).filter(Boolean);
  const season = S.seasons.find(s => s.id === S.seasonId);
  return `<section class="hero">${heroHtml}<div class="side-news">${sideHtml}</div></section>
  <div class="grid g3" style="margin-top:20px">
    <div class="card"><div class="card-title"><span>TABLA</span><a class="gold small" href="#/liga/${ui.homeLeague}">Ver completa →</a></div>
      ${tabsHtml(leagues().map(l => [l.id, l.short_name || l.name]), ui.homeLeague, 'homeLeague')}${ui.homeLeague ? standingsTable(ui.homeLeague, true) : ''}</div>
    <div class="card"><div class="card-title"><span>ÚLTIMO RESULTADO</span></div>${played[0] ? matchRow(played[0]) : empty('Aún no hay resultados')}</div>
    <div class="card"><div class="card-title"><span>PRÓXIMOS PARTIDOS</span><a class="gold small" href="#/fixtures">Fixtures →</a></div>${upcoming.length ? upcoming.map(m => matchRow(m)).join('') : empty('No hay partidos programados')}</div>
  </div>
  <h2>EQUIPOS DESTACADOS</h2>
  ${leaders.length && leaders.some(x => x.r.pj > 0) ? `<div class="grid g4">${leaders.map(({ l, r }) => `<a class="card team-card hov" href="#/equipo/${r.id}">${crest(M.team[r.id], 52)}<div><div class="muted small">Líder · ${esc(l.name)}</div><b>${esc(M.team[r.id].name)}</b><div class="gold">${r.pts} pts</div></div></a>`).join('')}</div>` : `<div class="grid g4">${S.teams.slice(0, 4).map(t => teamCard(t)).join('')}</div>`}
  <div class="grid g2" style="margin-top:6px"><div><h2>GOLEADORES</h2>${rankCard('MÁXIMOS GOLEADORES', playerRank(topPlayers('goals', 5)))}</div>
  <div><h2>INFO DE TEMPORADA</h2><div class="card"><b style="font:24px var(--title)">${esc(season?.name)}</b><p class="muted">Cuatro ligas independientes (${leagues().map(l => esc(l.name)).join(', ')}) y copas continentales. ${S.teams.length} equipos registrados.</p>${statKpis(null)}</div></div></div>
  <h2>ÚLTIMAS NOTICIAS</h2><div class="grid g3">${latest.length ? latest.map(newsCard).join('') : empty('Sin noticias')}</div>`;
}
const newsCard = n => `<a class="card news-card hov" href="#/noticia/${n.id}"><div class="pic ${newsPic(n) ? '' : 'nopic'}" ${newsPic(n)}></div><div class="body"><span class="chip">${esc(n.category || 'Noticia')}</span><h3>${esc(n.title)}</h3><div class="muted small">${esc(n.subtitle || '')}</div><div class="muted small">${fmtDay(n.published)}</div></div></a>`;
function vNews() {
  return `<h1>NOTICIAS</h1>${S.news.length ? `<div class="grid g3" style="margin-top:18px">${S.news.map(newsCard).join('')}</div>` : empty('Aún no hay noticias.')}`;
}
function vNewsDetail(id) {
  const n = S.news.find(x => x.id === +id); if (!n) return notFound();
  return `<button class="back" data-act="back">← Volver</button><article class="article"><span class="badge">${esc(n.category || 'NOTICIA')}</span><h1 style="margin:10px 0">${esc(n.title)}</h1><div class="muted">${esc(n.subtitle || '')} · ${fmtDay(n.published)}</div>${safeUrl(n.image) ? `<img src="${esc(safeUrl(n.image))}" alt="" style="width:100%;border-radius:10px;margin:18px 0" referrerpolicy="no-referrer">` : ''}<p>${esc(n.content || '')}</p></article>`;
}
function vLeagues() {
  const card = l => `<a class="card hov" href="#/liga/${l.id}"><div class="muted small">${esc(l.tagline || '')}</div><h3 style="font-size:26px;color:#fff;margin:4px 0">${esc(l.name)}</h3><div class="muted">${leagueTeams(l).length} equipos</div><div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">${leagueTeams(l).slice(0, 8).map(t => crest(t, 26)).join('')}</div></a>`;
  return `<h1>LIGAS</h1><div class="grid g2" style="margin-top:18px">${leagues().map(card).join('')}</div>${cups().length ? `<h2>COPAS</h2><div class="grid g2">${cups().map(card).join('')}</div>` : ''}`;
}
function vLeague(id, tab = 'tabla') {
  const l = M.league[+id]; if (!l) return notFound();
  const ms = S.matches.filter(m => m.league_id === l.id);
  const rounds = [...new Set(ms.map(m => m.round))].sort((a, b) => a - b);
  const tabs = [['tabla', 'Tabla'], ['fixture', 'Fixture completo'], ['resultados', 'Resultados'], ['proxima', 'Próxima jornada'], ['stats', 'Estadísticas'], ['equipos', 'Equipos']];
  let body = '';
  if (tab === 'tabla') body = l.kind === 'COPA' && !leagueTeams(l).length ? empty('Los equipos de esta copa aún no han sido definidos.') : `<div class="card">${standingsTable(l.id)}</div><p class="muted small">Victoria ${S.settings.points_win} pts · empate ${S.settings.points_draw} · derrota ${S.settings.points_loss}. Desempate: ${esc(S.settings.tiebreakers)}.</p>`;
  else if (tab === 'fixture') body = rounds.length ? rounds.map(r => `<h3 style="margin:18px 0 6px">JORNADA ${r}</h3><div class="card" style="padding:0">${ms.filter(m => m.round === r).map(m => matchRow(m, { noLeague: true })).join('')}</div>`).join('') : empty('Aún no hay fixture para esta competición.');
  else if (tab === 'resultados') { const p = ms.filter(m => m.played).sort((a, b) => b.round - a.round || b.id - a.id); body = p.length ? `<div class="card" style="padding:0">${p.map(m => matchRow(m, { noLeague: true })).join('')}</div>` : empty('Todavía no se han jugado partidos.'); }
  else if (tab === 'proxima') { const next = rounds.find(r => ms.some(m => m.round === r && !m.played)); body = next ? `<h3>JORNADA ${next}</h3><div class="card" style="padding:0;margin-top:8px">${ms.filter(m => m.round === next).map(m => matchRow(m, { noLeague: true })).join('')}</div>` : empty('No hay jornadas pendientes.'); }
  else if (tab === 'stats') body = statsPanel(l.id);
  else body = `<div class="grid g4">${leagueTeams(l).map(teamCard).join('') || empty('Sin equipos')}</div>`;
  return `<button class="back" data-act="back">← Volver</button><div class="muted small">${esc(l.tagline || '')}</div><h1>${esc(l.name)}</h1>
  <div class="tabs">${tabs.map(([k, n]) => `<a class="tab ${k === tab ? 'on' : ''}" href="#/liga/${l.id}/${k}">${n}</a>`).join('')}</div>${body}`;
}
function roundPicker(leagueKey, roundKey, sel) {
  const lid = ui[leagueKey], ms = S.matches.filter(m => !lid || m.league_id === +lid);
  const rounds = [...new Set(ms.map(m => m.round))].sort((a, b) => a - b);
  return `<div class="row"><select data-sel="${leagueKey}"><option value="">Todas las competiciones</option>${S.leagues.map(l => `<option value="${l.id}" ${String(l.id) === String(lid) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
  <select data-sel="${roundKey}"><option value="">Todas las jornadas</option>${rounds.map(r => `<option value="${r}" ${String(r) === String(ui[roundKey]) ? 'selected' : ''}>Jornada ${r}</option>`).join('')}</select></div>`;
}
function filtered(leagueKey, roundKey, played) {
  return S.matches.filter(m => (!ui[leagueKey] || m.league_id === +ui[leagueKey]) && (!ui[roundKey] || m.round === +ui[roundKey]) && (played === null || !!m.played === played));
}
function vResults() {
  const ms = filtered('resLeague', 'resRound', true).sort((a, b) => (b.result_at || '').localeCompare(a.result_at || '') || b.round - a.round || b.id - a.id);
  return `<h1>RESULTADOS</h1><div style="margin:14px 0">${roundPicker('resLeague', 'resRound')}</div>${ms.length ? `<div class="card" style="padding:0">${ms.map(m => matchRow(m)).join('')}</div>` : empty('No hay resultados para este filtro.')}`;
}
function vFixtures() {
  const ms = filtered('fixLeague', 'fixRound', null).sort((a, b) => a.round - b.round || (a.match_date || '9').localeCompare(b.match_date || '9') || a.id - b.id);
  return `<h1>FIXTURES</h1><div style="margin:14px 0">${roundPicker('fixLeague', 'fixRound')}</div>${ms.length ? `<div class="card" style="padding:0">${ms.map(m => matchRow(m)).join('')}</div>` : empty('No hay partidos para este filtro.')}`;
}
function teamCard(t) {
  const L = M.league[t.league_id];
  return `<a class="card team-card hov" href="#/equipo/${t.id}">${crest(t, 48)}<div><b>${esc(t.name)}</b><div class="muted small">${esc(L?.name || 'Sin liga')}</div></div></a>`;
}
function vTeams() {
  return `<h1>EQUIPOS</h1>${leagues().map(l => `<h2>${esc(l.name)}</h2><div class="grid g4">${leagueTeams(l).map(teamCard).join('') || empty('Sin equipos')}</div>`).join('')}
  ${S.teams.some(t => !t.league_id) ? `<h2>SIN LIGA</h2><div class="grid g4">${S.teams.filter(t => !t.league_id).map(teamCard).join('')}</div>` : ''}`;
}
function vTeam(id) {
  const t = M.team[+id]; if (!t) return notFound();
  const L = M.league[t.league_id], st = L ? standings(L.id) : [], pos = st.findIndex(r => r.id === t.id), row = st[pos];
  const ms = S.matches.filter(m => m.home_id === t.id || m.away_id === t.id).sort((a, b) => a.round - b.round);
  const pl = sorted(S.players.filter(p => p.team_id === t.id), (a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || a.number - b.number);
  return `<button class="back" data-act="back">← Volver</button>
  <div class="row" style="gap:20px">${crest(t, 96)}<div><h1>${esc(t.name)}</h1><div class="muted">${esc(L?.name || 'Sin liga')}${t.coach ? ' · DT: ' + esc(t.coach) : ''}</div></div></div>
  ${row ? `<div class="kpis" style="margin-top:18px"><div class="kpi"><b>${pos + 1}º</b>Posición</div><div class="kpi"><b>${row.pts}</b>Puntos</div><div class="kpi"><b>${row.g}-${row.e}-${row.p}</b>G-E-P</div><div class="kpi"><b>${row.gf}:${row.gc}</b>Goles</div></div>` : ''}
  <h2>PLANTILLA</h2>${pl.length ? `<div class="card scroll"><table><thead><tr><th>#</th><th class="l">JUGADOR</th><th>POSICIÓN</th><th>PJ</th><th>GOLES</th><th>ASIST.</th></tr></thead><tbody>${pl.map(p => { const s = M.stat[p.id] || {}; return `<tr><td>${p.number}</td><td class="l"><b>${esc(p.name)}</b></td><td>${esc(p.position || '—')}</td><td>${s.apps || 0}</td><td>${s.goals || 0}</td><td>${s.assists || 0}</td></tr>`; }).join('')}</tbody></table></div>` : empty('Plantilla aún no registrada.')}
  <h2>PARTIDOS</h2>${ms.length ? `<div class="card" style="padding:0">${ms.map(m => matchRow(m)).join('')}</div>` : empty('Sin partidos.')}`;
}
function squadsOf(matchId) { return S.squads.filter(s => s.match_id === matchId); }
function vMatch(id) {
  const m = M.match[+id]; if (!m) return notFound();
  const h = M.team[m.home_id], a = M.team[m.away_id], L = M.league[m.league_id];
  return `<button class="back" data-act="back">← Volver</button><div class="card" style="text-align:center"><div class="muted">${esc(L?.name)} · Jornada ${m.round}</div>
  <div class="row" style="justify-content:center;gap:30px;margin:16px 0"><a href="#/equipo/${h.id}" style="text-align:center">${crest(h, 84)}<h3 style="color:#fff;margin-top:6px">${esc(h.name)}</h3></a>
  <span class="score ${m.played ? '' : 'pend'}" style="font-size:40px;padding:6px 20px">${m.played ? `${m.home_goals} - ${m.away_goals}` : 'VS'}</span>
  <a href="#/equipo/${a.id}" style="text-align:center">${crest(a, 84)}<h3 style="color:#fff;margin-top:6px">${esc(a.name)}</h3></a></div>
  <div class="muted">${fmtDate(m.match_date, true)}${m.venue ? ' · ' + esc(m.venue) : ''}</div>${m.details ? `<p>${esc(m.details)}</p>` : ''}
  ${squadsOf(m.id).length ? `<a class="btn" href="#/squad/${m.id}" style="display:inline-block;margin-top:8px">Ver squadsheets</a>` : '<div class="muted small">Squadsheets aún no publicadas</div>'}</div>`;
}
function vSquadsheets() {
  const ids = [...new Set(S.squads.map(s => s.match_id))].map(i => M.match[i]).filter(Boolean).sort((a, b) => b.round - a.round || b.id - a.id);
  return `<h1>SQUADSHEETS</h1><p class="muted">Alineaciones oficiales publicadas por partido.</p>${ids.length ? `<div class="card" style="padding:0">${ids.map(m => matchRow(m).replace('href="#/partido/', 'href="#/squad/')).join('')}</div>` : empty('Todavía no hay squadsheets publicadas.')}`;
}
function pitch(sq) {
  const sps = S.squadPlayers.filter(x => x.squad_id === sq.id).map(x => ({ ...x, p: M.player[x.player_id] })).filter(x => x.p);
  const starters = sorted(sps.filter(x => x.starter), (a, b) => POSITIONS.indexOf(a.p.position) - POSITIONS.indexOf(b.p.position) || a.sort_order - b.sort_order);
  const bench = sps.filter(x => !x.starter);
  const lines = []; const gk = starters.filter(x => x.p.position === 'Portero'), rest = starters.filter(x => x.p.position !== 'Portero');
  if (gk.length) lines.push(gk);
  const f = (sq.formation || '').split('-').map(Number).filter(n => n > 0);
  let i = 0; if (f.length) { for (const n of f) { lines.push(rest.slice(i, i + n)); i += n; } if (i < rest.length) lines.push(rest.slice(i)); } else lines.push(rest);
  const pl = x => `<div class="pl"><div class="num">${x.p.number}</div><b>${esc(x.p.name)}</b>${sq.captain_id === x.p.id ? ' <span class="gold">©</span>' : ''}</div>`;
  const t = M.team[sq.team_id];
  return `<div class="card"><div class="row">${crest(t, 36)}<h3 style="color:#fff;font-size:20px">${esc(t?.name)}</h3><span class="sp"></span><span class="chip">${esc(sq.formation || 'Sin formación')}</span></div>
  ${sq.coach ? `<div class="muted small" style="margin:6px 0">DT: ${esc(sq.coach)}</div>` : ''}<div class="pitch">${lines.map(l => `<div class="line">${l.map(pl).join('')}</div>`).join('')}</div>
  <h3 style="margin-top:12px">SUPLENTES</h3>${bench.length ? bench.map(x => `<div>${x.p.number} · ${esc(x.p.name)} <span class="muted small">${esc(x.p.position || '')}</span></div>`).join('') : '<div class="muted small">Sin suplentes</div>'}</div>`;
}
function vSquad(id) {
  const m = M.match[+id]; if (!m) return notFound();
  const sq = squadsOf(m.id);
  return `<button class="back" data-act="back">← Volver</button>${matchRow(m)}<div class="grid g2" style="margin-top:16px">${sq.length ? sorted(sq, a => a.team_id === m.home_id ? -1 : 1).map(pitch).join('') : empty('Squadsheets aún no publicadas.')}</div>`;
}
// estadísticas
function statKpis(leagueId) {
  const ms = S.matches.filter(m => m.played && (!leagueId || m.league_id === leagueId)), goals = ms.reduce((s, m) => s + m.home_goals + m.away_goals, 0);
  return `<div class="kpis"><div class="kpi"><b>${ms.length}</b>Partidos jugados</div><div class="kpi"><b>${goals}</b>Goles</div><div class="kpi"><b>${ms.length ? (goals / ms.length).toFixed(2) : '0.00'}</b>Promedio por partido</div><div class="kpi"><b>${S.matches.filter(m => !m.played && (!leagueId || m.league_id === leagueId)).length}</b>Por jugar</div></div>`;
}
function statsPanel(leagueId) {
  const rows = (leagueId ? [leagueId] : leagues().map(l => l.id)).flatMap(id => standings(id).map(r => ({ ...r, t: M.team[r.id] }))).filter(r => r.t);
  const rk = (key, dir, unit, filter) => rows.filter(filter || (() => true)).sort((a, b) => dir * (b[key] - a[key]) || a.t.name.localeCompare(b.t.name)).slice(0, 5).map(r => ({ html: `${crest(r.t, 24)}<a href="#/equipo/${r.id}"><b>${esc(r.t.name)}</b></a>`, v: r[key] }));
  const played = rows.some(r => r.pj > 0), maxGf = Math.max(1, ...rows.map(r => r.gf));
  const streaks = {};
  for (const m of S.matches.filter(m => m.played && (!leagueId || m.league_id === leagueId)).sort((a, b) => a.round - b.round || a.id - b.id)) {
    for (const [tid, won] of [[m.home_id, m.home_goals > m.away_goals], [m.away_id, m.away_goals > m.home_goals]]) { const s = streaks[tid] || (streaks[tid] = { best: 0, cur: 0 }); if (won) { s.cur++; s.best = Math.max(s.best, s.cur); } else s.cur = 0; }
  }
  const streakRows = Object.entries(streaks).filter(([, s]) => s.best > 0).sort((a, b) => b[1].best - a[1].best).slice(0, 5).map(([id, s]) => ({ html: `${crest(M.team[id], 24)}<b>${esc(M.team[id]?.name)}</b>`, v: s.best }));
  return `${statKpis(leagueId)}<div class="grid g3" style="margin-top:16px">
  ${rankCard('GOLEADORES', playerRank(topPlayers('goals', 5, leagueId)))}${rankCard('ASISTENCIAS', playerRank(topPlayers('assists', 5, leagueId)))}${rankCard('MEJOR RACHA DE VICTORIAS', streakRows)}
  ${rankCard('MEJOR ATAQUE (GF)', played ? rk('gf', 1, '', r => r.pj > 0) : [])}${rankCard('MEJOR DEFENSA (GC)', played ? rk('gc', -1, '', r => r.pj > 0) : [])}${rankCard('MÁS VICTORIAS', played ? rk('g', 1, '', r => r.pj > 0) : [])}</div>
  <h2>GOLES A FAVOR POR EQUIPO</h2><div class="card">${played ? sorted(rows, (a, b) => b.gf - a.gf).map(r => `<div class="row" style="margin:6px 0"><span style="width:200px">${esc(r.t.name)}</span><div class="bar sp"><i style="width:${r.gf / maxGf * 100}%"></i></div><b class="gold" style="width:30px;text-align:right">${r.gf}</b></div>`).join('') : '<div class="muted">Sin datos todavía</div>'}</div>`;
}
function vStats() {
  return `<h1>ESTADÍSTICAS</h1><div style="margin:14px 0"><select data-sel="statLeague"><option value="">Todas las ligas</option>${S.leagues.map(l => `<option value="${l.id}" ${String(l.id) === String(ui.statLeague) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>${statsPanel(ui.statLeague ? +ui.statLeague : null)}`;
}
function vHonors() {
  const hs = S.honors;
  return `<h1>PALMARÉS</h1><p class="muted">Historial oficial de campeones. Solo se muestran títulos registrados por la organización.</p>${hs.length ? S.seasons.filter(s => hs.some(h => h.season_id === s.id)).map(s => `<h2>${esc(s.name)}</h2><div class="grid g3">${hs.filter(h => h.season_id === s.id).map(h => `<div class="card"><span class="chip">${esc(h.kind)}</span><h3 style="color:#fff;font-size:20px;margin:6px 0">${esc(h.competition)}</h3><div class="row">${crest(M.team[h.champion_id], 40)}<div><div class="gold small">CAMPEÓN</div><b>${esc(M.team[h.champion_id]?.name || '—')}</b></div></div>${h.runner_up_id ? `<div class="muted small" style="margin-top:8px">Subcampeón: ${esc(M.team[h.runner_up_id]?.name || '—')}</div>` : ''}${h.notes ? `<p class="muted small">${esc(h.notes)}</p>` : ''}</div>`).join('')}</div>`).join('') : empty('Aún no hay campeones registrados.')}`;
}
function vRules() {
  const cats = [...new Set(S.rules.map(r => r.category))];
  return `<h1>REGLAMENTO</h1>${cats.length ? cats.map(c => `<h2>${esc(c)}</h2>${S.rules.filter(r => r.category === c).map(r => `<details class="card" style="margin-bottom:8px"><summary style="cursor:pointer;font-weight:700">${esc(r.title)}</summary><p style="white-space:pre-wrap;color:#ddd">${esc(r.content || '')}</p></details>`).join('')}`).join('') : empty('El reglamento aún no ha sido publicado.')}`;
}
function vSearch(q) {
  q = decodeURIComponent(q || '').trim().toLowerCase();
  const inc = s => String(s || '').toLowerCase().includes(q);
  const teams = S.teams.filter(t => inc(t.name) || inc(t.short_name)), players = S.players.filter(p => inc(p.name)).slice(0, 30);
  const news = S.news.filter(n => inc(n.title) || inc(n.subtitle) || inc(n.content)), lgs = S.leagues.filter(l => inc(l.name));
  const none = !teams.length && !players.length && !news.length && !lgs.length;
  return `<h1>BÚSQUEDA</h1><p class="muted">Resultados para “${esc(q)}”</p>${none ? empty('Sin resultados.') : ''}
  ${lgs.length ? `<h2>COMPETICIONES</h2><div class="grid g4">${lgs.map(l => `<a class="card hov" href="#/liga/${l.id}"><b>${esc(l.name)}</b></a>`).join('')}</div>` : ''}
  ${teams.length ? `<h2>EQUIPOS</h2><div class="grid g4">${teams.map(teamCard).join('')}</div>` : ''}
  ${players.length ? `<h2>JUGADORES</h2><div class="card">${players.map(p => `<div class="row" style="padding:6px 0">${crest(M.team[p.team_id], 24)}<b>${esc(p.name)}</b><span class="muted small">${esc(M.team[p.team_id]?.name || '')} · ${esc(p.position || '')}</span></div>`).join('')}</div>` : ''}
  ${news.length ? `<h2>NOTICIAS</h2><div class="grid g3">${news.map(newsCard).join('')}</div>` : ''}`;
}
const notFound = () => `<h1>NO ENCONTRADO</h1><p class="muted">La página que buscas no existe.</p><a class="btn" href="#/">Ir al inicio</a>`;

// ---------- utilidades de interfaz ----------
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3200);
}
async function attempt(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok, 'ok'); await load(S.seasonId); render(true); return r; }
  catch (e) { toast(e.message, 'err'); if (e.status === 401) { await load(S.seasonId); render(true); } return null; }
}
const dlg = () => $('#dlg');
function closeDlg() { if (dlg().open) dlg().close(); }
let curForm = null;
function fieldHtml(f, v) {
  const val = v ?? '', full = f.full ? ' full' : '', req = f.req ? 'required' : '';
  const lab = inner => `<label class="fl${full}">${esc(f.label)}${f.req ? ' *' : ''}${inner}</label>`;
  switch (f.t) {
    case 'area': return lab(`<textarea name="${f.k}" ${req} maxlength="20000">${esc(val)}</textarea>`);
    case 'num': return lab(`<input type="number" name="${f.k}" value="${esc(val)}" step="1" ${req}>`);
    case 'dt': return lab(`<input type="datetime-local" name="${f.k}" value="${esc(String(val).slice(0, 16))}">`);
    case 'date': return lab(`<input type="date" name="${f.k}" value="${esc(String(val).slice(0, 10))}">`);
    case 'sel': return lab(`<select name="${f.k}" ${req}>${f.blank === false ? '' : '<option value="">—</option>'}${f.opts().map(([a, b]) => `<option value="${esc(a)}" ${String(a) === String(val) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`);
    case 'chk': return `<label class="ck${full}"><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    case 'crest': return `<div class="full"><div class="fl" style="margin-bottom:4px">${esc(f.label)}</div><div class="crest-pick"><span data-prev>${safeUrl(val) ? `<img class="crest" src="${esc(safeUrl(val))}" width="56" height="56" alt="" referrerpolicy="no-referrer">` : '<span class="crest-fb" style="width:56px;height:56px">?</span>'}</span>
      <input type="text" name="${f.k}" value="${esc(val)}" placeholder="https://… (opcional)" style="flex:1;min-width:180px" maxlength="1000"><label class="btn ghost sm" style="cursor:pointer">Subir imagen desde mi equipo<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-upload hidden></label></div>
      <div class="muted small" style="margin-top:4px">PNG, JPG, GIF o WEBP de hasta 2 MB. La imagen subida se guarda en el servidor y se muestra a todos.</div></div>`;
    default: return lab(`<input type="text" name="${f.k}" value="${esc(val)}" ${req} maxlength="500">`);
  }
}
function openForm(title, fields, values, submit, sub = 'Guardar') {
  curForm = { fields, submit };
  dlg().innerHTML = `<h3>${esc(title)}</h3><form class="f" data-form="dlg"><div class="form-grid">${fields.map(f => fieldHtml(f, values[f.k])).join('')}</div>
  <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="closeDlg">Cancelar</button><button class="btn" type="submit">${esc(sub)}</button></div></form>`;
  dlg().showModal();
}
function collect(fields, form) {
  const o = {};
  for (const f of fields) {
    const el = form.elements[f.k]; if (!el) continue;
    if (f.t === 'chk') o[f.k] = el.checked;
    else if (f.t === 'num') o[f.k] = el.value === '' ? null : Number(el.value);
    else o[f.k] = el.value.trim() === '' ? null : el.value.trim();
  }
  return o;
}
const optList = (arr, v, l) => () => arr.map(x => [x[v], typeof l === 'function' ? l(x) : x[l]]);
const strOpts = arr => () => arr.map(x => [x, x]);

// ---------- administración ----------
function fieldsFor(table) {
  const teamOpts = optList(sorted(S.teams, (a, b) => a.name.localeCompare(b.name)), 'id', 'name');
  return {
    news: [{ k: 'title', label: 'Título', req: 1, full: 1 }, { k: 'subtitle', label: 'Subtítulo', full: 1 }, { k: 'category', label: 'Categoría', t: 'sel', opts: strOpts(NEWS_CATS), blank: false }, { k: 'published', label: 'Fecha', t: 'date' },
      { k: 'image', label: 'Imagen de portada', t: 'crest' }, { k: 'content', label: 'Contenido', t: 'area', full: 1 }, { k: 'featured', label: 'Noticia destacada (portada)', t: 'chk', full: 1 }],
    teams: [{ k: 'name', label: 'Nombre del equipo', req: 1 }, { k: 'short_name', label: 'Abreviatura (3 letras)' }, { k: 'league_id', label: 'Liga', t: 'sel', opts: optList(leagues(), 'id', 'name') }, { k: 'coach', label: 'Director técnico' }, { k: 'crest', label: 'Escudo', t: 'crest' }],
    players: [{ k: 'name', label: 'Nombre', req: 1, full: 1 }, { k: 'team_id', label: 'Equipo', t: 'sel', opts: teamOpts }, { k: 'number', label: 'Número', t: 'num' }, { k: 'position', label: 'Posición', t: 'sel', opts: strOpts(POSITIONS) }],
    matches: [{ k: 'league_id', label: 'Competición', t: 'sel', req: 1, blank: false, opts: optList(S.leagues, 'id', 'name') }, { k: 'round', label: 'Jornada', t: 'num', req: 1 },
      { k: 'home_id', label: 'Local', t: 'sel', req: 1, opts: teamOpts }, { k: 'away_id', label: 'Visitante', t: 'sel', req: 1, opts: teamOpts },
      { k: 'home_goals', label: 'Goles local', t: 'num' }, { k: 'away_goals', label: 'Goles visitante', t: 'num' }, { k: 'played', label: 'Partido jugado (publica el resultado)', t: 'chk', full: 1 },
      { k: 'match_date', label: 'Fecha y hora', t: 'dt' }, { k: 'venue', label: 'Sede' }, { k: 'details', label: 'Detalles', t: 'area', full: 1 }],
    honors: [{ k: 'kind', label: 'Tipo', t: 'sel', opts: strOpts(HONOR_KINDS), blank: false }, { k: 'competition', label: 'Competición', req: 1 }, { k: 'season_id', label: 'Temporada', t: 'sel', req: 1, blank: false, opts: optList(S.seasons, 'id', 'name') },
      { k: 'champion_id', label: 'Campeón', t: 'sel', opts: teamOpts }, { k: 'runner_up_id', label: 'Subcampeón', t: 'sel', opts: teamOpts }, { k: 'notes', label: 'Notas', t: 'area', full: 1 }],
    rules: [{ k: 'category', label: 'Categoría', t: 'sel', opts: strOpts(RULE_CATS), blank: false }, { k: 'sort_order', label: 'Orden', t: 'num' }, { k: 'title', label: 'Título', req: 1, full: 1 }, { k: 'content', label: 'Contenido', t: 'area', full: 1 }],
    leagues: [{ k: 'name', label: 'Nombre', req: 1 }, { k: 'short_name', label: 'Abreviatura' }, { k: 'tagline', label: 'Descripción corta' }, { k: 'sort_order', label: 'Orden', t: 'num' }, { k: 'kind', label: 'Tipo', t: 'sel', blank: false, opts: () => [['LIGA', 'Liga'], ['COPA', 'Copa']] }],
    seasons: [{ k: 'name', label: 'Nombre de la temporada', req: 1, full: 1 }, { k: 'is_current', label: 'Temporada actual', t: 'chk', full: 1 }],
  }[table];
}
const LABEL = { news: 'noticia', teams: 'equipo', players: 'jugador', matches: 'partido', honors: 'título', rules: 'regla', leagues: 'competición', seasons: 'temporada' };
function openEntity(table, id, defaults = {}) {
  const row = id ? S[table].find(r => r.id === id) : defaults;
  if (!row) return;
  const nums = ['home_goals', 'away_goals'];
  openForm((id ? 'Editar ' : 'Nuevo ') + LABEL[table], fieldsFor(table), row, async data => {
    const body = { ...data, ...(id ? {} : defaults) };
    if (table === 'matches') for (const k of nums) if (!body.played) { /* los marcadores solo cuentan si está jugado */ }
    await attempt(() => id ? request('PUT', `/api/admin/${table}/${id}`, body) : request('POST', `/api/admin/${table}`, body), id ? 'Cambios guardados' : 'Creado correctamente');
    closeDlg();
  });
}
function entTable(table, rows, cols, extra) {
  if (!rows.length) return empty('Aún no hay registros.');
  return `<div class="card scroll"><table><thead><tr>${cols.map(c => `<th class="${c.l ? 'l' : ''}">${c.h}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="${c.l ? 'l' : ''}">${c.f(r)}</td>`).join('')}<td><div class="adm-actions">${extra ? extra(r) : ''}<button class="btn ghost sm" data-act="edit" data-t="${table}" data-id="${r.id}">Editar</button><button class="btn danger sm" data-act="del" data-t="${table}" data-id="${r.id}">Eliminar</button></div></td></tr>`).join('')}</tbody></table></div>`;
}
const newBtn = (table, label) => `<button class="btn" data-act="new" data-t="${table}">+ ${label}</button>`;
const admL = () => ui.admLeague || String((S.leagues[0] || {}).id || '');

function aMatches() {
  const lid = +admL(), ms = S.matches.filter(m => m.league_id === lid), rounds = [...new Set(ms.map(m => m.round))].sort((a, b) => a - b);
  const rows = ms.filter(m => !ui.admRound || m.round === +ui.admRound);
  return `<div class="row" style="margin:14px 0"><select data-sel="admLeague">${S.leagues.map(l => `<option value="${l.id}" ${l.id === lid ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
  <select data-sel="admRound"><option value="">Todas las jornadas</option>${rounds.map(r => `<option value="${r}" ${String(r) === String(ui.admRound) ? 'selected' : ''}>Jornada ${r}</option>`).join('')}</select><span class="sp"></span>${newBtn('matches', 'Nuevo partido')}</div>
  <p class="muted small">Para publicar un resultado: Editar → marcadores → marcar “Partido jugado”. La tabla de posiciones y las estadísticas se actualizan solas.</p>
  ${entTable('matches', rows, [{ h: 'J', f: r => r.round }, { h: 'LOCAL', l: 1, f: r => esc(M.team[r.home_id]?.name) }, { h: 'MARCADOR', f: r => r.played ? `<b class="gold">${r.home_goals} - ${r.away_goals}</b>` : '<span class="muted">pendiente</span>' }, { h: 'VISITANTE', l: 1, f: r => esc(M.team[r.away_id]?.name) }, { h: 'FECHA', f: r => fmtDate(r.match_date) }])}`;
}
function aFixtures() {
  return `<div class="grid g2" style="margin-top:14px"><div class="card"><div class="card-title">GENERAR FIXTURE AUTOMÁTICO</div><form class="f" data-form="genFixtures">
    <label class="fl">Competición<select name="league_id">${S.leagues.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>
    <div class="form-grid"><label class="fl">Fecha de la jornada 1 (opcional)<input type="date" name="start"></label><label class="fl">Hora<input type="time" name="time" value="20:00"></label><label class="fl">Días entre jornadas<input type="number" name="days" value="7" min="1" max="60"></label></div>
    <label class="ck"><input type="checkbox" name="double"> Ida y vuelta</label><label class="ck"><input type="checkbox" name="replace"> Reemplazar los partidos sin jugar existentes</label>
    <button class="btn">Generar fixture</button></form></div>
  <div class="card"><div class="card-title">FIJAR FECHA DE UNA JORNADA</div><form class="f" data-form="roundDate">
    <label class="fl">Competición<select name="league_id">${S.leagues.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>
    <div class="form-grid"><label class="fl">Jornada<input type="number" name="round" min="1" value="1" required></label><label class="fl">Fecha y hora<input type="datetime-local" name="date" required></label></div>
    <button class="btn">Aplicar a toda la jornada</button></form></div></div>
  <h2>PARTIDOS POR COMPETICIÓN</h2>${entTableSimple(S.leagues.map(l => [l.name, S.matches.filter(m => m.league_id === l.id).length, S.matches.filter(m => m.league_id === l.id && m.played).length]))}`;
}
const entTableSimple = rows => `<div class="card scroll"><table><thead><tr><th class="l">COMPETICIÓN</th><th>PARTIDOS</th><th>JUGADOS</th></tr></thead><tbody>${rows.map(r => `<tr><td class="l">${esc(r[0])}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div>`;
function aSquads() {
  const lid = +admL(), ms = S.matches.filter(m => m.league_id === lid).sort((a, b) => a.round - b.round || a.id - b.id), m = M.match[+ui.sqMatch];
  const editor = m && m.league_id === lid ? [m.home_id, m.away_id].map(tid => {
    const t = M.team[tid], sq = S.squads.find(s => s.match_id === m.id && s.team_id === tid), sps = sq ? S.squadPlayers.filter(x => x.squad_id === sq.id) : [];
    const st = Object.fromEntries(sps.map(x => [x.player_id, x.starter ? 'S' : 'B'])), pls = sorted(S.players.filter(p => p.team_id === tid), (a, b) => a.number - b.number);
    return `<div class="card" data-team="${tid}" style="margin-top:14px"><div class="row">${crest(t, 32)}<h3 style="color:#fff;font-size:20px">${esc(t.name)}</h3></div>
    <div class="form-grid" style="margin:10px 0"><label class="fl">Formación<select name="formation"><option value="">—</option>${FORMATIONS.map(f => `<option ${sq?.formation === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
    <label class="fl">Director técnico<input type="text" name="coach" value="${esc(sq?.coach ?? t.coach ?? '')}" maxlength="120"></label>
    <label class="fl full">Capitán<select name="captain"><option value="">—</option>${pls.map(p => `<option value="${p.id}" ${sq?.captain_id === p.id ? 'selected' : ''}>${p.number} · ${esc(p.name)}</option>`).join('')}</select></label></div>
    ${pls.length ? `<div class="scroll"><table><thead><tr><th>#</th><th class="l">JUGADOR</th><th>POSICIÓN</th><th>ESTADO</th></tr></thead><tbody>${pls.map(p => `<tr><td>${p.number}</td><td class="l">${esc(p.name)}</td><td>${esc(p.position || '—')}</td><td><select data-pl="${p.id}"><option value="">No convocado</option><option value="S" ${st[p.id] === 'S' ? 'selected' : ''}>Titular</option><option value="B" ${st[p.id] === 'B' ? 'selected' : ''}>Suplente</option></select></td></tr>`).join('')}</tbody></table></div>` : '<div class="warn">Este equipo aún no tiene jugadores. Agrégalos en la pestaña “Jugadores”.</div>'}
    <div class="row" style="margin-top:12px"><button class="btn" data-act="saveSquad" data-team="${tid}" data-match="${m.id}">Guardar squadsheet</button>${sq ? `<button class="btn danger" data-act="delSquad" data-team="${tid}" data-match="${m.id}">Eliminar</button>` : ''}</div></div>`;
  }).join('') : '';
  return `<div class="row" style="margin:14px 0"><select data-sel="admLeague">${S.leagues.map(l => `<option value="${l.id}" ${l.id === lid ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
  <select data-sel="sqMatch"><option value="">Elige un partido…</option>${ms.map(x => `<option value="${x.id}" ${x.id === +ui.sqMatch ? 'selected' : ''}>J${x.round} · ${esc(M.team[x.home_id]?.name)} vs ${esc(M.team[x.away_id]?.name)}</option>`).join('')}</select></div>${editor || empty('Elige un partido para crear o editar sus squadsheets.')}`;
}
function aComps() {
  return `<div class="row" style="margin:14px 0"><span class="sp"></span>${newBtn('leagues', 'Nueva competición')}</div><p class="muted small">Las ligas toman sus equipos desde la pestaña “Equipos” (campo Liga). Las copas se arman con el botón “Equipos de la copa”.</p>
  ${entTable('leagues', S.leagues, [{ h: 'NOMBRE', l: 1, f: r => `<b>${esc(r.name)}</b>` }, { h: 'TIPO', f: r => r.kind === 'COPA' ? 'Copa' : 'Liga' }, { h: 'EQUIPOS', f: r => leagueTeams(r).length }, { h: 'ORDEN', f: r => r.sort_order }], r => r.kind === 'COPA' ? `<button class="btn ghost sm" data-act="cupTeams" data-id="${r.id}">Equipos de la copa</button>` : '')}`;
}
function aTeams() {
  return `<div class="row" style="margin:14px 0"><span class="sp"></span>${newBtn('teams', 'Publicar nuevo equipo')}</div><p class="muted small">Cada equipo puede tener un escudo personalizado: súbelo desde tu computador o pega un enlace.</p>
  ${entTable('teams', S.teams, [{ h: 'ESCUDO', f: r => crest(r, 32) }, { h: 'EQUIPO', l: 1, f: r => `<b>${esc(r.name)}</b>` }, { h: 'ABR.', f: r => esc(r.short_name || '') }, { h: 'LIGA', f: r => esc(M.league[r.league_id]?.name || '—') }, { h: 'DT', f: r => esc(r.coach || '') }])}`;
}
function aPlayers() {
  const tid = ui.plTeam || '', rows = S.players.filter(p => !tid || p.team_id === +tid);
  return `<div class="row" style="margin:14px 0"><select data-sel="plTeam"><option value="">Todos los equipos</option>${S.teams.map(t => `<option value="${t.id}" ${String(t.id) === String(tid) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select><span class="sp"></span>${newBtn('players', 'Nuevo jugador')}</div>
  ${entTable('players', rows, [{ h: '#', f: r => r.number }, { h: 'JUGADOR', l: 1, f: r => `<b>${esc(r.name)}</b>` }, { h: 'EQUIPO', l: 1, f: r => esc(M.team[r.team_id]?.name || '—') }, { h: 'POSICIÓN', f: r => esc(r.position || '') }, { h: 'PJ/G/A', f: r => { const s = M.stat[r.id] || {}; return `${s.apps || 0}/${s.goals || 0}/${s.assists || 0}`; } }],
    r => `<button class="btn ghost sm" data-act="pstats" data-id="${r.id}">Estadísticas</button>`)}`;
}
const aNews = () => `<div class="row" style="margin:14px 0"><span class="sp"></span>${newBtn('news', 'Nueva noticia')}</div>${entTable('news', S.news, [{ h: 'TÍTULO', l: 1, f: r => `<b>${esc(r.title)}</b>` }, { h: 'CATEGORÍA', f: r => esc(r.category || '') }, { h: 'FECHA', f: r => fmtDay(r.published) }, { h: 'PORTADA', f: r => r.featured ? '★' : '' }])}`;
const aHonors = () => `<div class="row" style="margin:14px 0"><span class="sp"></span>${newBtn('honors', 'Nuevo título')}</div>${entTable('honors', S.honors, [{ h: 'TEMPORADA', f: r => esc(S.seasons.find(s => s.id === r.season_id)?.name || '') }, { h: 'COMPETICIÓN', l: 1, f: r => esc(r.competition) }, { h: 'CAMPEÓN', l: 1, f: r => esc(M.team[r.champion_id]?.name || '—') }, { h: 'SUBCAMPEÓN', f: r => esc(M.team[r.runner_up_id]?.name || '—') }])}`;
const aRules = () => `<div class="row" style="margin:14px 0"><span class="sp"></span>${newBtn('rules', 'Nueva regla')}</div>${entTable('rules', S.rules, [{ h: 'CATEGORÍA', f: r => esc(r.category) }, { h: 'TÍTULO', l: 1, f: r => `<b>${esc(r.title)}</b>` }, { h: 'ORDEN', f: r => r.sort_order }])}`;
const aSeasons = () => `<div class="row" style="margin:14px 0"><span class="sp"></span>${newBtn('seasons', 'Nueva temporada')}</div>${entTable('seasons', S.seasons, [{ h: 'TEMPORADA', l: 1, f: r => `<b>${esc(r.name)}</b>` }, { h: 'ACTUAL', f: r => r.is_current ? '★' : '' }])}`;
function aSettings() {
  return `<div class="grid g2" style="margin-top:14px"><div class="card"><div class="card-title">PUNTOS Y DESEMPATE</div><form class="f" data-form="settings"><div class="form-grid">
    <label class="fl">Victoria<input type="number" name="points_win" value="${esc(S.settings.points_win)}" min="0" max="10"></label><label class="fl">Empate<input type="number" name="points_draw" value="${esc(S.settings.points_draw)}" min="0" max="10"></label><label class="fl">Derrota<input type="number" name="points_loss" value="${esc(S.settings.points_loss)}" min="0" max="10"></label>
    <label class="fl">Desempates (DG, GF, GC, PG)<input type="text" name="tiebreakers" value="${esc(S.settings.tiebreakers)}"></label></div><button class="btn">Guardar</button></form></div>
  <div class="card"><div class="card-title">CAMBIAR MI CONTRASEÑA</div><form class="f" data-form="password" autocomplete="off">
    <label class="fl">Contraseña actual<input type="password" name="current" required autocomplete="current-password"></label>
    <label class="fl">Nueva contraseña (12+ caracteres, mayúscula, minúscula y número)<input type="password" name="next" required minlength="12" autocomplete="new-password"></label>
    <label class="fl">Repite la nueva contraseña<input type="password" name="again" required minlength="12" autocomplete="new-password"></label><button class="btn">Cambiar contraseña</button></form></div></div>`;
}
const ATABS = [['partidos', 'Partidos y resultados', aMatches], ['fixtures', 'Fixtures', aFixtures], ['squads', 'Squadsheets', aSquads], ['comps', 'Competiciones y copas', aComps], ['equipos', 'Equipos', aTeams],
  ['jugadores', 'Jugadores', aPlayers], ['noticias', 'Noticias', aNews], ['palmares', 'Palmarés', aHonors], ['reglas', 'Reglamento', aRules], ['temporadas', 'Temporadas', aSeasons], ['ajustes', 'Ajustes y seguridad', aSettings]];
function vAdmin(tab) {
  if (!S.admin) return `<div class="login card"><h1 style="font-size:30px">ADMINISTRACIÓN</h1><p class="muted">Acceso exclusivo para la organización de STF.</p>
    <form class="f" data-form="login"><label class="fl">Usuario<input type="text" name="username" required autocomplete="username" maxlength="60"></label><label class="fl">Contraseña<input type="password" name="password" required autocomplete="current-password" maxlength="200"></label><button class="btn">Ingresar</button></form></div>`;
  const cur = ATABS.find(t => t[0] === tab) || ATABS[0];
  return `<div class="row"><h1>ADMINISTRACIÓN</h1><span class="sp"></span><span class="muted small">Sesión: <b>${esc(S.admin)}</b></span><button class="btn ghost sm" data-act="logout">Cerrar sesión</button></div>
  <div class="tabs">${ATABS.map(t => `<a class="tab ${t[0] === cur[0] ? 'on' : ''}" href="#/admin/${t[0]}">${t[1]}</a>`).join('')}</div>${cur[2]()}`;
}

// ---------- acciones y formularios ----------
const KEYMAP = { resLeague: 'resRound', fixLeague: 'fixRound', admLeague: 'admRound' };
const ACT = {
  back() { history.length > 1 ? history.back() : (location.hash = '#/'); },
  homeLeague(el) { ui.homeLeague = +el.dataset.v; render(true); },
  closeDlg,
  new(el) {
    const t = el.dataset.t, d = {};
    if (t === 'matches') { d.season_id = S.seasonId; d.league_id = +admL(); }
    if (t === 'news') d.published = new Date().toISOString().slice(0, 10);
    if (t === 'honors') d.season_id = S.seasonId;
    openEntity(t, null, d);
  },
  edit(el) { openEntity(el.dataset.t, +el.dataset.id); },
  async del(el) {
    if (!confirm(`¿Eliminar este ${LABEL[el.dataset.t]}? Esta acción no se puede deshacer.`)) return;
    await attempt(() => request('DELETE', `/api/admin/${el.dataset.t}/${el.dataset.id}`), 'Eliminado');
  },
  cupTeams(el) {
    const l = M.league[+el.dataset.id], cur = new Set(leagueTeams(l).map(t => t.id));
    dlg().innerHTML = `<h3>Equipos de ${esc(l.name)}</h3><form class="f" data-form="cup" data-id="${l.id}"><div class="form-grid">${S.teams.map(t => `<label class="ck"><input type="checkbox" name="t" value="${t.id}" ${cur.has(t.id) ? 'checked' : ''}> ${crest(t, 22)} ${esc(t.name)}</label>`).join('')}</div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-act="closeDlg">Cancelar</button><button class="btn">Guardar</button></div></form>`;
    curForm = null; dlg().showModal();
  },
  pstats(el) {
    const p = M.player[+el.dataset.id], s = M.stat[p.id] || {};
    openForm(`Estadísticas de ${p.name}`, [{ k: 'apps', label: 'Partidos jugados', t: 'num' }, { k: 'goals', label: 'Goles', t: 'num' }, { k: 'assists', label: 'Asistencias', t: 'num' }], s,
      async d => { await attempt(() => request('POST', '/api/admin/player-stats', { player_id: p.id, season_id: S.seasonId, apps: d.apps || 0, goals: d.goals || 0, assists: d.assists || 0 }), 'Estadísticas guardadas'); closeDlg(); });
  },
  async saveSquad(el) {
    const card = el.closest('[data-team]'), players = [...card.querySelectorAll('[data-pl]')].filter(s => s.value).map(s => ({ player_id: +s.dataset.pl, starter: s.value === 'S' }));
    await attempt(() => request('POST', '/api/admin/squad', { match_id: +el.dataset.match, team_id: +el.dataset.team, formation: card.querySelector('[name=formation]').value, coach: card.querySelector('[name=coach]').value, captain_id: +card.querySelector('[name=captain]').value || null, players }), 'Squadsheet guardada');
  },
  async delSquad(el) {
    if (!confirm('¿Eliminar esta squadsheet?')) return;
    await attempt(() => request('DELETE', `/api/admin/squad?match_id=${el.dataset.match}&team_id=${el.dataset.team}`), 'Squadsheet eliminada');
  },
  async logout() { await request('POST', '/api/logout', {}); await load(S.seasonId); location.hash = '#/'; render(); toast('Sesión cerrada', 'ok'); },
};
const FORMS = {
  async dlg(form) { if (curForm) await curForm.submit(collect(curForm.fields, form)); },
  async login(form) {
    try { await request('POST', '/api/login', { username: form.username.value, password: form.password.value }); await load(S.seasonId); toast('Bienvenido', 'ok'); render(true); }
    catch (e) { toast(e.message, 'err'); form.password.value = ''; }
  },
  async cup(form) {
    const ids = [...form.querySelectorAll('[name=t]:checked')].map(x => +x.value);
    await attempt(() => request('POST', '/api/admin/comp-teams', { league_id: +form.dataset.id, team_ids: ids }), 'Equipos de la copa actualizados'); closeDlg();
  },
  async genFixtures(form) {
    const d = Object.fromEntries(new FormData(form)); d.double = form.double.checked; d.replace = form.replace.checked;
    d.league_id = +d.league_id; d.season_id = S.seasonId; d.days = +d.days;
    if (d.replace && !confirm('Se eliminarán los partidos sin jugar de esta competición y se generarán de nuevo. ¿Continuar?')) return;
    const r = await attempt(() => request('POST', '/api/admin/fixtures', d)); if (r) toast(`Fixture generado: ${r.created} partidos`, 'ok');
  },
  async roundDate(form) {
    const r = await attempt(() => request('POST', '/api/admin/round-date', { league_id: +form.league_id.value, season_id: S.seasonId, round: +form.round.value, date: form.date.value })); if (r) toast(`Fecha aplicada a ${r.updated} partidos`, 'ok');
  },
  async settings(form) { await attempt(() => request('POST', '/api/admin/settings', Object.fromEntries(new FormData(form))), 'Ajustes guardados'); },
  async password(form) {
    if (form.next.value !== form.again.value) return toast('Las contraseñas nuevas no coinciden', 'err');
    const r = await attempt(() => request('POST', '/api/admin/password', { current: form.current.value, next: form.next.value }), 'Contraseña actualizada');
    if (r) form.reset();
  },
};

// ---------- enrutador ----------
function view(hash) {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (p[0] || '') {
    case '': return ['Inicio', vHome()];
    case 'noticias': return ['Noticias', vNews()];
    case 'noticia': return ['Noticia', vNewsDetail(p[1])];
    case 'ligas': return ['Ligas', vLeagues()];
    case 'liga': return ['Liga', vLeague(p[1], p[2])];
    case 'resultados': return ['Resultados', vResults()];
    case 'fixtures': return ['Fixtures', vFixtures()];
    case 'equipos': return ['Equipos', vTeams()];
    case 'equipo': return ['Equipo', vTeam(p[1])];
    case 'partido': return ['Partido', vMatch(p[1])];
    case 'squadsheets': return ['Squadsheets', vSquadsheets()];
    case 'squad': return ['Squadsheet', vSquad(p[1])];
    case 'estadisticas': return ['Estadísticas', vStats()];
    case 'palmares': return ['Palmarés', vHonors()];
    case 'reglamento': return ['Reglamento', vRules()];
    case 'admin': return ['Administración', vAdmin(p[1])];
    case 'buscar': return ['Búsqueda', vSearch(p[1])];
    default: return ['No encontrado', notFound()];
  }
}
function render(keep) {
  if (!S) return;
  const y = window.scrollY;
  let r; try { r = view(location.hash || '#/'); } catch (e) { console.error(e); r = ['Error', `<h1>ALGO SALIÓ MAL</h1><p class="muted">${esc(e.message)}</p>`]; }
  $('#app').innerHTML = r[1];
  document.title = (r[0] === 'Inicio' ? '' : r[0] + ' · ') + 'STF · Superliga de Touch Football';
  const h = location.hash || '#/';
  document.querySelectorAll('#nav a').forEach(a => { const k = a.getAttribute('href'); a.classList.toggle('on', k === '#/' ? h === '#/' || h === '' : h.startsWith(k) || (k === '#/ligas' && h.startsWith('#/liga')) || (k === '#/equipos' && h.startsWith('#/equipo')) || (k === '#/noticias' && h.startsWith('#/noticia')) || (k === '#/squadsheets' && h.startsWith('#/squad'))); });
  window.scrollTo(0, keep ? y : 0);
}

// ---------- arranque ----------
function init() {
  $('#nav .nav-row').innerHTML = NAV.map(([h, n]) => `<a href="${h}">${n}</a>`).join('');
  $('#nav').addEventListener('click', () => $('#nav').classList.remove('open'));
  $('#menuBtn').addEventListener('click', () => $('#nav').classList.toggle('open'));
  $('#seasonSelect').addEventListener('change', async e => { await load(+e.target.value); render(true); });
  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); const q = $('#searchInput').value.trim(); if (q) location.hash = '#/buscar/' + encodeURIComponent(q); });
  document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) { e.preventDefault(); ACT[el.dataset.act](el); } });
  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.dataset.sel) { ui[el.dataset.sel] = el.value; if (KEYMAP[el.dataset.sel]) ui[KEYMAP[el.dataset.sel]] = ''; if (el.dataset.sel === 'admLeague') ui.sqMatch = ''; render(true); }
    else if (el.dataset.upload !== undefined && el.files && el.files[0]) {
      const f = el.files[0];
      if (f.size > 2 * 1024 * 1024) { toast('La imagen supera los 2 MB', 'err'); el.value = ''; return; }
      try {
        const r = await request('POST', '/api/admin/upload', undefined, f);
        const box = el.closest('.crest-pick'); box.querySelector('input[type=text]').value = r.url;
        box.querySelector('[data-prev]').innerHTML = `<img class="crest" src="${esc(r.url)}" width="56" height="56" alt="">`; toast('Imagen subida. Guarda el formulario para publicarla.', 'ok');
      } catch (err) { toast(err.message, 'err'); }
      el.value = '';
    }
  });
  document.addEventListener('submit', async e => {
    const form = e.target, name = form.dataset.form; if (!name || !FORMS[name]) return;
    e.preventDefault(); const btn = form.querySelector('button:not([type=button])'); if (btn) btn.disabled = true;
    try { await FORMS[name](form); } finally { if (btn) btn.disabled = false; }
  });
  // si un escudo falla al cargar, mostramos las iniciales del equipo
  document.addEventListener('error', e => {
    const i = e.target; if (i && i.tagName === 'IMG' && i.dataset.fb) { const tpl = i.nextElementSibling; if (tpl && tpl.tagName === 'TEMPLATE') { i.replaceWith(tpl.content.cloneNode(true)); tpl.remove(); } }
  }, true);
  window.addEventListener('hashchange', () => { render(); });
  load().then(() => render()).catch(e => { $('#app').innerHTML = `<h1>SIN CONEXIÓN</h1><p class="muted">No se pudieron cargar los datos: ${esc(e.message)}</p>`; });
}
if (typeof document !== 'undefined' && !window.__STF_TEST__) init();
