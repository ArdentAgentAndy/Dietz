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

export function hexForCourse(course) {
  return hexForNotionColor(COURSE_COLOR_NAME[course]);
}
