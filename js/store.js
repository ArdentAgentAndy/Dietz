import { seedData } from './seed.js?v=65';

const STORAGE_KEY = 'dietz:data';
const TABLES = ['Courses', 'Items', 'CourseState', 'Categories', 'Sessions', 'PastTerms', 'Settings', 'CanvasFlags', 'RoadmapStatus', 'RoadmapCustom', 'Contacts'];

function emptyData() {
  // tombstones: every {table, id} this device has ever explicitly deleted,
  // kept around (not just the matching outbox op, which disappears once
  // that delete successfully flushes) so a LATER bootstrap pull can't
  // silently resurrect the row — see pullBootstrap in sync.js, which is
  // what actually reads/prunes this list. Needed because once the outbox
  // op is gone, nothing locally still remembers "this id must stay
  // deleted" if the server ever hands it back again (a sheet-side delete
  // that didn't actually take, a stale row from a device that re-upserted
  // it before seeing this device's delete, etc.) — this is a permanent,
  // small, self-pruning safety net, not a mirror of the outbox.
  const data = { outbox: [], tombstones: [] };
  for (const t of TABLES) data[t] = [];
  return data;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('Failed to load store, starting fresh', e);
    return null;
  }
}

class Store {
  constructor() {
    this.data = load();
    if (!this.data) {
      this.data = emptyData();
      this.seed();
      this.persist();
    }
  }

  seed() {
    for (const table of TABLES) {
      this.data[table] = seedData[table] ? [...seedData[table]] : [];
    }
  }

  persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  table(name) {
    return this.data[name] || (this.data[name] = []);
  }

  upsert(tableName, row) {
    const rows = this.table(tableName);
    if (!row.id) row.id = crypto.randomUUID();
    const idx = rows.findIndex((r) => r.id === row.id);
    // Push the merged row, not the partial input — a partial upsert (e.g.
    // { id, status: 'archived' }) must not blank out the other columns
    // when this op is replayed against the sheet.
    const merged = idx >= 0 ? { ...rows[idx], ...row } : row;
    if (idx >= 0) rows[idx] = merged;
    else rows.push(merged);
    this.data.outbox.push({ op: 'upsert', table: tableName, row: merged });
    this.persist();
    this.notify();
    return merged;
  }

  remove(tableName, id) {
    this.data[tableName] = this.table(tableName).filter((r) => r.id !== id);
    this.data.outbox.push({ op: 'delete', table: tableName, id });
    // (this.data.tombstones || []) — an existing device's localStorage was
    // persisted before this field existed, so it's absent until the next
    // persist() below backfills it.
    const tombstones = this.data.tombstones || (this.data.tombstones = []);
    if (!tombstones.some((t) => t.table === tableName && t.id === id)) {
      tombstones.push({ table: tableName, id });
    }
    this.persist();
    this.notify();
  }

  notify() {
    window.dispatchEvent(new Event('dietz:store-changed'));
  }

  resetToSeed() {
    this.data = emptyData();
    this.seed();
    this.persist();
  }
}

export const store = new Store();
