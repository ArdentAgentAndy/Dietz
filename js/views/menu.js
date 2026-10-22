import { HOME, CHANNELS } from '../channels.js?v=63';
import { escapeHtml } from '../format.js?v=63';

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
  const app = container?.closest('#app');
  app?.classList.remove('app-no-scroll');
  app?.style.removeProperty('--topnav-h');
  document.body.classList.remove('menu-no-scroll');
  window.removeEventListener('keydown', onKeyDown);
  selectedIndex = -1;
  selectedSubIndex = -1;
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
// further in that direction, wrapping around the ring. Changing which
// channel is highlighted always drops any subchannel selection within the
// previous one — it wouldn't mean anything pointed at a different channel.
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
// same top-to-bottom order the number keys and the pills' own layout use
// (see subchannelsHtml's comment on why data order already matches visual
// order), wrapping around same as Left/Right does for channels. A no-op
// with no channel selected, or one with no subchannels at all.
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

// Scoped to this page only (added/removed in render()/unmount()) rather
// than wired up globally in nav.js. nav.js's own ArrowLeft/ArrowRight
// handling (channel cycling in the top row) is itself a no-op while Menu is
// open — see onMenuPage() there — so there's no conflict between the two
// listeners both reacting to the same keypress.
function onKeyDown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
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

// CHANNELS[0] sits at the top (0deg), then one per 45deg clockwise — see
// the ordering note in js/channels.js. Each channel's line/circle share the
// same --angle custom property, which drives both the radial position (see
// styles.css for the rotate/translateY breakdown). Circles have no edges to
// "fold" the way a square would — that's saved for subchannels later —
// so the wrap just needs to counter-rotate back to keep the label upright.
// +180: the rotate/translateY math in CSS naturally points "down" at 0deg
// (an unrotated, untranslated box extends downward, per normal layout), so
// this offset is what makes index 0 land at the top instead of the bottom.
function channelAngle(i) {
  return (i * 45 + 180) % 360;
}

function linesHtml() {
  return CHANNELS.map((c, i) => `<div class="menu-line" style="--angle:${channelAngle(i)}deg;"></div>`).join('');
}

// A channel sitting at a multiple of 90° (Records/Schedule/Public/Practice —
// straight up/right/down/left) gets the wider 5-slot spread; the 4 diagonals
// in between get the narrower 3-slot one.
const CARDINAL_OFFSETS = [0, 20, -20, 40, -40];
const DIAGONAL_OFFSETS = [0, 20, -20];

function isCardinal(angle) {
  return angle % 90 === 0;
}

// Picks the first n offsets from this channel's slot list (so n=2 on a
// cardinal channel uses [0,30], not a symmetric [-15,15] pair — the offsets
// themselves are a fixed, deliberately-ordered set, not something to
// re-spread per count), then reorders *those* by where they actually land
// on screen, top to bottom. That reorder matters because +/-30 isn't
// consistently "below/above" — it flips with which way the channel points
// (e.g. +30 lands below the line on a rightward channel like Schedule, but
// above it on a leftward one like Practice), so sorting by each offset's
// real resulting angle (not the raw signed number) is what keeps this
// reading top-to-bottom on every channel. The channel's own subchannels
// list (channels.js order — same order the number keys use) is then laid
// into these top-to-bottom slots in that order, so the first subchannel is
// always the topmost pill, regardless of which offset value it ends up at.
function subchannelAngles(parentAngle, n) {
  const offsets = isCardinal(parentAngle) ? CARDINAL_OFFSETS : DIAGONAL_OFFSETS;
  return offsets
    .slice(0, n)
    .map((offset) => parentAngle + offset)
    .map((angle) => ({ angle, y: Math.cos((angle * Math.PI) / 180) }))
    .sort((a, b) => a.y - b.y)
    .map((o) => o.angle);
}

// Vertical pixel spacing between adjacent pills in a diagonal fan — see
// diagonalPillAngle below for why this is picked directly rather than
// derived from equal angle steps.
const DIAGONAL_SUB_Y_STEP = 56;

// The 3 standard diagonal slot heights (top/middle/bottom), in
// DIAGONAL_SUB_Y_STEP units — what a channel.subchannelSlots entry (see
// channels.js) indexes into. Shared across every diagonal channel so two
// different channels (e.g. Records and Academics, mirror images of each
// other — see channels.js) can be pinned to the exact same heights.
const CANONICAL_SLOT_OFFSETS = [-1, 0, 1];

