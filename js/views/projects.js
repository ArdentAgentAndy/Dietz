import { escapeHtml } from '../format.js?v=67';
import { fetchNotionSchema } from '../notion.js?v=67';
import { allProjects } from '../projects.js?v=67';
import { TIERS, TIER_SLOTS, CURRENT_TIER, SKILL_TAGS } from '../projectThemes.js?v=67';
import { BLOB_PRESET_COUNT, letterHtml, pebbleColorVars } from '../pebbles.js?v=67';

// The Projects index (#/projects), reached from the Menu's Inner layer. Two
// themes (see js/projectThemes.js):
//   - the tier track: one column per college-year tier, TIER_SLOTS pebbles
//     each, joined by dashed bonds, tiers linked left to right like a timeline;
//   - the skills field: an open-ended cluster grouped by tag.
// Only projects placed in js/projectThemes.js are shown. A pebble opens
// #/projects/<slug>.

let container = null;

// The tier track's own logical coordinate space, 1:1 with its SVG viewBox
// (same idea as the Menu's 0-1000 square): x across the 4 columns, y down.
// Nodes are placed by % of this box, so bonds and pebbles stay glued together
// at any width.
const TRACK_W = 1000;
const TRACK_H = 720;
const TRACK_LABEL_Y = 70;
const TRACK_SLOT_Y = [220, 420, 620];
// A small alternating sideways nudge, so a column reads as hand-placed
// pebbles rather than a ruled list.
const TRACK_SLOT_NUDGE_X = [-18, 18, -18];
// How far either side of a column's center its tier label's link line stops.
const TRACK_LINK_GAP_X = 95;

function columnX(tierIndex) {
  return (TRACK_W / TIERS.length) * (tierIndex + 0.5);
}

function slotPos(tierIndex, slot) {
  return { x: columnX(tierIndex) + TRACK_SLOT_NUDGE_X[slot], y: TRACK_SLOT_Y[slot] };
}

function percentStyle(pos) {
  return `left:${(pos.x / TRACK_W) * 100}%; top:${(pos.y / TRACK_H) * 100}%;`;
}

export function render(rootEl) {
  container = rootEl;
  window.addEventListener('keydown', onKeyDown);
  rebuild();
  // Notion's own project colors/options, refreshed in the background — same
  // pattern as Logging. A miss just keeps the hashed fallback colors.
  fetchNotionSchema().then(() => { if (container) rebuild(); }).catch(() => {});
}

export function unmount() {
  window.removeEventListener('keydown', onKeyDown);
  container = null;
}

// One pebble. `index` only picks its .menu-blob-N outline. An empty tier slot
// passes project = null and renders an inert ??? placeholder.
function pebbleHtml(project, index, { style = '', extraClass = '', attrs = '' } = {}) {
  const blob = `menu-blob-${index % BLOB_PRESET_COUNT}`;
  if (!project) {
    return `
      <div class="menu-node menu-node-channel projects-pebble is-empty ${blob} ${extraClass}" style="${style}" ${attrs} aria-hidden="true">
        <span class="menu-node-content"><span class="projects-pebble-name mono">???</span></span>
      </div>
    `;
  }
  const classes = ['menu-node', 'menu-node-channel', 'projects-pebble', blob, extraClass];
  if (project.archived) classes.push('is-archived');
  return `
    <button type="button" class="${classes.join(' ')}" ${attrs} data-slug="${escapeHtml(project.slug)}" data-name="${escapeHtml(project.name)}" style="${style} ${pebbleColorVars(project.hex)}" title="${escapeHtml(project.name)}${project.archived ? ' (archived)' : ''}">
      <span class="menu-node-content">
        ${letterHtml(project.name, project.hex)}
        <span class="projects-pebble-name mono">${escapeHtml(project.name)}</span>
      </span>
    </button>
  `;
}

