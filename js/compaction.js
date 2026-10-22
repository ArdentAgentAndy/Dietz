// Keeps the Sessions table (and the Sheet behind it) from growing forever.
// Anything older than yesterday is collapsed into one row per day per group
// (Revision / Homework / Project work / Research / Piano) — the specific
// course/project/session detail isn't needed once a day is in the past, only
// the daily total. The collapsed row is a normal Sessions row (source:
// "compacted"), so it still shows up in the sheet and counts toward the
// hours graph; the raw rows it replaces are deleted (locally and, once
// synced, from the sheet) since their minutes now live in that row.
import { store } from './store.js?v=62';
import { formatDateISO } from './format.js?v=62';

const GROUP_LABELS = {
  revision: 'Revision',
  homework: 'Homework',
  project: 'Project work',
  research: 'Research',
  piano: 'Piano',
};

export function compactedCategoryId(group) {
  return `compacted-${group}`;
}

// Deterministic, not crypto.randomUUID() — the whole point. Two devices (or
// two tabs) compacting the same day before either has seen the other's
// result both land on this exact id, so store.upsert's own by-id merge
// naturally combines them into one row instead of each minting a random id
// and silently piling up duplicate "daily total" rows for the same day,
// which is exactly what happened before this existed (see dedupeCompacted
// below for the one-time cleanup of rows that already duplicated this way).
function compactedSessionId(date, group) {
  return `compacted-${group}-${date}`;
}

// One-time (idempotent) cleanup for compacted rows created before this file
// assigned them a deterministic id — any of those that duplicated (same
// date + categoryId, different random id) get collapsed into the single
// canonical id. Deliberately takes the *minimum* of the duplicates, not
// their sum: a duplicate here means the same underlying raw sessions got
// compacted more than once by devices that hadn't synced with each other
// yet, not genuinely separate additional time (confirmed from a real case —
// one group's duplicates were all identical, proving they were redundant
// copies of the same total, not additive; summing would have cemented the
// inflation instead of fixing it). The smallest value is the closest
// approximation available to the real total without the original raw
// sessions to recompute from (they're long gone by the time a duplicate is
// noticed) — in practice it's also consistently the one that matches
// whatever's already live on the server. Always safe to re-run: once a
// (date, categoryId) has exactly one row at its canonical id, there's
// nothing left to merge.
export function dedupeCompactedSessions() {
  const compacted = store.table('Sessions').filter((s) => s.source === 'compacted');
  const groups = {}; // "date|categoryId" -> rows[]
  for (const s of compacted) {
    const key = `${s.date}|${s.categoryId}`;
    (groups[key] = groups[key] || []).push(s);
  }

  for (const [key, rows] of Object.entries(groups)) {
    if (rows.length < 2) continue;
    const [date, categoryId] = key.split('|');
    const group = categoryId.replace(/^compacted-/, '');
    const id = compactedSessionId(date, group);
    const minMinutes = Math.min(...rows.map((r) => r.minutes || 0));

    store.upsert('Sessions', { id, categoryId, date, start: '', end: '', minutes: minMinutes, source: 'compacted', note: 'Daily total' });
    for (const r of rows) {
      if (r.id !== id) store.remove('Sessions', r.id);
    }
  }
}

function ensureCompactedCategory(group) {
  const id = compactedCategoryId(group);
  if (store.table('Categories').some((c) => c.id === id)) return;
  store.upsert('Categories', {
    id,
    group,
    name: `${GROUP_LABELS[group]} total`,
    courseId: '',
    archived: true,
  });
}

function addDays(dateISO, n) {
  const d = new Date(`${dateISO}T00:00:00`);
  d.setDate(d.getDate() + n);
  return formatDateISO(d);
}

// Collapses every session dated before yesterday into one "compacted"
// session per (date, group). Safe to call as often as you like — once a
// day's sessions are compacted they're gone, so there's nothing left to
// re-compact next time.
export function compactOldSessions() {
  const todayISO = formatDateISO(new Date());
  const cutoff = addDays(todayISO, -1); // sessions on/after this date are left alone

  const categories = store.table('Categories');
  const groupOf = new Map(categories.map((c) => [c.id, c.group]));

  const toCompact = store
    .table('Sessions')
    .filter((s) => s.date < cutoff && s.source !== 'compacted' && groupOf.has(s.categoryId));
  if (!toCompact.length) return;

  const sums = new Map(); // "date|group" -> minutes
  for (const s of toCompact) {
    const key = `${s.date}|${groupOf.get(s.categoryId)}`;
    sums.set(key, (sums.get(key) || 0) + s.minutes);
  }

  for (const [key, minutes] of sums) {
    const [date, group] = key.split('|');
    ensureCompactedCategory(group);
    const categoryId = compactedCategoryId(group);
    const id = compactedSessionId(date, group);
    const existing = store.table('Sessions').find((s) => s.id === id);
    store.upsert('Sessions', {
      id,
      categoryId,
      date,
      start: '',
      end: '',
      minutes: (existing?.minutes || 0) + minutes,
      source: 'compacted',
      note: 'Daily total',
    });
  }

  for (const s of toCompact) store.remove('Sessions', s.id);
}
