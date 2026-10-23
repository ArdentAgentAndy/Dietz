import { store } from './store.js?v=63';
import { formatDateISO } from './format.js?v=63';

const TIMER_KEY = 'dietz:timer';

function load() {
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(timer) {
  if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  else localStorage.removeItem(TIMER_KEY);
}

export const timerState = {
  get current() {
    return load();
  },
};

export function startTimer(categoryId) {
  if (load()) stopTimer();
  save({ categoryId, startedAt: Date.now() });
}

export function stopTimer() {
  const current = load();
  if (!current) return null;
  const endedAt = Date.now();
  const elapsedMs = endedAt - current.startedAt;
  save(null);

  // Revision-group minutes aren't tallied into CourseState here — the
  // Revision subchannel's chart (js/views/revision.js) sums live Sessions
  // rows directly for anything not yet compacted, and js/compaction.js
  // folds a session's minutes into CourseState exactly once, at the moment
  // it compacts (and deletes) that row. Doing it here too would double-count.
  return store.upsert('Sessions', {
    categoryId: current.categoryId,
    date: formatDateISO(new Date(current.startedAt)),
    start: new Date(current.startedAt).toISOString(),
    end: new Date(endedAt).toISOString(),
    minutes: elapsedMs / 60000,
    source: 'timer',
    note: '',
  });
}

// If the tab is left open (or just not touched) across midnight while a
// category timer is running, nothing otherwise closes it out — stopTimer()
// above is the only place a Sessions row gets written, and only on an
// explicit click. Called once at app boot (js/app.js, alongside
// compaction) — deliberately NOT on a live tick, since a tick fires every
// second on a page that's actively open, and auto-closing there would cut
// off a timer the user is still actively running the moment it happens to
// cross midnight (working late is the normal case here, not the exception
// — see the "no matter what" framing on stopTimer's own date logic above,
// which this reuses verbatim: full real elapsed time, dated to the day the
// timer started, never capped or split at midnight). Boot only fires on a
// fresh page load, which is the right moment to ask "was this left running
// since before" — a same-day timer still legitimately in progress is left
// untouched (same calendar day in, nothing to reconcile). Returns the
// logged Sessions row, or null if there was nothing to close.
export function reconcileTimerDayBoundary() {
  const current = load();
  if (!current) return null;
  const startDay = formatDateISO(new Date(current.startedAt));
  if (startDay === formatDateISO(new Date())) return null;
  return stopTimer();
}
