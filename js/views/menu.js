import { HOME, CHANNELS } from '../channels.js?v=64';
import { escapeHtml } from '../format.js?v=64';
import { hexForLabel } from '../notionColors.js?v=64';

let container = null;
// -1 = nothing selected yet (fresh page visit) — the first Left/Right press
// lands on Records (index 0) rather than moving relative to a starting
// point, see moveSelection.
let selectedIndex = -1;
// Index into the currently selected channel's subchannels, or -1 — set by a
// number key (see selectByNumber) or Up/Down (see moveSubSelection), cleared
// whenever the channel selection itself changes. Only ever meaningful
// alongside a non—-1 selectedIndex. Selecting a subchannel this way doesn't
// navigate by itself; Enter commits it (see confirmSelection) — same
// two-step select-then-confirm as the top nav's ArrowUp/Down + Enter.
let selectedSubIndex = -1;

// How far .menu-tree-viewport scales up around the focused node — see
// applySelectionClasses. One fixed value rather than a per-depth one: the
// *origin* moving from a channel's own pos to its selected subchannel's pos
// (see focusPos below) is what makes drilling into a subchannel read as
// "zooming in further", not a bigger scale number.
const ZOOM_SCALE = '1.7';

export function render(rootEl) {
  container = rootEl;

  const app = container.closest('#app');
  app?.classList.add('app-no-scroll');
  // Measured, not guessed — the exact pixel height of the sticky topnav, so
  // the stage below fills precisely the remaining viewport with nothing
  // left to scroll, regardless of how tall the topnav happens to render
  // (wraps to two lines on narrow widths, font differences, etc.).
  const topnav = document.querySelector('.topnav');
  if (app && topnav) app.style.setProperty('--topnav-h', `${topnav.offsetHeight}px`);
  document.body.classList.add('menu-no-scroll');

  window.addEventListener('keydown', onKeyDown);
  build();
}

export function unmount() {
  clearSelection();
  const app = container?.closest('#app');
  app?.classList.remove('app-no-scroll');
  app?.style.removeProperty('--topnav-h');
  document.body.classList.remove('menu-no-scroll');
  window.removeEventListener('keydown', onKeyDown);
  container = null;
}

function goHome() {
  location.hash = '#' + HOME.route;
}

function goToChannel(channel) {
  if (!channel.route) return;
  location.hash = '#' + channel.route;
}

function goToSubchannel(sub) {
  location.hash = '#' + sub.route;
}

// First Left/Right press (selectedIndex still -1) always lands on Records,
// regardless of direction — after that, each press moves one channel
// further in that direction, wrapping around (array order, see
// channels.js — purely an index walk, independent of any node's actual
// on-screen position). Changing which channel is highlighted always drops
// any subchannel selection within the previous one — it wouldn't mean
// anything pointed at a different channel.
function moveSelection(delta) {
  if (selectedIndex === -1) {
    selectedIndex = 0;
  } else {
    const n = CHANNELS.length;
    selectedIndex = ((selectedIndex + delta) % n + n) % n;
  }
  selectedSubIndex = -1;
  applySelectionClasses();
}

// Number keys only ever pick among the *currently selected* channel's
// subchannels (1 = first, in the same order they're laid out) — Left/Right
// is the only way to move between channels themselves. A digit pressed with
// no channel selected, or past the current channel's subchannel count, is a
// no-op. This only *selects* a subchannel, same highlight-only behavior as
// Left/Right for channels — Enter is what commits it (see confirmSelection).
function selectByNumber(n) {
  const current = selectedIndex !== -1 ? CHANNELS[selectedIndex] : null;
  if (!current || n > current.subchannels.length) return;
  selectedSubIndex = n - 1;
  applySelectionClasses();
}

