// Lightweight localStorage-backed stand-in for the Supabase client, used when
// no VITE_SUPABASE_URL/KEY are configured (e.g. local/offline testing).
// Mimics the subset of the supabase-js query builder API this app relies on:
// .from(table).select().order().eq().in().not().maybeSingle()/.upsert()/.insert()/.update()/.delete()
// plus a no-op .channel()/.removeChannel() pair for realtime subscriptions.

const DB_KEY = 'point-count-local-db-v1';

const DEFAULT_PLAYERS = [
  { name: 'Alice', color: '#FF6B6B' },
  { name: 'Bob', color: '#4ECDC4' },
  { name: 'Charlie', color: '#45B7D1' },
  { name: 'Dana', color: '#FFA07A' },
];

function readDb() {
  try {
    return JSON.parse(localStorage.getItem(DB_KEY)) || {};
  } catch {
    return {};
  }
}

function writeDb(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function seedIfEmpty(db) {
  let changed = false;
  if (!Array.isArray(db.players)) { db.players = []; changed = true; }
  if (!db.players.length) {
    db.players = DEFAULT_PLAYERS.map((p) => ({
      id: crypto.randomUUID(),
      name: p.name,
      color: p.color,
      balance: 0,
      transfer_status: 'transferred',
      updated_at: new Date().toISOString(),
    }));
    changed = true;
  }
  if (!Array.isArray(db.matches)) { db.matches = []; changed = true; }
  if (!Array.isArray(db.player_balance_history)) { db.player_balance_history = []; changed = true; }
  if (!Array.isArray(db.app_settings)) { db.app_settings = []; changed = true; }
  if (!Array.isArray(db.game_sessions)) { db.game_sessions = []; changed = true; }
  if (changed) writeDb(db);
  return db;
}

class LocalQuery {
  constructor(table) {
    this.table = table;
    this._op = 'select';
    this._payload = null;
    this._filters = [];
    this._order = null;
    this._single = false;
  }

  select() { return this; }

  order(col, opts) {
    this._order = { col, ascending: opts?.ascending !== false };
    return this;
  }

  eq(col, val) { this._filters.push((row) => row[col] === val); return this; }

  in(col, vals) { this._filters.push((row) => vals.includes(row[col])); return this; }

  not(col, _op, val) {
    this._filters.push((row) => (val === null ? row[col] !== null && row[col] !== undefined : row[col] !== val));
    return this;
  }

  maybeSingle() { this._single = true; return this; }

  upsert(payload) { this._op = 'upsert'; this._payload = payload; return this; }

  insert(payload) { this._op = 'insert'; this._payload = payload; return this; }

  update(payload) { this._op = 'update'; this._payload = payload; return this; }

  delete() { this._op = 'delete'; return this; }

  async _exec() {
    const db = seedIfEmpty(readDb());
    let rows = db[this.table] || [];

    if (this._op === 'select') {
      let result = rows.filter((row) => this._filters.every((fn) => fn(row)));
      if (this._order) {
        const { col, ascending } = this._order;
        result = [...result].sort((a, b) => {
          if (a[col] < b[col]) return ascending ? -1 : 1;
          if (a[col] > b[col]) return ascending ? 1 : -1;
          return 0;
        });
      }
      return this._single ? { data: result[0] ?? null, error: null } : { data: result, error: null };
    }

    if (this._op === 'upsert') {
      const items = Array.isArray(this._payload) ? this._payload : [this._payload];
      items.forEach((item) => {
        const matchKey = item.id !== undefined ? 'id' : (item.key !== undefined ? 'key' : null);
        const idx = matchKey ? rows.findIndex((row) => row[matchKey] === item[matchKey]) : -1;
        if (idx >= 0) rows[idx] = { ...rows[idx], ...item };
        else rows.push(item);
      });
      db[this.table] = rows;
      writeDb(db);
      return { data: items, error: null };
    }

    if (this._op === 'insert') {
      const items = Array.isArray(this._payload) ? this._payload : [this._payload];
      db[this.table] = [...rows, ...items];
      writeDb(db);
      return { data: items, error: null };
    }

    if (this._op === 'update') {
      db[this.table] = rows.map((row) => (this._filters.every((fn) => fn(row)) ? { ...row, ...this._payload } : row));
      writeDb(db);
      return { data: null, error: null };
    }

    if (this._op === 'delete') {
      db[this.table] = rows.filter((row) => !this._filters.every((fn) => fn(row)));
      writeDb(db);
      return { data: null, error: null };
    }

    return { data: null, error: null };
  }

  then(resolve, reject) { return this._exec().then(resolve, reject); }
}

export const localDb = {
  from(table) { return new LocalQuery(table); },
  channel() {
    const noopChannel = {
      on() { return noopChannel; },
      subscribe(cb) { cb?.('SUBSCRIBED'); return noopChannel; },
    };
    return noopChannel;
  },
  removeChannel() {},
};
