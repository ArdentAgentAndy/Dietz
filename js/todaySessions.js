// Links a Today/Notion task to the local Categories/Courses/Sessions tables
// so the Today subchannel's per-item stopwatch (js/views/today.js) can log
// real Sessions rows. Kept separate from js/sessions.js's generic
// group/category query helpers, which know nothing about Notion tasks.
import { store } from './store.js?v=63';
import { formatDateISO } from './format.js?v=63';

const TIMER_KEY = 'dietz:todayTimer';
const SESSION_MAP_KEY = 'dietz:todayTimerSessions';
const SOURCE = 'today-item';

// Only these categories carry a course/project/lead value at all (see
// js/taskDisplay.js's SUB_FILTER_BY_CATEGORY) — anything else (Meeting,
// Date, Application, Lesson, uncategorized) has nothing to log time against.
const RESOLVABLE_CATEGORIES = ['Project', 'Research', 'Revision', 'Homework', 'Examination'];

// ---- stopwatch run-state: same {taskId/categoryId, startedAt} + localStorage
// pattern as js/timer.js's category-card timer, just keyed by taskId under
// its own key so the two timers can't collide. ----
function loadTimer() {
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveTimer(timer) {
  if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  else localStorage.removeItem(TIMER_KEY);
}

export function todayTimerState() {
  return loadTimer();
}

export function startTodayTimer(taskId) {
  saveTimer({ taskId, startedAt: Date.now() });
}

// Clears the running timer and hands back whatever was running (or null).
// Doesn't save anything itself — the caller still needs to resolve the
// task's category to know where the elapsed time goes.
export function stopTodayTimer() {
  const current = loadTimer();
  saveTimer(null);
  return current;
}

export function elapsedMinutesSince(startedAt) {
  return (Date.now() - startedAt) / 60000;
}

// ---- taskId -> today's Sessions-row-id map, so pause/resume cycles on the
// same item the same day converge on one row instead of fragmenting. Pruned
// to just today's entries on every read, so a stale entry from a prior day
// never resumes into that old row. ----
function loadSessionMap() {
  let map;
  try {
    const raw = localStorage.getItem(SESSION_MAP_KEY);
    map = raw ? JSON.parse(raw) : {};
  } catch {
    map = {};
  }
  const todayISO = formatDateISO(new Date());
  let changed = false;
  for (const [taskId, entry] of Object.entries(map)) {
    if (entry.date !== todayISO) {
      delete map[taskId];
      changed = true;
    }
  }
  if (changed) localStorage.setItem(SESSION_MAP_KEY, JSON.stringify(map));
  return map;
}

function saveSessionMap(map) {
  localStorage.setItem(SESSION_MAP_KEY, JSON.stringify(map));
}

// ---- task -> Categories row resolution ----
export function resolvableCategory(task) {
  return RESOLVABLE_CATEGORIES.includes(task.category);
}

export function resolveCategoryForTask(task) {
  if (!resolvableCategory(task)) return null;
  if (task.category === 'Project') {
    return store.table('Categories').find((c) => c.group === 'project' && c.name === task.project) || null;
  }
  if (task.category === 'Research') {
    return store.table('Categories').find((c) => c.group === 'research' && c.name === task.lead) || null;
  }
  // Revision / Homework / Examination all share one revision-group category per course.
  const course = store.table('Courses').find((c) => c.code === task.course);
  if (!course) return null;
  return store.table('Categories').find((c) => c.group === 'revision' && c.courseId === course.id) || null;
}

// The raw course/project/lead string that failed to match, for a blocking
// error message. '' if the task resolved fine, or isn't resolvable at all.
export function unresolvedLabelForTask(task) {
  if (!resolvableCategory(task) || resolveCategoryForTask(task)) return '';
  if (task.category === 'Project') return task.project || '(no project set)';
  if (task.category === 'Research') return task.lead || '(no lead set)';
  return task.course || '(no course set)';
}

// ---- find-or-create today's Sessions row for this task — the single
// source of truth for "one row per item per day", shared by the stopwatch's
// pause-save and the enhanced ✓-button flow. ----
function findOrCreateTodaySessionForTask(taskId, categoryId, taskName) {
  const todayISO = formatDateISO(new Date());
  const map = loadSessionMap();
  const entry = map[taskId];
  if (entry) {
    const existing = store.table('Sessions').find((s) => s.id === entry.sessionId);
    if (existing) return existing;
  }
  const row = store.upsert('Sessions', {
    categoryId,
    date: todayISO,
    start: '',
    end: '',
    minutes: 0,
    source: SOURCE,
    note: taskName || '',
  });
  map[taskId] = { sessionId: row.id, date: todayISO };
  saveSessionMap(map);
  return row;
}

// Minutes already saved for this task today (0 if nothing logged yet) — for
// rendering the stopwatch's frozen value while paused/idle.
export function existingTodayMinutesForTask(taskId) {
  const entry = loadSessionMap()[taskId];
  if (!entry) return 0;
  return store.table('Sessions').find((s) => s.id === entry.sessionId)?.minutes || 0;
}

// Adds deltaMinutes to today's per-item row (creating it first if needed).
// No CourseState bookkeeping here — the Revision subchannel's chart
// (js/views/revision.js) sums live Sessions rows directly for anything not
// yet compacted, and js/compaction.js folds a session's minutes into
// CourseState exactly once, when it later compacts (and deletes) that row.
export function addMinutesToTodaySession(taskId, categoryId, taskName, deltaMinutes) {
  if (!(deltaMinutes > 0)) return findOrCreateTodaySessionForTask(taskId, categoryId, taskName);
  const row = findOrCreateTodaySessionForTask(taskId, categoryId, taskName);
  return store.upsert('Sessions', { id: row.id, minutes: row.minutes + deltaMinutes, note: taskName || row.note });
}
