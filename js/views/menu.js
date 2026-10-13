import { HOME, CHANNELS } from '../channels.js?v=59';
import { escapeHtml } from '../format.js?v=59';

let container = null;
// -1 = nothing selected yet (fresh page visit) — the first Left/Right press
// lands on Records (index 0) rather than moving relative to a starting
// point, see moveSelection.
let selectedIndex = -1;
// Index into the currently selected channel's subchannels, or -1 — set by a
// number key (see selectByNumber), cleared whenever the channel selection
// itself changes. Only ever meaningful alongside a non—-1 selectedIndex.
// Selecting a subchannel this way doesn't navigate by itself; Enter commits
// it (see confirmSelection) — same two-step select-then-confirm as the top
// nav's ArrowUp/Down + Enter.
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
  rebuild();
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
  rebuild();
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
  rebuild();
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

// Keep in sync with --circle-r/--sub-pill-width in css/styles.css — needed
// here too so subchannelLine below can work out the line's actual
// angle/length in real pixels.
const CIRCLE_R = 50;
const SUB_PILL_WIDTH = 130;
// Diagonal channels' lines run noticeably shorter (~25%) than cardinal
// ones' — a stylistic distinction between the two, not a byproduct of
// anything geometric, so it's just two separate constants.
const SUB_LINE_LEN_CARDINAL = 110;
const SUB_LINE_LEN_DIAGONAL = Math.round(SUB_LINE_LEN_CARDINAL * 0.75);

function subDist(parentAngle) {
  const lineLen = isCardinal(parentAngle) ? SUB_LINE_LEN_CARDINAL : SUB_LINE_LEN_DIAGONAL;
  return CIRCLE_R + lineLen + SUB_PILL_WIDTH / 2;
}

// Math.sin/cos of a "round" angle like 270° isn't always exactly -1/0 —
// floating-point noise on the order of 1e-16 creeps in. Harmless most
// places in this file, but it's fatal for the sign check below (whether the
// pill ended up left or right of the circle), so near-zero values are
// snapped back to a clean 0 first.
function snapZero(v) {
  return Math.abs(v) < 1e-9 ? 0 : v;
}

// The pill never rotates to face its own line — instead the line's angle
// and length are worked out so it runs straight from the circle's edge to
// whichever end of the pill faces the circle: the midpoint of that end's
// 180° rounded cap (its leftmost or rightmost point), not wherever the fan
// angle's own ray happens to cross the pill's outline. fanAngleDeg is still
// what actually positions the pill (via .menu-subchannel's --sub-angle, a
// constant --sub-dist out along it) — this only derives the line that
// connects to it. dist is that same --sub-dist (see subDist), passed in
// rather than read from a shared constant since it differs between
// cardinal and diagonal channels.
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
// no-net-rotation trick as .menu-channel-wrap) at its own fan angle, a
// constant distance out. Its connecting line is computed separately (see
// subchannelLine) since it generally points in a different direction than
// that fan angle does.
function subchannelsHtml(channel, i) {
  const parentAngle = channelAngle(i);
  const n = channel.subchannels.length;
  const angles = subchannelAngles(parentAngle, n);
  const dist = subDist(parentAngle);
  return channel.subchannels.map((s, k) => {
    const angle = angles[k];
    const isSelected = i === selectedIndex && k === selectedSubIndex;
    const line = subchannelLine(angle, dist);
    return `
      <div class="menu-sub-line" style="--sub-line-angle:${line.angleDeg.toFixed(2)}deg; --sub-line-dist:${line.length.toFixed(2)}px;"></div>
      <div class="menu-subchannel" style="--sub-angle:${angle}deg; --sub-dist:${dist}px;">
        <div class="menu-sub-pill${isSelected ? ' is-selected' : ''}" data-subchannel="${escapeHtml(channel.id)}:${escapeHtml(s.id)}" title="[${k + 1}] ${escapeHtml(s.label)}">
          <span class="menu-sub-pill-label mono">${escapeHtml(s.label)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function circlesHtml() {
  return CHANNELS.map((c, i) => `
    <div class="menu-channel-wrap${i === selectedIndex ? ' is-selected' : ''}" style="--angle:${channelAngle(i)}deg;">
      <div class="menu-channel-circle" data-channel="${escapeHtml(c.id)}">
        <span class="menu-channel-label mono">${escapeHtml(c.label)}</span>
      </div>
      ${subchannelsHtml(c, i)}
    </div>
  `).join('');
}

function rebuild() {
  if (!container) return;
  container.innerHTML = `
    <div class="menu-stage">
      <div class="menu-constellation">
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
      rebuild();
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
}
