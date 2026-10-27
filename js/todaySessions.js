// Links a Today/Notion task to the local Categories/Courses/Sessions tables
// so the Today subchannel's per-item stopwatch (js/views/today.js) can log
// real Sessions rows. Kept separate from js/sessions.js's generic
// group/category query helpers, which know nothing about Notion tasks.
import { store } from './store.js?v=65';
import { formatDateISO } from './format.js?v=65';

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

// ---- taskId -> work-day Sessions-row-id map, so pause/resume cycles on the
// same item converge on one row instead of fragmenting. A "work day" is the
// day a stopwatch run STARTED, not the calendar day it happened to be saved
// on — working past midnight (see addMinutesToTodaySession's workDayISO)
// keeps resuming into the same row it started in. Pruned to today-or-
// yesterday's entries on every read, so a genuinely stale entry (the same
// task worked on days ago) never resumes into that old row, while a
// just-crossed-midnight entry still gets found. ----
function loadSessionMap() {
  let map;
  try {
    const raw = localStorage.getItem(SESSION_MAP_KEY);
    map = raw ? JSON.parse(raw) : {};
  } catch {
    map = {};
  }
  const todayISO = formatDateISO(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayISO = formatDateISO(yesterday);
  let changed = false;
  for (const [taskId, entry] of Object.entries(map)) {
    if (entry.date !== todayISO && entry.date !== yesterdayISO) {
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

// ---- find-or-create a task's Sessions row for the given work day — the
// single source of truth for "one row per item per work-day", shared by the
// stopwatch's pause-save and the enhanced ✓-button flow. ----
function findOrCreateTodaySessionForTask(taskId, categoryId, taskName, workDayISO) {
  const map = loadSessionMap();
  const entry = map[taskId];
  if (entry && entry.date === workDayISO) {
    const existing = store.table('Sessions').find((s) => s.id === entry.sessionId);
    if (existing) return existing;
  }
  const row = store.upsert('Sessions', {
    categoryId,
    date: workDayISO,
    start: '',
    end: '',
    minutes: 0,
    source: SOURCE,
    note: taskName || '',
  });
  map[taskId] = { sessionId: row.id, date: workDayISO };
  saveSessionMap(map);
  return row;
}

// Minutes already saved for this task today-or-yesterday (0 if nothing
// logged yet) — for rendering the stopwatch's frozen value while
// paused/idle, including right after crossing midnight mid-session.
export function existingTodayMinutesForTask(taskId) {
  const entry = loadSessionMap()[taskId];
  if (!entry) return 0;
  return store.table('Sessions').find((s) => s.id === entry.sessionId)?.minutes || 0;
}

// Adds deltaMinutes to a task's Sessions row, creating it first if needed.
// workDayISO defaults to today (the enhanced ✓-button's preset-duration
// fallback, which has no stopwatch run to anchor to) but the stopwatch path
// (js/views/today.js's pauseActiveStopwatch) passes the run's own start
// day explicitly — working past midnight stays attributed entirely to the
// day the work started, never split or moved to the day it happened to be
// paused on. No CourseState bookkeeping here — the Revision subchannel's
// chart (js/views/revision.js) sums live Sessions rows directly for
// anything not yet compacted, and js/compaction.js folds a session's
// minutes into CourseState exactly once, when it later compacts (and
// deletes) that row.
export function addMinutesToTodaySession(taskId, categoryId, taskName, deltaMinutes, workDayISO = formatDateISO(new Date())) {
  if (!(deltaMinutes > 0)) return findOrCreateTodaySessionForTask(taskId, categoryId, taskName, workDayISO);
  const row = findOrCreateTodaySessionForTask(taskId, categoryId, taskName, workDayISO);
  return store.upsert('Sessions', { id: row.id, minutes: row.minutes + deltaMinutes, note: taskName || row.note });
}

// Closes out a stopwatch run that's still showing as "running" when the
// Today page is (re)mounted — tab closed without pausing, or just never
// revisited. Logs the full real elapsed time (start to now, however long
// that's been — no cap, same "no matter what" rule as the explicit pause
// path above) under the day the run STARTED. Only ever called at mount
// time (js/views/today.js), never on a live tick, so it can't cut off a
// session that's still actively being watched run past midnight — it only
// ever fires on a fresh look at the page. `task` is the resolved task
// object for the stale timer's taskId (or undefined, if it's since been
// deleted/uncached) — pass null/undefined-safe so the caller doesn't need
// to pre-check anything.
export function closeStaleTodayTimer(task) {
  const current = loadTimer();
  if (!current) return;
  saveTimer(null);
  if (!task) return;

  const cat = resolveCategoryForTask(task);
  if (!cat) return; // nothing to attribute it to — drop rather than guess

  const minutes = elapsedMinutesSince(current.startedAt);
  if (!(minutes > 0)) return;
  addMinutesToTodaySession(task.id, cat.id, task.name, minutes, formatDateISO(new Date(current.startedAt)));
}
