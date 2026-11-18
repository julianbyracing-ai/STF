'use strict';
const { get, run, tx } = require('./db');
const { generate } = require('./fixtures');

const CDN = 'https://cdn.discordapp.com/emojis/';
const espn = id => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/500/${id}.png`;
const D = id => `${CDN}${id}.webp?size=96`;

const LEAGUES = [['LPF', 'LPF', 'Liga 1'], ['Primera A', 'PRA', 'Liga 2'], ['Liga MX', 'MX', 'Liga 3'], ['Brasileirão', 'BRA', 'Liga 4']];
const TEAMS = [
  [['Boca Juniors', D('1553076673270784102')], ['Estudiantes de La Plata', D('1565778638706704516')], ['River Plate', D('1553868896782516365')],
   ['Vélez Sarsfield', D('1552045211054510081')], ['Independiente', D('1561538978384183296')], ['Huracán', D('1553076859150008390')],
   ['Rosario Central', D('1553076909200384112')], ['San Lorenzo', D('1559062616989765684')]],
  [['Atlético Bucaramanga', D('1544513589367406612')], ['Atlético Nacional', D('1553869882205020231')], ['Millonarios', D('1553869832955367537')],
   ['América de Cali', D('1554230600121061518')], ['Deportivo Cali', D('1566156427624448020')], ['Junior', D('1565800510491992154')],
   ['Independiente Santa Fe', D('1565786422122782880')], ['Once Caldas', D('1565786789925617684')]],
  [['América', D('1566154892366839870')], ['Guadalajara (Chivas)', D('1566154933131018250')], ['Tigres UANL', D('1545886058321940676')],
   ['Toluca', espn(223)], ['Pumas', D('1566226160264675399')], ['Santos Laguna', D('1566230640104575006')],
   ['Getafe CF', espn(2922)], ['Cruz Azul', D('1476723466966138983')]],
  [['Flamengo', D('1566232344120008727')], ['Palmeiras', D('1566232446633123951')], ['São Paulo', D('1553077316949905539')],
   ['Corinthians', D('1555008237907214436')], ['Cruzeiro', D('1560791559241207878')], ['Fluminense', D('1566234106381991936')],
   ['Grêmio', D('1553077573645238512')], ['Internacional', D('1558524473718866020')]],
];

function abbr(name) {
  const clean = name.normalize('NFD').replace(/\p{M}/gu, '').replace(/\(.*?\)/g, ' ').trim();
  const w = clean.split(/\s+/);
  let a = w.length === 1 ? w[0] : w[0][0] + w[w.length - 1].slice(0, 2);
  return a.slice(0, 3).toUpperCase();
}

function seedIfEmpty() {
  if (get('SELECT id FROM seasons LIMIT 1')) { migrate(); return; }
  tx(() => {
    const season = run("INSERT INTO seasons (name, is_current) VALUES ('STF | Season 2 C3', 1)").lastInsertRowid;
    for (const [k, v] of [['points_win', '3'], ['points_draw', '1'], ['points_loss', '0'], ['tiebreakers', 'DG,GF,GC']]) run('INSERT INTO settings VALUES (?,?)', k, v);
    const leagueRows = [];
    LEAGUES.forEach((l, i) => {
      const id = run('INSERT INTO leagues (name, short_name, tagline, sort_order, kind) VALUES (?,?,?,?,?)', l[0], l[1], l[2], i, 'LIGA').lastInsertRowid;
      for (const [name, crest] of TEAMS[i]) run('INSERT INTO teams (name, short_name, crest, league_id) VALUES (?,?,?,?)', name, abbr(name), crest, id);
      leagueRows.push({ id: Number(id), kind: 'LIGA' });
    });
    run("INSERT INTO leagues (name, short_name, tagline, sort_order, kind) VALUES ('Copa Libertadores','LIB','Copa',10,'COPA')");
    run("INSERT INTO leagues (name, short_name, tagline, sort_order, kind) VALUES ('Copa Sudamericana','SUD','Copa',11,'COPA')");
    const today = new Date().toISOString().slice(0, 10);
    run('INSERT INTO news (title, subtitle, content, category, published, featured) VALUES (?,?,?,?,?,1)',
      'Comienza STF | Season 2 C3', 'Cuatro ligas independientes y 32 clubes',
      'La Superliga de Touch Football presenta la Season 2 C3, compuesta por cuatro ligas independientes: LPF, Primera A, Liga MX y Brasileirão. Cada liga reúne a ocho equipos y cuenta con su propia tabla de posiciones, calendario, resultados, estadísticas e historial.\n\nDesde este portal puedes consultar equipos, squadsheets, estadísticas, palmarés y reglamento.',
      'Anuncios de competición', today);
    run('INSERT INTO news (title, subtitle, content, category, published, featured) VALUES (?,?,?,?,?,0)',
      'Fechas del fixture por definir', 'Los calendarios ya están generados',
      'El fixture de cada liga (siete jornadas, todos contra todos) ya está cargado. Las fechas y horarios de los partidos se publicarán a medida que la organización los confirme.',
      'Comunicados oficiales', today);
    for (const l of leagueRows) generate(Number(season), l, { double: false });
  });
}

/** Ajustes para bases creadas con versiones anteriores. */
function migrate() {
  const old = get("SELECT id FROM teams WHERE name = 'Tiburones Rojos de Veracruz'");
  if (old && !get("SELECT id FROM teams WHERE name = 'Getafe CF'")) {
    run("UPDATE teams SET name='Getafe CF', short_name='GET', crest=? WHERE id=?", espn(2922), old.id);
  }
}
module.exports = { seedIfEmpty };
