// Notion's fixed set of tag colors, mapped to hex so they render on Dietz's
// dark background. Several intentionally reuse the app's existing
// GRAPH_SERIES colors (sessions.js) since Category options happen to line
// up with those same groups (Revision/Homework/Project/Research).
const NOTION_COLOR_HEX = {
  default: '#7a8ba6',
  gray: '#9b9a97',
  brown: '#b8794f',
  orange: '#e0a458',
  yellow: '#e8c547',
  green: '#3fb87f',
  blue: '#3987e5',
  purple: '#9b59b6',
  pink: '#e0779e',
  red: '#ff6b6b',
};

export function hexForNotionColor(color) {
  return NOTION_COLOR_HEX[color] || NOTION_COLOR_HEX.default;
}

// Course -> Notion color name, matching the Course select property's actual
// colors in the Main database — kept in sync manually since Canvas events
// (unlike Notion tasks) carry no color of their own, and the Canvas tab
// should still look consistent with the Notion-backed Calendar tab.
const COURSE_COLOR_NAME = {
  'MATH 241': 'green',
  'CS 124': 'purple',
  'ENG 100': 'yellow',
  'AE 100': 'gray',
  'TE 200': 'orange',
  'CLCV 115': 'red',
  'AFST 112': 'brown',
  // Canvas cross-lists this course under HIST 112 instead of AFST 112 (the
  // code the Home page/Notion use) — same course, same color.
  'HIST 112': 'brown',
  'MATH 231': 'pink',
  'CS 101': 'purple',
  'PHYS 211': 'blue',
  'AE 140': 'default',
};

// Accepts either a plain course code string (the original signature — used
// where only the code is available, e.g. a Canvas event, which deliberately
// stays locked to this fixed mapping so it keeps matching Notion's own
// Course-select colors — see the comment above COURSE_COLOR_NAME) or a full
// Courses row. Passing the row lets a user-set course.color (the Courses
// page's color picker) override the fixed mapping for Dietz's own views
// (Courses/Logging/Revision) without touching what Canvas/Notion show,
// since those read color from elsewhere entirely (task.courseColor, a
// Notion-provided field — see js/taskDisplay.js) and never call this at all.
export function hexForCourse(courseOrCode) {
  const code = typeof courseOrCode === 'string' ? courseOrCode : courseOrCode?.code;
  const customColor = typeof courseOrCode === 'object' ? courseOrCode?.color : null;
  if (customColor) return hexForNotionColor(customColor);
  return hexForNotionColor(COURSE_COLOR_NAME[code]);
}

const PALETTE_NAMES = Object.keys(NOTION_COLOR_HEX).filter((name) => name !== 'default');

// For a color-picker UI (js/views/courses.js) — every selectable swatch,
// name + hex together.
export const COLOR_PALETTE = PALETTE_NAMES.map((name) => ({ name, hex: NOTION_COLOR_HEX[name] }));

// Deterministic color for a label with no fixed mapping of its own (a
// Project/Research category's name — the "project/lead" sub-identity on
// the Sessions list) — same palette as hexForCourse, picked by hashing the
// string so a given name always lands on the same color across reloads.
export function hexForLabel(label) {
  if (!label) return NOTION_COLOR_HEX.default;
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return NOTION_COLOR_HEX[PALETTE_NAMES[Math.abs(hash) % PALETTE_NAMES.length]];
}
