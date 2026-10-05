import { store } from './store.js?v=52';

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
