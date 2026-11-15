import { store } from './store.js?v=69';
import { getCachedNotionSchema } from './notion.js?v=69';
import { hexForLabel, hexForNotionColor } from './notionColors.js?v=69';
import { PROJECT_THEMES } from './projectThemes.js?v=69';
import { isCompactedCategory } from './sessions.js?v=69';

// The seeded catch-all "Project work" category (js/seed.js) — a logging
// bucket, not a real project, so it never gets a pebble.
const GENERIC_PROJECT_CATEGORY_ID = 'project-default';

export function projectSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
}

// Every project the app knows about, merged by exact name from:
//   - Categories rows with group 'project' (name, archived flag)
//   - Notion's Project select options (cached schema)
//   - js/projectThemes.js (planned ones that may exist nowhere else yet)
// Each comes back as { name, slug, hex, archived, theme }, where theme is that
// project's PROJECT_THEMES entry or null (unsorted). Color is Notion's own for
// that option when cached, the same lookup Logging uses, else the theme
// entry's `color` (a Notion color name), else a stable hash.
export function allProjects() {
  const schema = getCachedNotionSchema();
  const byName = new Map();
  // Categories is added first, so its archived flag is the one that sticks.
  // The other sources have no archived concept of their own.
  const add = (name, archived = false) => {
    if (!name || byName.has(name)) return;
    byName.set(name, { name, archived });
  };

  store.table('Categories')
    .filter((c) => c.group === 'project' && c.id !== GENERIC_PROJECT_CATEGORY_ID && !isCompactedCategory(c))
    .forEach((c) => add(c.name, Boolean(c.archived)));
  (schema?.project || []).forEach((name) => add(name));
  Object.keys(PROJECT_THEMES).forEach((name) => add(name));

  return [...byName.values()].map((p) => {
    const notionColor = schema?.projectColors?.[p.name] || PROJECT_THEMES[p.name]?.color;
    return {
      ...p,
      slug: projectSlug(p.name),
      hex: notionColor ? hexForNotionColor(notionColor) : hexForLabel(p.name),
      theme: PROJECT_THEMES[p.name] || null,
    };
  });
}

export function projectBySlug(slug) {
  return allProjects().find((p) => p.slug === slug) || null;
}
