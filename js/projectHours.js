// Hours logged per project, for the project page (js/views/project.js).
//
// The problem: js/compaction.js rolls every session older than yesterday into
// one "daily total" row per group, dropping which project it was for. So
// Sessions alone only knows about the last day or two. Same fix as the
// Revision page's per-course total (js/courseState.js's
// addCourseRevisionMinutes): just before compaction deletes a project
// session, its minutes are added to a running per-project tally here. A
// project's hours are that tally plus whatever raw sessions haven't been
// compacted yet. Nothing is counted twice: compaction updates the tally in
// the same step it deletes the raw rows.
//
// Stored in the CourseState key/value table (no new Sheet table needed), under
// a "project:<category id>" owner id so it can never collide with a real
// course id. One key per week that had any time, 'week:<Monday yyyy-MM-dd>';
// the all-time total is just their sum. Hours logged before this existed
// were already compacted away, so tallies start from when it shipped.
import { store } from './store.js?v=70';
import { formatDateISO } from './format.js?v=70';
import { getCourseState, setCourseState } from './courseState.js?v=70';
import { isCompactedCategory } from './sessions.js?v=70';

const WEEK_PREFIX = 'week:';

function ownerId(categoryId) {
  return `project:${categoryId}`;
}

// The Monday (yyyy-MM-dd) of the week a yyyy-MM-dd date falls in.
export function weekStart(dateISO) {
  const d = new Date(`${dateISO}T00:00:00`);
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return formatDateISO(d);
}

// Called by js/compaction.js for each project-group session it's about to
// delete. `categoryId` is the session's own (real) project category.
export function addProjectMinutes(categoryId, dateISO, minutes) {
  if (!categoryId || !minutes) return;
  const owner = ownerId(categoryId);
  const weekKey = WEEK_PREFIX + weekStart(dateISO);
  const current = Number(getCourseState(owner)[weekKey]) || 0;
  setCourseState(owner, weekKey, current + minutes);
}

// Every real project category with this exact name (normally one).
function categoryIdsForProject(name) {
  return store.table('Categories')
    .filter((c) => c.group === 'project' && c.name === name && !isCompactedCategory(c))
    .map((c) => c.id);
}

// { 'yyyy-MM-dd' (Monday) -> minutes } for one project: compacted tallies plus
// its not-yet-compacted sessions.
export function projectMinutesByWeek(name) {
  const ids = categoryIdsForProject(name);
  const idSet = new Set(ids);
  const byWeek = {};
  const add = (week, minutes) => { byWeek[week] = (byWeek[week] || 0) + minutes; };

  for (const id of ids) {
    const state = getCourseState(ownerId(id));
    for (const [key, value] of Object.entries(state)) {
      if (key.startsWith(WEEK_PREFIX)) add(key.slice(WEEK_PREFIX.length), Number(value) || 0);
    }
  }
  for (const s of store.table('Sessions')) {
    if (s.source === 'compacted' || !idSet.has(s.categoryId)) continue;
    add(weekStart(s.date), Number(s.minutes) || 0);
  }
  return byWeek;
}

// Minutes logged on one day. Only today/yesterday are ever asked for, and
// those are never compacted, so raw sessions alone are exact.
export function projectMinutesOnDay(name, dateISO) {
  const idSet = new Set(categoryIdsForProject(name));
  return store.table('Sessions')
    .filter((s) => s.source !== 'compacted' && s.date === dateISO && idSet.has(s.categoryId))
    .reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
}

export function projectTotalMinutes(name) {
  return Object.values(projectMinutesByWeek(name)).reduce((sum, m) => sum + m, 0);
}
