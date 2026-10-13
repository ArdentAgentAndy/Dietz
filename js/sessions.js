import { store } from './store.js?v=59';
import { formatDateISO } from './format.js?v=59';

// goalHours: daily target shown as a dashed reference line on the hours graph.
// No dedicated Homework series — homework is logged against whichever
// course's own Revision timer you're doing it for, same bucket as any
// other revision work (see minutesByGroupForDates below for how past
// homework-group minutes fold into this line too, retroactively).
export const GRAPH_SERIES = [
  { key: 'revision', label: 'Revision', group: 'revision', color: '#3fb87f', goalHours: 6 },
  { key: 'project', label: 'Project work', group: 'project', color: '#3987e5', goalHours: 2 },
  { key: 'research', label: 'Research', group: 'research', color: '#9b59b6', goalHours: 4 },
  { key: 'piano', label: 'Piano', group: 'piano', color: '#ffffff', goalHours: 1 },
];

// 'homework' no longer has its own card/series (see logging.js) but old
// sessions/compacted rows still carry that group — fold their minutes
// into Revision's line instead of dropping them from the graph.
export const GROUP_ALIASES = { homework: 'revision' };

// Non-archived categories eligible for a timer card, in a given group.
// Revision categories only show while their course is still active.
export function liveCategoriesByGroup(group) {
  const courses = store.table('Courses');
  return store.table('Categories').filter((cat) => {
    if (cat.archived || cat.group !== group) return false;
    if (group === 'revision') {
      const course = courses.find((c) => c.id === cat.courseId);
      return Boolean(course && course.status === 'active');
    }
    return true;
  });
}

export function totalMinutesForCategory(categoryId, dateISO) {
  return store
    .table('Sessions')
    .filter((s) => s.categoryId === categoryId && s.date === dateISO)
    .reduce((sum, s) => sum + s.minutes, 0);
}

export function totalMinutesForDay(dateISO) {
  return store
    .table('Sessions')
    .filter((s) => s.date === dateISO)
    .reduce((sum, s) => sum + s.minutes, 0);
}

export function recentSessions(limit = 10) {
  return store
    .table('Sessions')
    .filter((s) => s.source !== 'compacted')
    .sort((a, b) => (b.start || b.date).localeCompare(a.start || a.date))
    .slice(0, limit);
}

// The daily-total rows compaction.js rolls old sessions into — kept out of
// recentSessions() and shown in their own (collapsed-by-default) section
// instead, since they're history, not something you're about to edit.
export function compactedSessions() {
  return store
    .table('Sessions')
    .filter((s) => s.source === 'compacted')
    .sort((a, b) => b.date.localeCompare(a.date));
}

function earliestSessionDate() {
  const sessions = store.table('Sessions');
  if (!sessions.length) return null;
  return sessions.reduce((min, s) => (s.date < min ? s.date : min), sessions[0].date);
}

function listDatesBetween(startISO, endISO) {
  const dates = [];
  const cur = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T00:00:00');
  while (cur <= end) {
    dates.push(formatDateISO(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function lastNDays(n) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (n - 1));
  return listDatesBetween(formatDateISO(start), formatDateISO(today));
}

function settingValue(key) {
  return store.table('Settings').find((s) => s.key === key)?.value || null;
}

// range: '7' | '30' | 'semester' | 'all'
export function datesForRange(range) {
  const today = formatDateISO(new Date());
  if (range === '7') return lastNDays(7);
  if (range === '30') return lastNDays(30);

  if (range === 'semester') {
    const start = settingValue('semesterStart') || earliestSessionDate() || today;
    const end = settingValue('semesterEnd');
    const rangeEnd = end && end < today ? end : today;
    return listDatesBetween(start, rangeEnd);
  }

  // 'all'
  const start = earliestSessionDate() || today;
  return listDatesBetween(start, today);
}

// { date -> { revision: minutes, project: minutes, ... } }
export function minutesByGroupForDates(dates) {
  const categories = store.table('Categories');
  const groupOf = new Map(categories.map((c) => [c.id, c.group]));
  const dateSet = new Set(dates);
  const totals = {};
  for (const d of dates) {
    totals[d] = {};
    for (const s of GRAPH_SERIES) totals[d][s.key] = 0;
  }

  for (const session of store.table('Sessions')) {
    if (!dateSet.has(session.date)) continue;
    const rawGroup = groupOf.get(session.categoryId);
    const group = GROUP_ALIASES[rawGroup] || rawGroup;
    const series = GRAPH_SERIES.find((s) => s.group === group);
    if (series) totals[session.date][series.key] += session.minutes;
  }

  return totals;
}
