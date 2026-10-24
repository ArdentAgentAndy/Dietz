import { hexForNotionColor } from './notionColors.js?v=64';

// Display/sort order for categories, grouped with visual gaps between
// groups. Anything not listed here (shouldn't happen) sorts after all of it.
export const CATEGORY_GROUPS = [
  ['Examination', 'Revision', 'Homework'],
  ['Project', 'Research'],
  ['Meeting', 'Date'],
  ['Application'],
];
export const CATEGORY_ORDER = CATEGORY_GROUPS.flat();

export function categoryRank(category) {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

// Midpoint-marker shape per category (unfiltered view only). Categories not
// listed default to a plain circle.
export const SHAPE_BY_CATEGORY = {
  Examination: 'circle',
  Revision: 'square',
  Homework: 'diamond',
  Project: 'triangle',
  Research: 'x',
};

// Notion's own color for Research is "default" (a muted slate-gray), which
// reads too close to Project's gray and isn't very legible on the dark
// background. Override with something in the same neutral family as
// Project's gray, just lighter — distinguishable and legible.
export const CATEGORY_COLOR_OVERRIDES = {
  Research: '#4a4844',
};

export function categoryColorForTask(task) {
  return CATEGORY_COLOR_OVERRIDES[task.category] || hexForNotionColor(task.categoryColor);
}

// Categories that carry a course/project/lead sub-value, and which task
// property/color-property/label that sub-value lives under.
export const SUB_FILTER_BY_CATEGORY = {
  Project: { prop: 'project', colorProp: 'projectColor', label: 'Project' },
  Research: { prop: 'lead', colorProp: 'leadColor', label: 'Lead' },
  Revision: { prop: 'course', colorProp: 'courseColor', label: 'Course' },
  Homework: { prop: 'course', colorProp: 'courseColor', label: 'Course' },
  Examination: { prop: 'course', colorProp: 'courseColor', label: 'Course' },
};

// A task's course/project/lead sub-value + its own Notion color, or null if
// its category has no sub-value config or the task doesn't have one set.
export function subValueForTask(task) {
  const config = SUB_FILTER_BY_CATEGORY[task.category];
  if (!config) return null;
  const value = task[config.prop];
  if (!value) return null;
  return { value, label: config.label, color: hexForNotionColor(task[config.colorProp]) };
}

// The category-shaped emblem — a colored glyph for Research's "x" mark,
// otherwise a colored box shaped per SHAPE_BY_CATEGORY.
export function shapeEmblemHtml(task, catColor) {
  const shape = SHAPE_BY_CATEGORY[task.category] || 'circle';
  if (shape === 'x') {
    return `<span class="cal-chip-shape shape-x" style="color:${catColor};">&#10005;</span>`;
  }
  return `<span class="cal-chip-shape shape-${shape}" style="background:${catColor};"></span>`;
}

export function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function isoDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const CHICAGO_TZ = 'America/Chicago';

// This app has one canonical timezone (see CLAUDE.md) — every task's
// calendar day goes through this, not a raw slice of its UTC ISO string, so
// a task due late evening Chicago time (which crosses into the next UTC
// calendar day) still lands on the day it was actually meant for. Same
// technique js/views/public.js's chicagoDay already uses.
function chicagoDay(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: CHICAGO_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function taskDay(task) {
  if (!task.date?.start) return null;
  if (task.date.start.length <= 10) return task.date.start; // date-only — already unambiguous
  return chicagoDay(new Date(task.date.start));
}
