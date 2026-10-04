// One-time (idempotent) fixups for course rubric configs that changed shape
// after the app was already seeded with real grade data. seed.js only
// applies to a brand-new install — an existing Courses row's configJson has
// to be patched in place to pick up a rubric change made after the fact.
import { store } from './store.js?v=31';
import { courseConfigs } from './seed.js?v=31';

export function migrateCourseConfigs() {
  for (const course of store.table('Courses')) {
    const seedConfig = courseConfigs[course.id];
    if (!seedConfig) continue; // user-added course, not one of ours to migrate
    if (course.configJson === JSON.stringify(seedConfig)) continue; // already current

    const oldConfig = JSON.parse(course.configJson);

    // CLCV 115 moved off a 1000-point scale onto percentage weights, and its
    // bonus/extraCredit/penalty values move with it (see grading.js) — any
    // extraCreditPoints already logged under the old scale (max 20) has to
    // shrink to match the new one (max 2) or it'd clamp to 10x its intent.
    if (course.id === 'clcv115' && oldConfig.type === 'points' && seedConfig.type === 'weighted') {
      const state = store.table('CourseState').find((s) => s.courseId === course.id && s.key === 'extraCreditPoints');
      if (state && Number(state.value)) {
        store.upsert('CourseState', { id: state.id, value: Number(state.value) / 10 });
      }
    }

    store.upsert('Courses', { id: course.id, configJson: JSON.stringify(seedConfig) });
  }
}
