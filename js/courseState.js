import { store } from './store.js?v=63';

// CourseState rows are keyed by (courseId, key) rather than a UUID — a
// synthetic "courseId:key" id keeps that natural key compatible with the
// generic store.upsert/remove API.
function rowId(courseId, key) {
  return `${courseId}:${key}`;
}

export function getCourseState(courseId) {
  const map = {};
  for (const row of store.table('CourseState')) {
    if (row.courseId === courseId) map[row.key] = row.value;
  }
  return map;
}

export function setCourseState(courseId, key, value) {
  store.upsert('CourseState', { id: rowId(courseId, key), courseId, key, value });
}

export function clearCourseState(courseId) {
  for (const row of store.table('CourseState').filter((r) => r.courseId === courseId)) {
    store.remove('CourseState', row.id);
  }
}

// Running, never-recomputed total of all-time revision-group study minutes
// for a course (the Revision subchannel's bar chart reads this directly).
// This is the only way to keep an accurate "forever" total once
// compaction.js discards per-course detail for anything older than
// yesterday — every place that creates/edits/deletes a revision-group
// Sessions row calls this with a +/- delta instead of the chart ever
// re-summing raw session history itself.
export function addCourseRevisionMinutes(courseId, deltaMinutes) {
  if (!courseId || !deltaMinutes) return;
  const current = getCourseState(courseId).totalRevisionMinutes || 0;
  setCourseState(courseId, 'totalRevisionMinutes', current + deltaMinutes);
}