function tierTrackHtml(projects) {
  let bonds = '';
  let nodes = '';
  TIERS.forEach((tier, t) => {
    const x = columnX(t);
    const tierClass = tier.n === CURRENT_TIER ? 'is-current-tier' : 'is-other-tier';
    const inTier = projects.filter((p) => p.theme?.theme === 'tier' && p.theme.tier === tier.n);

    nodes += `
      <div class="projects-tier-label mono ${tierClass}" data-tier="${tier.n}" style="${percentStyle({ x, y: TRACK_LABEL_Y })}">
        <span class="projects-tier-number">${tier.n}</span> ${escapeHtml(tier.label)}
      </div>
    `;

    // Tier label → slot 0 → slot 1 → slot 2, then this tier's label → the next one's.
    let prev = { x, y: TRACK_LABEL_Y + 45 };
    for (let slot = 0; slot < TIER_SLOTS; slot++) {
      const pos = slotPos(t, slot);
      bonds += `<line class="projects-bond ${tierClass}" x1="${prev.x}" y1="${prev.y}" x2="${pos.x}" y2="${pos.y}"></line>`;
      prev = pos;
      const project = inTier.find((p) => p.theme.slot === slot) || null;
      nodes += pebbleHtml(project, t * TIER_SLOTS + slot, { style: percentStyle(pos), extraClass: tierClass, attrs: `data-tier-pebble="${tier.n}"` });
    }
    if (t < TIERS.length - 1) {
      bonds += `<line class="projects-bond projects-tier-link" x1="${x + TRACK_LINK_GAP_X}" y1="${TRACK_LABEL_Y}" x2="${columnX(t + 1) - TRACK_LINK_GAP_X}" y2="${TRACK_LABEL_Y}"></line>`;
    }
  });

  return `
    <div class="projects-track" style="aspect-ratio: ${TRACK_W} / ${TRACK_H};">
      <svg class="projects-track-bonds" viewBox="0 0 ${TRACK_W} ${TRACK_H}" preserveAspectRatio="none" aria-hidden="true">${bonds}</svg>
      ${nodes}
    </div>
  `;
}

function clusterHtml(projects, startIndex = 0) {
  return `<div class="projects-cluster">${projects.map((p, i) => pebbleHtml(p, startIndex + i)).join('')}</div>`;
}

function skillsHtml(projects) {
  const skills = projects.filter((p) => p.theme?.theme === 'skills');
  if (!skills.length) return '<p class="muted">No skills projects yet.</p>';
  // Tagged groups get a heading; untagged skills (tag: null) sit first, with
  // no heading of their own.
  const tagOf = (p) => (SKILL_TAGS.includes(p.theme.tag) ? p.theme.tag : null);
  const groups = [null, ...SKILL_TAGS].map((tag) => ({
    tag,
    items: skills.filter((p) => tagOf(p) === tag),
  })).filter((g) => g.items.length);
  let index = 0;
  return groups.map((g) => {
    const html = `
      <div class="projects-group">
        ${g.tag ? `<h3 class="mono projects-group-title">${escapeHtml(g.tag)}</h3>` : ''}
        ${clusterHtml(g.items, index)}
      </div>
    `;
    index += g.items.length;
    return html;
  }).join('');
}

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

function rebuild() {
  if (!container) return;
  // Only projects placed in js/projectThemes.js are shown.
  const projects = allProjects().filter((p) => p.theme).sort(byName);

  container.innerHTML = `
    <div class="projects-page">
      <section class="card row-between">
        <h1 class="mono">Projects</h1>
        <a href="#/projects/board" class="btn mono">Whiteboard</a>
      </section>
      <section class="card">
        <h2 class="mono">Tiers</h2>
        ${tierTrackHtml(projects)}
      </section>
      <section class="card">
        <h2 class="mono">Skills</h2>
        ${skillsHtml(projects)}
      </section>
    </div>
  `;

  container.querySelectorAll('.projects-pebble[data-slug]').forEach((el) => {
    el.addEventListener('click', () => openProject(el.dataset.slug));
  });
}

function openProject(slug) {
  location.hash = `#/projects/${slug}`;
}

function isBlocked(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return true;
  return Boolean(document.querySelector('dialog[open]'));
}

// Projects are click-only, with no per-project keybinds. Esc goes back to the
// Menu (M is nav.js's global "go to Menu").
function onKeyDown(e) {
  if (!container || isBlocked(e)) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    location.hash = '#/';
  }
}
