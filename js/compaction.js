// Keeps the Sessions table (and the Sheet behind it) from growing forever.
// Anything older than yesterday is collapsed into one row per day per group
// (Revision / Homework / Project work / Research / Piano) — the specific
// course/project/session detail isn't needed once a day is in the past, only
// the daily total. The collapsed row is a normal Sessions row (source:
// "compacted"), so it still shows up in the sheet and counts toward the
// hours graph; the raw rows it replaces are deleted (locally and, once
// synced, from the sheet) since their minutes now live in that row.
import { store } from './store.js?v=2';
import { formatDateISO } from './format.js?v=2';

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
    const existing = store
      .table('Sessions')
      .find((s) => s.categoryId === categoryId && s.date === date && s.source === 'compacted');
    store.upsert('Sessions', {
      id: existing?.id,
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