// Equal angle steps between pills (subchannelAngles) put them at equal
// arc/chord distance along the circle they sit on — true "equidistant
// along the circumference" — but that is NOT the same as equal vertical
// pixel spacing once projected onto the page: Y = dist*cos(angle), and
// cos isn't linear in angle, so equal angle steps land unevenly once
// flattened onto one axis (more so the larger dist gets, which is exactly
// what made this visible after lengthening the diagonal lines). Since what
// actually reads as "evenly spaced" to the eye is the vertical gap between
// stacked pills, this instead works backwards from an evenly-spaced target
// Y to the angle that produces it — a plain arccos inversion. cos's
// principal value only covers [0,180], so of its two angle solutions
// (principal and 360-principal) this picks whichever lands closer to the
// pill's own nominal fan angle, rather than hand-deriving which half of
// the circle each of the four diagonal channels' offsets falls in.
function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function diagonalPillAngle(dist, nominalAngleDeg, targetY) {
  const ratio = Math.max(-1, Math.min(1, targetY / dist));
  const principal = (Math.acos(ratio) * 180) / Math.PI;
  const reflected = 360 - principal;
  return angleDiff(principal, nominalAngleDeg) <= angleDiff(reflected, nominalAngleDeg) ? principal : reflected;
}

// Keep in sync with --circle-r/--sub-pill-width/--sub-pill-height in
// css/styles.css — needed here too so subchannelLine below can work out the
// line's actual angle/length in real pixels.
const CIRCLE_R = 50;
const SUB_PILL_WIDTH = 130;
const SUB_PILL_HEIGHT = 34;
// Diagonal channels get their own reach, tuned independently of the
// cardinal one: a 3-subchannel diagonal fan (e.g. Academics) packs its
// pills at only +/-20deg apart (DIAGONAL_OFFSETS), so at too short a
// distance adjacent pills physically overlap — the *1.7 here is what
// pushes them far enough apart to clear that, not a stylistic choice.
const SUB_LINE_LEN_CARDINAL = 110;
const SUB_LINE_LEN_DIAGONAL = Math.round(SUB_LINE_LEN_CARDINAL * 0.75 * 1.7);

// Cardinal channels only — diagonal ones use diagonalDist below instead.
function subDist() {
  return CIRCLE_R + SUB_LINE_LEN_CARDINAL + SUB_PILL_WIDTH / 2;
}

// Diagonal channels only. Every subchannel of one diagonal channel shares
// this exact radius — none of them vary it — which is what makes them
// equidistant along a shared circumference (see diagonalSubGeometry for how
// each pill's angle is then solved around that fixed radius).
function diagonalDist() {
  return CIRCLE_R + SUB_LINE_LEN_DIAGONAL + SUB_PILL_WIDTH / 2;
}

// Math.sin/cos of a "round" angle like 270° isn't always exactly -1/0 —
// floating-point noise on the order of 1e-16 creeps in. Harmless most
// places in this file, but it's fatal for the sign check below (whether the
// pill ended up left or right of the circle), so near-zero values are
// snapped back to a clean 0 first.
function snapZero(v) {
  return Math.abs(v) < 1e-9 ? 0 : v;
}

// Cardinal channels only (see subchannelsHtml) — the pill never rotates to
// face its own line, so here the line's angle and length are worked out so
// it runs straight from the circle's edge to whichever end of the pill
// faces the circle: the midpoint of that end's 180° rounded cap (its
// leftmost or rightmost point), not wherever the fan angle's own ray
// happens to cross the pill's outline. fanAngleDeg is still what actually
// positions the pill (via .menu-subchannel's --sub-angle, a constant
// --sub-dist out along it) — this only derives the line that connects to
// it. dist is that same --sub-dist (see subDist), passed in rather than
// read from a shared constant since it differs between cardinal and
// diagonal channels.
function subchannelLine(fanAngleDeg, dist) {
  const rad = (fanAngleDeg * Math.PI) / 180;
  const pillX = snapZero(-Math.sin(rad)) * dist;
  const pillY = snapZero(Math.cos(rad)) * dist;
  const halfWidth = SUB_PILL_WIDTH / 2;
  // Pill right of (or dead above/below) the circle -> connect its left tip,
  // the side actually facing back toward the circle, and vice versa.
  const tipX = pillX + (pillX >= 0 ? -halfWidth : halfWidth);
  const tipY = pillY;
  const length = Math.hypot(tipX, tipY) - CIRCLE_R;
  // Inverse of the rotate()+translateY() convention used everywhere else in
  // this file (a vector (vx,vy) = (-sin(a), cos(a)) * len) — solved for a.
  const angleDeg = (Math.atan2(-tipX, tipY) * 180) / Math.PI;
  return { angleDeg, length };
}

