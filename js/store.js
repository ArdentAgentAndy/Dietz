import { seedData } from './seed.js?v=46';

const STORAGE_KEY = 'dietz:data';
const TABLES = ['Courses', 'Items', 'CourseState', 'Categories', 'Sessions', 'PastTerms', 'Settings', 'CanvasFlags', 'RoadmapStatus', 'RoadmapCustom'];

function emptyData() {
  const data = { outbox: [] };
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
