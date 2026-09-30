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