// Up/Down cycle through the *currently selected* channel's subchannels —
// same order the number keys and the pills' own layout use, wrapping around
// same as Left/Right does for channels. A no-op with no channel selected,
// or one with no subchannels at all.
function moveSubSelection(delta) {
  if (selectedIndex === -1) return;
  const subs = CHANNELS[selectedIndex].subchannels;
  if (!subs.length) return;
  if (selectedSubIndex === -1) {
    selectedSubIndex = delta > 0 ? 0 : subs.length - 1;
  } else {
    const n = subs.length;
    selectedSubIndex = ((selectedSubIndex + delta) % n + n) % n;
  }
  applySelectionClasses();
}

// Enter commits whatever is currently selected: a chosen subchannel takes
// priority (the point of selecting one is to go there), otherwise a
// highlighted channel that carries its own route (Records/Public) navigates
// — same as clicking it. A channel with neither has nothing to commit to.
function confirmSelection() {
  if (selectedIndex === -1) return;
  const ch = CHANNELS[selectedIndex];
  if (selectedSubIndex !== -1 && ch.subchannels[selectedSubIndex]) {
    goToSubchannel(ch.subchannels[selectedSubIndex]);
    return;
  }
  if (ch.route) goToChannel(ch);
}

// Escape zooms all the way back out — same end state as a fresh page visit
// (and what unmount() resets to on the way out). Shared by the keyboard
// binding below and by tapping the stage's empty background (see build()),
// which is touch's equivalent of this same key.
function clearSelection() {
  selectedIndex = -1;
  selectedSubIndex = -1;
  applySelectionClasses();
}

// Scoped to this page only (added/removed in render()/unmount()) rather
// than wired up globally in nav.js. nav.js's own ArrowLeft/ArrowRight
// handling (channel cycling in the top row) is itself a no-op while Menu is
// open — see onMenuPage() there — so there's no conflict between the two
// listeners both reacting to the same keypress.
function onKeyDown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Nothing opens a <dialog> while Menu is mounted today, but Escape is the
  // browser-native "close the open dialog" key — defensive guard against a
  // future modal stacking on top of Menu and double-firing both its own
  // close and this page's zoom-out/selection handling at once. Same guard
  // nav.js's onKeyDown already uses for its own keys.
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    clearSelection();
    return;
  }
  if (e.key === 'h' || e.key === 'H') {
    e.preventDefault();
    goHome();
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    moveSelection(1);
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    moveSelection(-1);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveSubSelection(1);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveSubSelection(-1);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    confirmSelection();
    return;
  }
  const n = Number(e.key);
  if (e.key.length === 1 && Number.isInteger(n) && n >= 1 && n <= 9) {
    e.preventDefault();
    selectByNumber(n);
  }
}

// Inline left%/top% straight from a node's own pos (channels.js) — pos.x/10
// is pos.x's position on the 0-1000 logical square expressed as a percent
// of the stage, same space the SVG edges below draw in 1:1 (viewBox 0 0
// 1000 1000), so a node and the line pointing at it never need separate
// math to agree on where it is. extra appends any additional inline style
// (the per-channel color custom properties, see channelColorVars).
function nodeStyle(pos, extra = '') {
  return `left:${pos.x / 10}%; top:${pos.y / 10}%;${extra}`;
}

