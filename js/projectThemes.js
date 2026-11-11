// Hand-edited planning data for the Projects page (#/projects,
// js/views/projects.js), same "edit an array, no build step" spirit as
// js/roadmapCourses.js. Which tier or skills group a project belongs to is a
// planning choice, not Notion data, so it lives here rather than in a synced
// table. A project's name, color, archived flag and tasks still come from the
// Categories table / Notion (see js/projects.js).
//
// "Tier" is the yearly group. "Phase" is reserved for a project's own lettered
// milestone phases (A, B, C) on its project page.

// One tier per college year, about 3 projects each, done in order. Labels 2–4
// are placeholders, not decided yet.
export const TIERS = [
  { n: 1, label: 'Learning' },
  { n: 2, label: 'Building' },
  { n: 3, label: 'Researching' },
  { n: 4, label: 'Leading' },
];

// How many project slots each tier column has.
export const TIER_SLOTS = 3;

// The tier being worked on now: drawn full-strength, the others dimmed.
// Bump this by hand at the start of each year.
export const CURRENT_TIER = 1;

// Skills-field groups, in display order. A skills project with no `tag` (or
// one not listed here) is shown first, with no heading.
export const SKILL_TAGS = ['Software', 'Hardware', 'Aero analysis'];

// Keyed by the project's exact name (the same string as its Categories row /
// Notion Project option, so color and tasks line up).
//   Tier project:   { theme: 'tier', tier: 1–4, slot: 0–2 }
//   Skills project: { theme: 'skills', tag: one of SKILL_TAGS }
// Optional `color`: a Notion color name (e.g. 'green'), used only when Notion
// has no color for the project yet.
// A project with no entry here isn't shown on the Projects page at all.
export const PROJECT_THEMES = {
  Decay: { theme: 'tier', tier: 1, slot: 0 },
  Flightstack: { theme: 'tier', tier: 1, slot: 1 },
  Spindock: { theme: 'tier', tier: 1, slot: 2, color: 'green' },
  Spaceshot: { theme: 'skills' },
  Dietz: { theme: 'skills' },
};
