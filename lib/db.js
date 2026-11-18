'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'stf.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, is_current INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS leagues (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, short_name TEXT, tagline TEXT, sort_order INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'LIGA');
CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, short_name TEXT, crest TEXT, league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL, coach TEXT);
CREATE TABLE IF NOT EXISTS competition_teams (league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE, PRIMARY KEY (league_id, team_id));
CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL, name TEXT NOT NULL, number INTEGER NOT NULL DEFAULT 0, position TEXT);
CREATE TABLE IF NOT EXISTS player_stats (player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE, apps INTEGER NOT NULL DEFAULT 0, goals INTEGER NOT NULL DEFAULT 0, assists INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (player_id, season_id));
CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY AUTOINCREMENT, season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE, league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE, round INTEGER NOT NULL, home_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE, away_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE, home_goals INTEGER, away_goals INTEGER, played INTEGER NOT NULL DEFAULT 0, match_date TEXT, venue TEXT, details TEXT, result_at TEXT);
CREATE INDEX IF NOT EXISTS idx_matches_scope ON matches(season_id, league_id, round);
CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, subtitle TEXT, content TEXT, image TEXT, category TEXT, published TEXT, featured INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS squads (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE, formation TEXT, coach TEXT, captain_id INTEGER REFERENCES players(id) ON DELETE SET NULL, UNIQUE (match_id, team_id));
CREATE TABLE IF NOT EXISTS squad_players (id INTEGER PRIMARY KEY AUTOINCREMENT, squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, starter INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE (squad_id, player_id));
CREATE TABLE IF NOT EXISTS honors (id INTEGER PRIMARY KEY AUTOINCREMENT, season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE, kind TEXT NOT NULL, competition TEXT NOT NULL, champion_id INTEGER REFERENCES teams(id) ON DELETE SET NULL, runner_up_id INTEGER REFERENCES teams(id) ON DELETE SET NULL, notes TEXT);
CREATE TABLE IF NOT EXISTS rules (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, title TEXT NOT NULL, content TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, pwd TEXT NOT NULL);
`);

const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn(); // reentrante: se une a la transacción en curso
  db.exec('BEGIN IMMEDIATE'); txDepth = 1;
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
  finally { txDepth = 0; }
}
module.exports = { db, all, get, run, tx, DATA_DIR };
