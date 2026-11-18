'use strict';
const { all, run, tx } = require('./db');

function teamsOf(league) {
  if (league.kind === 'COPA') {
    return all('SELECT t.id FROM teams t JOIN competition_teams c ON c.team_id = t.id WHERE c.league_id = ? ORDER BY t.name', league.id).map(r => r.id);
  }
  return all('SELECT id FROM teams WHERE league_id = ? ORDER BY name', league.id).map(r => r.id);
}
const pad = n => String(n).padStart(2, '0');
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Todos contra todos (método del círculo). start = 'YYYY-MM-DD' o null (fechas por definir). */
function generate(seasonId, league, { double = false, start = null, days = 7, time = '20:00' } = {}) {
  const ids = teamsOf(league);
  if (ids.length < 2) return 0;
  if (ids.length % 2) ids.push(null);
  const n = ids.length, rounds = n - 1, first = [];
  const rot = ids.slice();
  for (let r = 0; r < rounds; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = rot[i], b = rot[n - 1 - i];
      if (a == null || b == null) continue;
      round.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    first.push(round);
    rot.splice(1, 0, rot.pop());
  }
  let created = 0;
  tx(() => {
    for (let leg = 0; leg < (double ? 2 : 1); leg++) {
      for (let r = 0; r < rounds; r++) {
        const rn = leg * rounds + r + 1;
        const date = start ? `${addDays(start, (rn - 1) * days)}T${time}` : null;
        for (const [h, a] of first[r]) {
          const [home, away] = leg === 0 ? [h, a] : [a, h];
          run('INSERT INTO matches (season_id, league_id, round, home_id, away_id, played, match_date) VALUES (?,?,?,?,?,0,?)',
            seasonId, league.id, rn, home, away, date);
          created++;
        }
      }
    }
  });
  return created;
}
module.exports = { generate, teamsOf };