// A channel's own color (js/notionColors.js's hexForLabel — deterministic,
// no stored field needed) applied to both the channel's own node and every
// one of its subchannels, so a whole branch of the tree reads as one color.
// Three custom properties instead of one: --node-color is the raw hex (used
// for the full-strength selected-state border/text), -dim/-strong are
// pre-converted rgba versions at two opacities (the default resting border,
// and a slightly-stronger one still short of fully opaque) — converted once
// here rather than asking CSS to do opacity math on a hex string it can't.
function channelColorVars(channel) {
  const hex = hexForLabel(channel.label);
  return ` --node-color:${hex}; --node-color-dim:${hexToRgba(hex, 0.35)}; --node-color-strong:${hexToRgba(hex, 0.85)};`;
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// One <line> per edge, drawn directly between two nodes' own pos — no
// angle/length computation anywhere, unlike the old ring's trig: the data
// *is* the drawing. data-edge carries the owning channel's id (plus the
// subchannel's, for a channel->subchannel edge) so applySelectionClasses
// can dim the right edges without re-deriving who connects to whom.
function edgeLine(from, to, key, extraClass) {
  return `<line class="menu-edge${extraClass ? ' ' + extraClass : ''}" data-edge="${escapeHtml(key)}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`;
}

function edgesHtml() {
  const homeEdges = CHANNELS.map((c) => edgeLine(HOME.pos, c.pos, c.id)).join('');
  const subEdges = CHANNELS.map((c) => c.subchannels.map((s) => edgeLine(c.pos, s.pos, `${c.id}:${s.id}`, 'menu-edge-sub')).join('')).join('');
  return `<svg class="menu-tree-edges" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">${homeEdges}${subEdges}</svg>`;
}

function nodesHtml() {
  const channelNodes = CHANNELS.map((c) => `
    <button type="button" class="menu-node menu-node-channel" data-channel="${escapeHtml(c.id)}" style="${nodeStyle(c.pos, channelColorVars(c))}" title="${escapeHtml(c.label)}">
      <span class="menu-node-icon" aria-hidden="true">${c.icon || ''}</span>
      <span class="menu-node-label mono">${escapeHtml(c.label)}</span>
    </button>
  `).join('');

  const subNodes = CHANNELS.map((c) => c.subchannels.map((s, k) => `
    <button type="button" class="menu-node menu-node-sub" data-subchannel="${escapeHtml(c.id)}:${escapeHtml(s.id)}" style="${nodeStyle(s.pos, channelColorVars(c))}" title="[${k + 1}] ${escapeHtml(s.label)}">
      <span class="menu-node-sub-label mono">${escapeHtml(s.label)}</span>
    </button>
  `).join('')).join('');

  return `
    <button type="button" class="menu-node menu-node-home" data-action="home" style="${nodeStyle(HOME.pos)}" title="[H] Home">
      <span class="menu-node-home-label mono">Home</span>
    </button>
    ${channelNodes}
    ${subNodes}
  `;
}

// Pushes the current selectedIndex/selectedSubIndex onto the already-built
// DOM by toggling classes/style properties on the existing elements, rather
// than tearing the whole tree down and rebuilding it. That matters because
// a transition only plays when an existing element's style changes across
// two frames, not when a brand-new element is inserted with its end-state
// already baked into the HTML — true for the zoom transform here the same
// way it was for the old ring's opacity reveal.
function applySelectionClasses() {
  if (!container) return;
  const viewport = container.querySelector('.menu-tree-viewport');
  const selectedChannel = selectedIndex !== -1 ? CHANNELS[selectedIndex] : null;
  const selectedSub = selectedChannel && selectedSubIndex !== -1 ? selectedChannel.subchannels[selectedSubIndex] : null;

  if (viewport) {
    if (selectedChannel) {
      // Drilling into a subchannel (selectedSub set) re-centers the zoom on
      // IT instead of its parent channel — same fixed ZOOM_SCALE, but
      // targeting a point further out reads as "zooming in further", which
      // is what makes moving channel -> subchannel feel like a second zoom
      // step rather than a flat one-level zoom.
      const focusPos = selectedSub ? selectedSub.pos : selectedChannel.pos;
      viewport.style.setProperty('--zoom-scale', ZOOM_SCALE);
      viewport.style.setProperty('transform-origin', `${focusPos.x / 10}% ${focusPos.y / 10}%`);
    } else {
      viewport.style.setProperty('--zoom-scale', '1');
      viewport.style.removeProperty('transform-origin');
    }
  }

  // Tier 1 (.is-selected) / tier 3 (.is-dimmed, "dim but visible") / tier 2
  // (neither class — full opacity, the resting look) — see styles.css for
  // what each actually renders as. Tier 3 only ever applies once something
  // IS selected; with nothing selected the whole tree sits at tier 2.
  container.querySelectorAll('[data-channel]').forEach((el) => {
    const idx = CHANNELS.findIndex((c) => c.id === el.dataset.channel);
    const isSelected = idx === selectedIndex;
    el.classList.toggle('is-selected', isSelected);
    el.classList.toggle('is-dimmed', selectedIndex !== -1 && !isSelected);
  });

  container.querySelectorAll('[data-subchannel]').forEach((el) => {
    const [channelId, subId] = el.dataset.subchannel.split(':');
    const idx = CHANNELS.findIndex((c) => c.id === channelId);
    const channel = idx !== -1 ? CHANNELS[idx] : null;
    const subIdx = channel ? channel.subchannels.findIndex((s) => s.id === subId) : -1;
    const parentSelected = idx === selectedIndex;
    el.classList.toggle('is-selected', parentSelected && subIdx === selectedSubIndex);
    el.classList.toggle('is-dimmed', selectedIndex !== -1 && !parentSelected);
  });

  // An edge's owning channel is always the first ':'-separated segment of
  // its data-edge, whether it's a home->channel edge ("academics") or a
  // channel->subchannel one ("academics:courses") — same dim rule as that
  // channel's own node either way.
  container.querySelectorAll('[data-edge]').forEach((el) => {
    const channelId = el.dataset.edge.split(':')[0];
    const idx = CHANNELS.findIndex((c) => c.id === channelId);
    el.classList.toggle('is-dimmed', selectedIndex !== -1 && idx !== selectedIndex);
  });
}

// Builds the tree once (selectedIndex/selectedSubIndex are always -1 at
// this point, nothing to apply yet) and wires up every listener — selection
// changes afterward go through applySelectionClasses() instead, not back
// through here. See that function's comment for why.
function build() {
  if (!container) return;
  container.innerHTML = `
    <div class="menu-stage">
      <div class="menu-tree-stage">
        <div class="menu-tree-viewport">
          ${edgesHtml()}
          <div class="menu-tree-nodes">
            ${nodesHtml()}
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-action="home"]')?.addEventListener('click', goHome);

  // A click/tap on a channel that isn't already selected just selects/zooms
  // it (same as Left/Right landing on it) — one already selected AND
  // carrying its own route (Records/Public/Contacts) navigates instead.
  // This single rule reproduces the old separate click+dblclick pair
  // naturally (first click selects, a real second click sees "already
  // selected" and navigates) while also giving touch the same two-tap
  // pattern with no dblclick timing to get wrong on a touchscreen.
  container.querySelectorAll('[data-channel]').forEach((el) => {
    const idx = CHANNELS.findIndex((c) => c.id === el.dataset.channel);
    if (idx === -1) return;
    const channel = CHANNELS[idx];
    el.addEventListener('click', () => {
      if (idx === selectedIndex && channel.route) {
        goToChannel(channel);
        return;
      }
      selectedIndex = idx;
      selectedSubIndex = -1;
      applySelectionClasses();
    });
  });

  // A subchannel pill always navigates immediately on click/tap, dimmed or
  // not — dimmed (off-focus) nodes stay fully clickable throughout this
  // page, same as channel nodes above.
  container.querySelectorAll('[data-subchannel]').forEach((el) => {
    const [channelId, subId] = el.dataset.subchannel.split(':');
    const channel = CHANNELS.find((c) => c.id === channelId);
    const sub = channel?.subchannels.find((s) => s.id === subId);
    if (sub) el.addEventListener('click', () => goToSubchannel(sub));
  });

  // Tapping/clicking anywhere on the stage that ISN'T a node is touch's
  // equivalent of Escape — the stage has no other purpose for a click, and
  // this is the only way a touch user (no keyboard) can zoom back out.
  container.querySelector('.menu-stage')?.addEventListener('click', (e) => {
    if (e.target.closest('.menu-node')) return;
    clearSelection();
  });
}