// Every pill is the same fixed size and always horizontal — no per-angle
// rotation, just positioned (rotate/translateY/counter-rotate, same
// no-net-rotation trick as .menu-channel-wrap) at its own angle, a constant
// distance out. Cardinal channels use their exact nominal fan angle
// (subDist/subchannelLine bend the LINE to still connect). Diagonal
// channels share one fixed DISTANCE (diagonalDist) but, for a
// multi-subchannel fan, re-pick each pill's ANGLE (diagonalPillAngle) so
// they land evenly spaced top-to-bottom on screen rather than at the
// nominal equal-angle-step positions — see diagonalPillAngle for why equal
// angle steps alone don't look even once projected onto the page. The LINE
// still bends (subchannelLine, same function as cardinal) to connect
// exactly to whichever angle the pill actually ends up at.
function subchannelsHtml(channel, i) {
  const parentAngle = channelAngle(i);
  const n = channel.subchannels.length;
  const nominalAngles = subchannelAngles(parentAngle, n);
  const cardinal = isCardinal(parentAngle);
  const dist = cardinal ? subDist() : diagonalDist();
  const parentY = dist * Math.cos((parentAngle * Math.PI) / 180);
  const mid = (n - 1) / 2;
  // channel.subchannelSlots (channels.js), when present, pins each
  // subchannel to one of the 3 canonical slot heights (CANONICAL_SLOT_OFFSETS,
  // shared across every diagonal channel) by index, instead of the default
  // top-to-bottom-by-array-order spacing relative to this channel's own
  // center. That's what lets two different channels — different subchannel
  // counts, different "mid" — land on the exact same heights (Records
  // matching Academics' top two) rather than just each being internally
  // symmetric. The branch-selection hint diagonalPillAngle needs (to pick
  // the correct one of its two arccos solutions) just falls back to this
  // channel's own parentAngle in that case — always within DIAGONAL_OFFSETS'
  // +/-20deg of any of its real slots, so it's unambiguous, and unlike
  // indexing into nominalAngles by slot number it can't go out of bounds
  // when a channel's subchannelSlots references a slot index >= its own
  // subchannel count (exactly what Records' [0, 1] does, referencing
  // Academics' 3-slot table from a 2-subchannel channel).
  const angles = cardinal
    ? nominalAngles
    : channel.subchannels.map((_, k) => {
        if (!channel.subchannelSlots) return diagonalPillAngle(dist, nominalAngles[k], parentY + (k - mid) * DIAGONAL_SUB_Y_STEP);
        const offsetMultiplier = CANONICAL_SLOT_OFFSETS[channel.subchannelSlots[k]];
        return diagonalPillAngle(dist, parentAngle, parentY + offsetMultiplier * DIAGONAL_SUB_Y_STEP);
      });
  return channel.subchannels.map((s, k) => {
    const angle = angles[k];
    const line = subchannelLine(angle, dist);
    return `
      <div class="menu-sub-line" style="--sub-line-angle:${line.angleDeg.toFixed(2)}deg; --sub-line-dist:${line.length.toFixed(2)}px;"></div>
      <div class="menu-subchannel" style="--sub-angle:${angle}deg; --sub-dist:${dist}px;">
        <div class="menu-sub-pill" data-subchannel="${escapeHtml(channel.id)}:${escapeHtml(s.id)}" title="[${k + 1}] ${escapeHtml(s.label)}">
          <span class="menu-sub-pill-label mono">${escapeHtml(s.label)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function circlesHtml() {
  return CHANNELS.map((c, i) => `
    <div class="menu-channel-wrap" style="--angle:${channelAngle(i)}deg;">
      <div class="menu-channel-circle" data-channel="${escapeHtml(c.id)}">
        <span class="menu-channel-icon" aria-hidden="true">${c.icon || ''}</span>
        <span class="menu-channel-label mono">${escapeHtml(c.label)}</span>
      </div>
      ${subchannelsHtml(c, i)}
    </div>
  `).join('');
}

// One big 45deg hover wedge per channel (see .menu-sector in styles.css for
// the actual shape/geometry) — [data-sector] is matched up with the same
// index's .menu-channel-wrap in build() below to toggle .is-sector-hover.
function sectorsHtml() {
  return CHANNELS.map((c, i) => `<div class="menu-sector" data-sector="${escapeHtml(c.id)}" style="--angle:${channelAngle(i)}deg;"></div>`).join('');
}

// Pushes the current selectedIndex/selectedSubIndex onto the already-built
// DOM by toggling classes on the existing elements, rather than tearing the
// whole constellation down and rebuilding it (what this used to do, back
// when it was part of a single rebuild() called on every selection change).
// That mattered once the subchannel reveal became a CSS opacity transition
// (see .menu-sub-line/.menu-subchannel in styles.css): a transition only
// plays when an existing element's style changes across two frames, not
// when a brand-new element is inserted with its end-state already baked
// into the HTML — which is exactly what innerHTML-replacing on every
// keypress/click would do, uselessly flash-cutting straight to the end
// state instead of fading.
function applySelectionClasses() {
  if (!container) return;
  const wraps = container.querySelectorAll('.menu-channel-wrap');
  wraps.forEach((wrap, idx) => {
    wrap.classList.toggle('is-selected', idx === selectedIndex);
  });
  container.querySelectorAll('.menu-sub-pill').forEach((pill) => {
    const [channelId, subId] = pill.dataset.subchannel.split(':');
    const idx = CHANNELS.findIndex((c) => c.id === channelId);
    const channel = idx !== -1 ? CHANNELS[idx] : null;
    const subIdx = channel ? channel.subchannels.findIndex((s) => s.id === subId) : -1;
    pill.classList.toggle('is-selected', idx === selectedIndex && subIdx === selectedSubIndex);
  });
}

// Builds the constellation once (selectedIndex/selectedSubIndex are always
// -1 at this point, nothing to re-render for) and wires up every listener —
// selection changes afterward go through applySelectionClasses() instead,
// not back through here. See that function's comment for why.
function build() {
  if (!container) return;
  container.innerHTML = `
    <div class="menu-stage">
      <div class="menu-constellation">
        ${sectorsHtml()}
        ${linesHtml()}
        <button type="button" class="menu-octagon" data-action="home" title="[H] Home">
          <span class="menu-octagon-inner">
            <span class="menu-octagon-label mono">Home</span>
          </span>
        </button>
        ${circlesHtml()}
      </div>
    </div>
  `;
  container.querySelector('[data-action="home"]')?.addEventListener('click', goHome);
  // A single click only selects a channel — exactly what Left/Right
  // landing on it does, never an immediate navigate, even for a channel
  // that carries its own route (Records/Public) — those need Enter
  // afterward too, same as every other channel. A double-click on one of
  // those route-carrying channels is a shortcut straight past that: select
  // then immediately confirm, same as a quick select-then-Enter.
  container.querySelectorAll('[data-channel]').forEach((el) => {
    const idx = CHANNELS.findIndex((c) => c.id === el.dataset.channel);
    if (idx === -1) return;
    const channel = CHANNELS[idx];
    el.addEventListener('click', () => {
      selectedIndex = idx;
      selectedSubIndex = -1;
      applySelectionClasses();
    });
    if (channel.route) {
      el.addEventListener('dblclick', () => goToChannel(channel));
    }
  });
  container.querySelectorAll('[data-subchannel]').forEach((el) => {
    const [channelId, subId] = el.dataset.subchannel.split(':');
    const channel = CHANNELS.find((c) => c.id === channelId);
    const sub = channel?.subchannels.find((s) => s.id === subId);
    if (sub) el.addEventListener('click', () => goToSubchannel(sub));
  });
  // Hovering a channel's outer sector shows its subchannels the same way
  // hovering the circle itself does (see .is-sector-hover in styles.css) —
  // purely a visual hover state, deliberately not touching selectedIndex,
  // same as :hover on the circle doesn't either.
  const wraps = container.querySelectorAll('.menu-channel-wrap');
  container.querySelectorAll('[data-sector]').forEach((el) => {
    const idx = CHANNELS.findIndex((c) => c.id === el.dataset.sector);
    const wrap = idx !== -1 ? wraps[idx] : null;
    if (!wrap) return;
    el.addEventListener('mouseenter', () => wrap.classList.add('is-sector-hover'));
    el.addEventListener('mouseleave', () => wrap.classList.remove('is-sector-hover'));
  });
}
