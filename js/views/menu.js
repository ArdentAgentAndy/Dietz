import { HOME, CHANNELS, INNER_LAYER_CHANNELS } from '../channels.js?v=72';
import { escapeHtml } from '../format.js?v=72';
import { hexForLabel, hexForNotionColor } from '../notionColors.js?v=72';
import { BLOB_PRESET_COUNT, letterHtml, pebbleColorVars } from '../pebbles.js?v=72';
import { takePendingMenuLayer } from '../nav.js?v=72';

// Solo channels (Contacts, Public) have no outer-ring slot of their own in
// this rebuild yet — only the 8 non-solo channels (channels.js's `solo`
// flag) get placed on the outer ring, one per spoke.
const REGULAR = CHANNELS.filter((c) => !c.solo);

let container = null;
// The channel currently zoomed into (its id), or null for the hub view —
// see build(), which dispatches to buildHub()/buildZoomed() off this.
let zoomedChannelId = null;
// Which of the zoomed channel's 4 subchannel slots (zoomedSubNodesHtml) is
// focused via ArrowLeft/ArrowRight — -1 means none yet. Reset to -1 everywhere
// zoomedChannelId itself changes (zooming in/out, switching channels) so a
// freshly-opened channel never starts with some other channel's leftover
// focus.
let zoomedSubIndex = -1;

// How many 45° steps the outer ring (spokes/arcs/ring *and* the channel
// blobs together — see .menu-spoke-ring/.menu-channel-ring) is rotated by.
// Starts at 4 (4*45=180°) so Records (REGULAR's last index) lands at the
// bottom-right (SE) spoke instead of its unrotated top-left (NW) one; NW
// and SE are antipodal on the octagon, so a half-turn is the only rotation
// that lands it exactly there. Q/E (see onKeyDown) adjust
// this; reset to the same starting point on every fresh page visit, same
// as zoomedChannelId. Deliberately never wrapped mod 8 — see onKeyDown's
// own comment for why that matters for the animation.
let rotationSteps = 4;

// Which layer of the menu is showing (v66) — MAIN_LAYER is the hub/channel
// menu itself; O steps one layer further out, I one layer further in, within
// LAYER_NAMES' own bounds. Every other layer is a placeholder for now (see
// buildLayerPlaceholder). Reset on every fresh page visit, same as
// zoomedChannelId — but deliberately not on a layer change, so coming back to
// the hub finds the ring exactly where it was left (rotationSteps untouched).
const MAIN_LAYER = 0;
const INNER_LAYER = -1;
const LAYER_NAMES = { '-1': 'Inner', 1: 'Outer' };
let currentLayer = MAIN_LAYER;
// The Inner layer's own ring rotation, in INNER_RADIAL_COUNT steps — separate
// from the hub's rotationSteps, and likewise never wrapped (see onKeyDown).
let innerRotationSteps = 0;
// The in-flight zoomTransition step's timer, or null when none is running —
// doubles as the "ignore input until the new page has landed" flag.
let zoomTimer = null;

// Degrees per spoke step, and the current rotation in degrees — both used
// by the rotating groups' transform and by each blob's counter-rotation.
function rotationDeg() {
  return rotationSteps * (360 / SPOKE_COUNT);
}

function innerRotationDeg() {
  return innerRotationSteps * (360 / INNER_RADIAL_COUNT);
}

function channelById(id) {
  return REGULAR.find((c) => c.id === id) || null;
}

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
  // [M] from an Inner-layer channel's page (see nav.js) comes back to the
  // Inner layer rather than the hub.
  if (takePendingMenuLayer() === 'inner') currentLayer = INNER_LAYER;
  build();
}

export function unmount() {
  zoomedChannelId = null;
  zoomedSubIndex = -1;
  rotationSteps = 4;
  currentLayer = MAIN_LAYER;
  innerRotationSteps = 0;
  clearTimeout(zoomTimer);
  zoomTimer = null;
  const app = container?.closest('#app');
  app?.classList.remove('app-no-scroll');
  app?.style.removeProperty('--topnav-h');
  document.body.classList.remove('menu-no-scroll');
  window.removeEventListener('keydown', onKeyDown);
  container = null;
}

// Q rotates the ring anticlockwise, E clockwise — only on the hub page
// (rotating mid-zoom wouldn't mean anything, there's no ring showing).
// Increasing rotationSteps shifts every blob's angle further in this
// file's own clockwise-increasing convention (see spokeAngles' own
// comment), so E (clockwise) increments and Q (anticlockwise) decrements —
// same "the one that spins something" role Q/E share with
// switchZoomedChannel below, which is why both ended up on this pair
// rather than the arrow keys (freed up for ArrowLeft/ArrowRight to walk
// subchannels instead, matching the top nav's own ArrowLeft/ArrowRight —
// see nav.js).
//
// Deliberately NOT wrapped into 0-7: applyRotation() just writes the new
// rotate(Ndeg) and lets the CSS transition animate from whatever the
// previous value was. If this wrapped around (e.g. 315° straight to 0°),
// the browser would animate the long way around instead of the one 45°
// step that actually happened — letting it grow unboundedly means each
// change is always exactly ±45° from the last, so the transition is always
// the short, correct way, in both directions, indefinitely.
function onKeyDown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Jumps straight to the real Home page (HOME.route, '/home') — same
  // click goHome() the hub's own central octagon triggers — regardless of
  // hub/zoomed state, unlike Escape/M below which only ever zooms back out
  // to the hub. No letter-keybind collision: no channel or subchannel
  // label starts with H (see channelByLetter/subchannelByLetter).
  if (e.key === 'h' || e.key === 'H') {
    e.preventDefault();
    goHome();
    return;
  }
  if (zoomTimer) return;
  // A placeholder layer has little of its own to act on — only I/O (step
  // between layers), Escape/M (straight back to the hub, same "zoom back out
  // to the hub" role they play on a zoomed channel below), and on the Inner
  // layer Q/E (turn its ring, same as the hub's below), Enter (open whichever
  // pebble sits in the bottom-right slot) and a pebble's first letter — both
  // only for pebbles with a route (see INNER_LAYER_CHANNELS).
  if (currentLayer !== MAIN_LAYER) {
    if (currentLayer === INNER_LAYER && (e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      innerRotationSteps += e.key.toLowerCase() === 'e' ? 1 : -1;
      applyRotation(innerRotationDeg());
    } else if (currentLayer === INNER_LAYER && e.key === 'Enter') {
      e.preventDefault();
      openInnerPebble(innerPebbleInBottomRightSlot());
    } else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      goToLayer(currentLayer - 1);
    } else if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      goToLayer(currentLayer + 1);
    } else if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      goToLayer(MAIN_LAYER);
    } else if (currentLayer === INNER_LAYER && /^[a-zA-Z]$/.test(e.key)) {
      const channel = INNER_LAYER_CHANNELS.find((c) => c?.route && c.label[0].toUpperCase() === e.key.toUpperCase());
      if (channel) {
        e.preventDefault();
        openInnerPebble(channel);
      }
    }
    return;
  }
  // 'M'/'m' also already jumps here globally from anywhere else in the app
  // (nav.js) — that still fires alongside this (separate window listener,
  // same keypress), but a hash-only jump to this same route is a no-op
  // while already here, so this is what actually does the zooming back out.
  if ((e.key === 'Escape' || e.key === 'm' || e.key === 'M') && zoomedChannelId) {
    e.preventDefault();
    const channel = channelById(zoomedChannelId);
    if (channel) goBackToHub(channel);
    return;
  }
  // Q/E switch channels — same prev/next switchZoomedChannel the top-left/
  // bottom-right beam markers already trigger on click, and the same
  // "spins the whole assembly around" role Q/E play on the hub below
  // (rotationSteps), just here it's the orbit rotation (see
  // SWITCH_ARC_STEP_DEG) instead of the ring's. ArrowLeft/ArrowRight
  // instead walk the 4 subchannel slots (moveSubSelection) — left toward
  // index 0 (the top slot, see ZOOM_SUB_ANGLES_FROM_HORIZONTAL_DEG), right
  // toward index 3 (bottom) — matching the top nav's own ArrowLeft/
  // ArrowRight subchannel-walking once a page actually commits to one (see
  // nav.js's moveSub). A letter key jumps straight to whichever subchannel
  // shows that letter as its own watermark (channelLetterHtml/letterHtml)
  // — only reachable here, once already zoomed into the channel that
  // subchannel belongs to, same as the hub's own letter keybind below only
  // matching channels.
  if (zoomedChannelId) {
    if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      switchZoomedChannel(-1);
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      switchZoomedChannel(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveSubSelection(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveSubSelection(1);
    } else if (/^[a-zA-Z]$/.test(e.key)) {
      const channel = channelById(zoomedChannelId);
      const sub = channel && subchannelByLetter(channel, e.key);
      if (sub?.route) {
        e.preventDefault();
        location.hash = '#' + sub.route;
      }
    }
    return;
  }
  if (e.key === 'q' || e.key === 'Q') {
    e.preventDefault();
    rotationSteps -= 1;
    applyRotation();
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    rotationSteps += 1;
    applyRotation();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    enterBottomRightSlot();
  } else if (e.key === 'i' || e.key === 'I') {
    e.preventDefault();
    goToLayer(currentLayer - 1);
  } else if (e.key === 'o' || e.key === 'O') {
    e.preventDefault();
    goToLayer(currentLayer + 1);
  } else if (/^[a-zA-Z]$/.test(e.key)) {
    // Same channelLetterHtml/letterHtml watermark, as a direct shortcut —
    // jumps straight into that channel (same enterChannel zoom-in a click
    // on its blob would trigger) without rotating to it first.
    const channel = channelByLetter(e.key);
    if (channel) {
      e.preventDefault();
      enterChannel(channel);
    }
  }
}

function channelByLetter(letter) {
  return REGULAR.find((c) => /^[A-Za-z]/.test(c.label) && c.label[0].toUpperCase() === letter.toUpperCase()) || null;
}

function subchannelByLetter(channel, letter) {
  return (channel.subchannels || []).find((s) => /^[A-Za-z]/.test(s.label) && s.label[0].toUpperCase() === letter.toUpperCase()) || null;
}

// Which REGULAR channel the rotation has currently brought to the fixed
// bottom-right (SE) slot — solving spokeAngles()[i] + rotationDeg() ≡ 45°
// (SE's own base angle, index 3's) for i. REGULAR[3] sits there
// unrotated, so rotationSteps steps of 45° back from there lands on
// whichever index is actually showing up at that fixed on-screen spot now.
function channelInBottomRightSlot() {
  const i = (((3 - rotationSteps) % SPOKE_COUNT) + SPOKE_COUNT) % SPOKE_COUNT;
  return REGULAR[i];
}

// Zooms into `channel` with the same zoom-in animation as going to a deeper
// layer (see zoomTransition), pivoting on the channel's own blob — the
// selector matches its pebble on the hub and its enlarged blob on the page it
// arrives at. Shared by a click on its hub blob (buildHub), Enter
// (enterBottomRightSlot, found by the ring's current rotation) and a letter
// keybind (onKeyDown, found by that channel's own watermark letter).
function enterChannel(channel) {
  zoomTransition(
    false,
    () => { zoomedChannelId = channel.id; zoomedSubIndex = -1; },
    `.menu-node-channel[data-channel="${channel.id}"]`,
  );
}

// Enter commits whatever's currently in the bottom-right slot.
function enterBottomRightSlot() {
  enterChannel(channelInBottomRightSlot());
}

// Updates the rotation in place — no DOM rebuild, so the CSS transitions on
// .menu-spoke-ring/.menu-channel-ring/.menu-node-content actually get to
// play instead of snapping straight to the new angle.
function applyRotation(ringDeg = rotationDeg()) {
  if (!container) return;
  const deg = `${ringDeg}deg`;
  const counterDeg = `${-ringDeg}deg`;
  const spokeRing = container.querySelector('.menu-spoke-ring');
  if (spokeRing) spokeRing.style.transform = `rotate(${deg})`;
  const channelRing = container.querySelector('.menu-channel-ring');
  if (channelRing) channelRing.style.transform = `rotate(${deg})`;
  container.querySelectorAll('.menu-node-content').forEach((el) => {
    el.style.setProperty('--counter-rotate', counterDeg);
  });
}

function goHome() {
  location.hash = '#' + HOME.route;
}

// Moves zoomedSubIndex by `delta` across the 4 subchannel slots, wrapping
// around — same shape as the old pre-v65 moveSubSelection (first press
// with nothing focused lands on the first slot in that direction, delta>0
// landing on index 0 since subchannels now run top-to-bottom in array
// order — see ZOOM_SUB_ANGLES_FROM_HORIZONTAL_DEG's own comment — rather
// than wrapping relative to a starting point).
function moveSubSelection(delta) {
  const n = ZOOM_SUB_ANGLES_FROM_HORIZONTAL_DEG.length;
  zoomedSubIndex = zoomedSubIndex === -1
    ? (delta > 0 ? 0 : n - 1)
    : ((zoomedSubIndex + delta) % n + n) % n;
  applySubSelection();
}

// Pushes the current zoomedSubIndex onto the already-built DOM by toggling
// is-selected per data-sub-index button — same in-place-restyle-not-
// rebuild reasoning applyRotation uses, so is-selected's own existing
// transform/border-color transition (styles.css) gets to animate.
function applySubSelection() {
  if (!container) return;
  container.querySelectorAll('[data-sub-index]').forEach((el) => {
    el.classList.toggle('is-selected', Number(el.dataset.subIndex) === zoomedSubIndex);
  });
}

// Inline left%/top% straight from a node's own pos (channels.js) — pos.x/10
// is pos.x's position on the 0-1000 logical square expressed as a percent
// of the stage.
function nodeStyle(pos) {
  return `left:${pos.x / 10}%; top:${pos.y / 10}%;`;
}

// A channel's own color — channels.js's `color` field (a fixed Notion color
// name, same convention Courses' own color override uses) wins when set
// (e.g. Application's purple); otherwise falls back to hexForLabel's
// deterministic hash, so every other channel still gets a stable color with
// no field needed.
function channelHex(channel) {
  if (channel.hex) return channel.hex;
  return channel.color ? hexForNotionColor(channel.color) : hexForLabel(channel.label);
}

// The blob's border color vars (js/pebbles.js) for a channel's own hex.
function channelColorVars(channel) {
  return pebbleColorVars(channelHex(channel), channel.fullStrength);
}

// letterHtml (js/pebbles.js) takes an explicit hex rather than deriving one
// from `label` itself, since a subchannel (zoomedSubNodesHtml) has no color of
// its own and uses its parent channel's hex instead — hashing the
// subchannel's own label would give it an unrelated color, breaking the
// one-color theme the rest of that zoomed page (blob, beams) already carries.
function channelLetterHtml(channel) {
  return letterHtml(channel.label, channelHex(channel));
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Step 2: 8 spokes radiating out from the octagon's own edges. The octagon
// (.menu-node-home's clip-path) is itself a regular 8-gon, so its 8 edge
// midpoints sit at exactly these same 45°-apart directions from its center
// — no separate per-edge geometry needed, just draw each spoke outward at
// 0/45/90.../315° from HOME.pos.
//
// Each spoke starts at SPOKE_INNER_RADIUS, not at HOME.pos itself — the
// octagon's own rendered radius is a *fixed pixel* size (.menu-node-home's
// width/height) while this SVG's logical units scale with the stage's vmin
// size, so the two never line up exactly; on top of that, the diagonal
// spokes exit the octagon almost exactly along its clip-path seam (where
// the corner is cut off), so relying on the node simply painting over the
// inner segment was one anti-aliasing/rounding error away from a visible
// sliver poking past the border. Starting the line itself past the
// octagon's edge, with a clear gap, makes that overlap impossible instead
// of relying on paint order to hide it.
const SPOKE_COUNT = 8;
// Close to the octagon's own rendered edge without touching it — see
// innerRingHtml below.
const SPOKE_INNER_RADIUS = 115;
// ~15% shorter than the original 430.
const SPOKE_OUTER_RADIUS = 365;

// Step 3: each spoke's straight line is now a stack of short arcs instead —
// literally the same curve as the inner ring (a piece of a circle centered
// on HOME.pos), just repeated at increasing radii out to SPOKE_OUTER_RADIUS,
// so it reads as "))))" along each spoke rather than a solid stroke.
//
// Each arc's *length* (not its angle) is what's interpolated, linearly from
// ARC_LENGTH_START down to ARC_LENGTH_END, and the angle is derived from
// that per-arc length/radius pair. Interpolating the angle directly doesn't
// work: radius grows outward too, so a linearly-shrinking angle still
// covers more actual distance per arc for a few steps before the angle
// shrinks fast enough to win out — the arcs visibly widen before they
// narrow. Driving the length directly guarantees it only ever shrinks.
const ARCS_PER_SPOKE = 10;
const ARC_LENGTH_START = 42;
const ARC_LENGTH_END = 10;

// Half-angle (degrees) of an arc of the given length at the given radius.
function halfAngleForLength(length, radius) {
  return (length / radius) * (180 / Math.PI) / 2;
}

// The 8 spoke angles themselves — -90° (north) as spoke 0, clockwise from
// there (North/NE/E/SE/S/SW/W/NW), same compass order the old hand-authored
// channel positions used. These are each element's *base*, unrotated
// position — the actual on-screen rotation happens entirely via the
// .menu-spoke-ring/.menu-channel-ring wrapper transforms (see edgesHtml/
// channelNodesHtml), not by baking rotationSteps into the angle math here,
// so the arcs and the blobs rotate together as a single rigid assembly
// instead of two independently-computed layouts that could drift apart.
function spokeAngles() {
  const angles = [];
  for (let i = 0; i < SPOKE_COUNT; i++) angles.push(-90 + i * (360 / SPOKE_COUNT));
  return angles;
}

// The point at the given angle/radius from an arbitrary center — same polar
// math arcPath uses, factored out since node placement below just needs
// the single endpoint, not a whole arc.
function pointAtFrom(center, angleDeg, radius) {
  const rad = angleDeg * (Math.PI / 180);
  return { x: center.x + Math.cos(rad) * radius, y: center.y + Math.sin(rad) * radius };
}

// Same, but from HOME.pos specifically — every hub spoke/ring/arc measures
// from there.
function pointAt(angleDeg, radius) {
  return pointAtFrom(HOME.pos, angleDeg, radius);
}

// Same polar math as pointAt, but in %-of-box terms (50%,50% = center,
// 50+50=100% = box edge along an axis) — what clip-path's polygon() needs,
// as opposed to pointAt's 0-1000 logical units.
function percentPointAt(angleDeg, radiusFactor) {
  const rad = angleDeg * (Math.PI / 180);
  return { x: 50 + radiusFactor * 50 * Math.cos(rad), y: 50 + radiusFactor * 50 * Math.sin(rad) };
}

// A triangular wedge (apex at the box's own center) spanning centerAngle ±
// half of a spoke's own angular slice (360°/SPOKE_COUNT) — a square's
// corners sit further from center than its edges, so the two outer points
// are placed well beyond the box (SECTOR_RADIUS_FACTOR) and simply get
// clipped by the box's own bounds, rather than computing the exact corner
// geometry. That's also why a straight-edged triangle is enough — no arc
// needed — the box edge itself is what actually bounds the wedge.
const SECTOR_HALF_ANGLE_DEG = 180 / SPOKE_COUNT;
const SECTOR_RADIUS_FACTOR = 2;

function sectorClipPath(centerAngleDeg) {
  const p1 = percentPointAt(centerAngleDeg - SECTOR_HALF_ANGLE_DEG, SECTOR_RADIUS_FACTOR);
  const p2 = percentPointAt(centerAngleDeg + SECTOR_HALF_ANGLE_DEG, SECTOR_RADIUS_FACTOR);
  return `polygon(50% 50%, ${p1.x}% ${p1.y}%, ${p2.x}% ${p2.y}%)`;
}

// A short arc of the circle of the given radius (centered on HOME.pos),
// spanning centerAngle ± halfAngle — the same piece of circle the full
// inner ring below is made of, just a small slice of it.
function arcPath(cx, cy, radius, centerAngleDeg, halfAngleDeg) {
  const toRad = Math.PI / 180;
  const a1 = (centerAngleDeg - halfAngleDeg) * toRad;
  const a2 = (centerAngleDeg + halfAngleDeg) * toRad;
  const x1 = cx + Math.cos(a1) * radius;
  const y1 = cy + Math.sin(a1) * radius;
  const x2 = cx + Math.cos(a2) * radius;
  const y2 = cy + Math.sin(a2) * radius;
  return `M${x1} ${y1} A${radius} ${radius} 0 0 1 ${x2} ${y2}`;
}

function spokeArcsHtml() {
  const { x: cx, y: cy } = HOME.pos;
  const radiusStep = (SPOKE_OUTER_RADIUS - SPOKE_INNER_RADIUS) / (ARCS_PER_SPOKE - 1);
  const lengthStep = (ARC_LENGTH_END - ARC_LENGTH_START) / (ARCS_PER_SPOKE - 1);
  let paths = '';
  for (const angle of spokeAngles()) {
    for (let k = 0; k < ARCS_PER_SPOKE; k++) {
      const radius = SPOKE_INNER_RADIUS + radiusStep * k;
      const length = ARC_LENGTH_START + lengthStep * k;
      const halfAngle = halfAngleForLength(length, radius);
      paths += `<path class="menu-edge-arc" d="${arcPath(cx, cy, radius, angle, halfAngle)}"></path>`;
    }
  }
  return paths;
}

// A single ring through every spoke's inner endpoint — same SPOKE_INNER_RADIUS
// the arc stacks themselves start from, so it passes exactly through all 8
// points rather than being a separately-tuned number that could drift out
// of sync.
function innerRingHtml() {
  const { x: cx, y: cy } = HOME.pos;
  return `<circle class="menu-inner-ring" cx="${cx}" cy="${cy}" r="${SPOKE_INNER_RADIUS}"></circle>`;
}

// Step 5: two vertical lines at the stage's own left/right edges — frames
// the whole menu (hub or zoomed) as a square. Shared by both edgesHtml()
// below and zoomedEdgesHtml().
function squareFrameHtml() {
  return `
    <line class="menu-square-frame" x1="0" y1="0" x2="0" y2="1000"></line>
    <line class="menu-square-frame" x1="1000" y1="0" x2="1000" y2="1000"></line>
  `;
}

// An arc through the blob's own center, same role the old straight
// (perpendicular-to-ZOOM_DIAGONAL_DEG) guide line played — now curved
// instead. Its own circle's center sits ARC_CURVE_RADIUS out from the blob
// along ZOOM_DIAGONAL_DEG (the same bottom-left direction the back arrow
// sits in), so the arc is concave toward that corner — bulges away from it,
// through the blob's center. ARC_CURVE_RADIUS is the one knob for how
// pronounced that curve reads: bigger reads closer to the old straight
// line, smaller bows harder. (Tunable — not dialed in yet.)
const ARC_CURVE_RADIUS = 700;
// How far around that circle the arc spans, each way from the blob's own
// point — generous enough that both ends still land well past the stage's
// own bounds (same role the old straight line's own length played, see
// .menu-tree-stage's overflow: hidden in styles.css, which trims it to the
// visible square) regardless of ARC_CURVE_RADIUS.
const ARC_HALF_ANGLE_DEG = 80;

function blobNormalGuideHtml() {
  const arcCenter = zoomArcCenter();
  return `<path class="menu-diagonal-guide" d="${arcPath(arcCenter.x, arcCenter.y, ARC_CURVE_RADIUS, zoomArcBaseAngle(), ARC_HALF_ANGLE_DEG)}"></path>`;
}

// Marks the one fixed activation slot — bottom-right (SE, same 45° base
// angle as spokeAngles()[3]) — that Enter commits whatever channel is
// currently rotated into. Deliberately outside the rotating <g> below, so
// it always marks that same on-screen spot regardless of rotationSteps,
// the same way a radio dial's tuning needle stays put while the dial
// itself turns under it. A dotted guide line traces the same path back to
// the octagon a regular spoke would (SPOKE_INNER_RADIUS to
// SPOKE_OUTER_RADIUS), just fixed instead of rotating with the others.
// `angle` defaults to the hub's slot; the Inner layer passes its own, since 5
// radials land at a different bottom-right angle than the hub's 8.
const SLOT_INDICATOR_RADIUS = 105;

function slotIndicatorHtml(angle = 45) {
  const inner = pointAt(angle, SPOKE_INNER_RADIUS);
  const outer = pointAt(angle, SPOKE_OUTER_RADIUS);
  // The guide line stops at the indicator circle's own near edge, not its
  // center — same ray, just SLOT_INDICATOR_RADIUS short of outer.
  const guideEnd = pointAt(angle, SPOKE_OUTER_RADIUS - SLOT_INDICATOR_RADIUS);
  return `
    <line class="menu-slot-guide" x1="${inner.x}" y1="${inner.y}" x2="${guideEnd.x}" y2="${guideEnd.y}"></line>
    <circle class="menu-slot-indicator" cx="${outer.x}" cy="${outer.y}" r="${SLOT_INDICATOR_RADIUS}"></circle>
  `;
}

// spokeArcsHtml + innerRingHtml are wrapped in one rotating <g> — see
// applyRotation(), which is what actually turns this (and
// .menu-channel-ring) smoothly on Q/E. transform-box:
// view-box + transform-origin in the SVG's own 0-1000 user units is what
// makes the rotation pivot on HOME.pos exactly, the same point the spokes
// themselves are already computed from — see .menu-spoke-ring in
// styles.css.
function edgesHtml() {
  return `<svg class="menu-tree-edges" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><g class="menu-spoke-ring" style="transform: rotate(${rotationDeg()}deg);">${spokeArcsHtml()}${innerRingHtml()}</g>${slotIndicatorHtml()}</svg>`;
}

// The square frame (squareFrameHtml) drawn as its own persistent SVG,
// outside .menu-tree-viewport — shared by buildHub/buildZoomed, which both
// render this once per build() alongside the viewport rather than inside
// it. Kept separate so it's never a descendant of anything whose opacity
// switchZoomedChannel fades: being a sibling means it stays fully opaque
// (no flash) through every channel switch, the same way it was already
// excluded, by filtering, from fadeInRestOfPage's hub<->zoom opacity reset.
function frameHtml() {
  return `<svg class="menu-tree-edges menu-square-frame-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">${squareFrameHtml()}</svg>`;
}

// The zoomed-into-a-channel page (click a channel's blob — see
// channelNodesHtml's click handler in buildHub). The enlarged blob and the
// back arrow both sit on the same 135° (bottom-left) diagonal out of
// HOME.pos — ZOOM_BLOB_RADIUS/BACK_ARROW_RADIUS are just how far out along
// that one shared ray each one lands (via pointAt), rather than two
// independently hand-picked positions that could drift off that line.
const ZOOM_DIAGONAL_DEG = 135;
const ZOOM_BLOB_SIZE = 180;
const ZOOM_BLOB_RADIUS = 340;
const BACK_ARROW_RADIUS = 610;

// A triangle pointing in `directionDeg`, plus a short line parallel to the
// triangle's base sitting just behind it (away from the point) — the same
// "arrowhead + tail" shape as the back arrow, factored out since the beam
// markers further down reuse it too. Rounded via stroke-linejoin/linecap in
// CSS (headClass/tailClass) rather than anything computed here.
const ARROW_LENGTH = 50;
const ARROW_HALF_WIDTH = 32;
const ARROW_TAIL_GAP = 22;

function arrowGlyphHtml(center, directionDeg, groupAttrs, headClass, tailClass, scale = 1) {
  const toRad = Math.PI / 180;
  const fx = Math.cos(directionDeg * toRad);
  const fy = Math.sin(directionDeg * toRad);
  const px = Math.cos((directionDeg + 90) * toRad);
  const py = Math.sin((directionDeg + 90) * toRad);
  const { x: bx, y: by } = center;

  const length = ARROW_LENGTH * scale;
  const halfWidth = ARROW_HALF_WIDTH * scale;
  const tailGap = ARROW_TAIL_GAP * scale;

  const apex = { x: bx + fx * length, y: by + fy * length };
  const base1 = { x: bx + px * halfWidth, y: by + py * halfWidth };
  const base2 = { x: bx - px * halfWidth, y: by - py * halfWidth };

  const tail = { x: bx - fx * tailGap, y: by - fy * tailGap };
  const tail1 = { x: tail.x + px * halfWidth, y: tail.y + py * halfWidth };
  const tail2 = { x: tail.x - px * halfWidth, y: tail.y - py * halfWidth };

  return `
    <g ${groupAttrs}>
      <polygon class="${headClass}" points="${apex.x},${apex.y} ${base1.x},${base1.y} ${base2.x},${base2.y}"></polygon>
      <line class="${tailClass}" x1="${tail1.x}" y1="${tail1.y}" x2="${tail2.x}" y2="${tail2.y}"></line>
    </g>
  `;
}

// Back arrow (bottom-left corner), pointing toward the corner.
function backArrowHtml() {
  const center = pointAt(ZOOM_DIAGONAL_DEG, BACK_ARROW_RADIUS);
  return arrowGlyphHtml(center, ZOOM_DIAGONAL_DEG, 'class="menu-back-arrow" data-action="back"', 'menu-back-arrow-head', 'menu-back-arrow-tail');
}

// Two more of the same arrow glyph, placed at the midpoints of the 0° and
// 90°-from-horizontal beams (zoomSubAngles' own angle list, negated to this
// file's screen convention — see its own comment), each nudged a few
// pixels off that midpoint: the 0° one left, the 90° one down. Purely
// placed for now — no data-action/click handler, so they don't get the
// back arrow's own pointer-cursor/hover styling (separate classes below).
const BEAM_MARKER_NUDGE = 20;

// Further nudge for the top (90°-beam) marker specifically — ~100px
// diagonally up-left on screen, split evenly between x/y for a clean 45°
// move; converted to this file's logical units via the same px-per-unit
// scale this whole page was tuned against (~0.64 at the stage's default
// capped size, so ~110 logical units per 100 screen px along one diagonal
// axis — same ratio TOP_MARKER_EXTRA_SHIFT/BOTTOM_MARKER_DIAGONAL_SHIFT
// below are each derived from too).
const TOP_MARKER_DIAGONAL_SHIFT = 110;
// An additional diagonal-up-left move on top of the one above (~35px).
const TOP_MARKER_EXTRA_SHIFT = 39;
// Bottom (0°-beam) marker's own diagonal move, down-right (~100px).
const BOTTOM_MARKER_DIAGONAL_SHIFT = 110;
// Further straight (non-diagonal) nudge on top of that — 20px down, 35px
// right — using the same ~1.5625 logical-units-per-screen-px ratio
// (1/0.64) the diagonal shifts above are built on.
const BOTTOM_MARKER_EXTRA_DOWN = 31;
const BOTTOM_MARKER_EXTRA_RIGHT = 55;

function beamMidpointMarkersHtml() {
  const blobCenter = zoomBlobCenter();
  const midRadius = (BEAM_START_RADIUS + BEAM_END_RADIUS) / 2;

  // Bottom marker (0°-beam, toward the east subchannel) — rotated 90°
  // clockwise from its original east-pointing direction (points south),
  // then moved diagonally toward the bottom-right.
  const bottomDeg = 90;
  const bottomMid = pointAtFrom(blobCenter, 0, midRadius);
  const bottomPoint = {
    x: bottomMid.x - BEAM_MARKER_NUDGE + BOTTOM_MARKER_DIAGONAL_SHIFT + BOTTOM_MARKER_EXTRA_RIGHT,
    y: bottomMid.y + BOTTOM_MARKER_DIAGONAL_SHIFT + BOTTOM_MARKER_EXTRA_DOWN,
  };

  // Top marker (90°-beam, toward the north subchannel) — rotated 90°
  // anticlockwise from its original north-pointing direction (points
  // west), then moved diagonally up-left twice: the original 100px shift,
  // plus this round's extra 35px further in the same up-left direction.
  const topDeg = -180;
  const topMid = pointAtFrom(blobCenter, -90, midRadius);
  const topShift = TOP_MARKER_DIAGONAL_SHIFT + TOP_MARKER_EXTRA_SHIFT;
  const topPoint = {
    x: topMid.x - topShift,
    y: topMid.y + BEAM_MARKER_NUDGE - topShift,
  };

  // Switch to the previous/next REGULAR channel's own zoomed page (see
  // switchZoomedChannel) — top = previous, bottom = next, matching which
  // end of the diagonal guide's own arc (blobNormalGuideHtml) each one
  // sits nearer: switchZoomedChannel now swings the whole assembly around
  // that same arc, toward decreasing angle (this top/prev marker's own
  // side) or increasing angle (bottom/next's).
  return (
    arrowGlyphHtml(bottomPoint, bottomDeg, 'class="menu-beam-marker" data-action="next-channel"', 'menu-beam-marker-head', 'menu-beam-marker-tail') +
    arrowGlyphHtml(topPoint, topDeg, 'class="menu-beam-marker" data-action="prev-channel"', 'menu-beam-marker-head', 'menu-beam-marker-tail')
  );
}

// Sonar arcs (same motif as spokeArcsHtml/ARC_LENGTH_START/END) filling the
// gap along that same diagonal, between the blob and the back arrow.
const ZOOM_SONAR_COUNT = 6;
const ZOOM_SONAR_INNER_RADIUS = 400;
const ZOOM_SONAR_OUTER_RADIUS = 560;

function zoomSonarHtml() {
  const { x: cx, y: cy } = HOME.pos;
  const radiusStep = (ZOOM_SONAR_OUTER_RADIUS - ZOOM_SONAR_INNER_RADIUS) / (ZOOM_SONAR_COUNT - 1);
  // Reversed from spokeArcsHtml's own direction: ZOOM_SONAR_INNER_RADIUS is
  // the blob end here, ZOOM_SONAR_OUTER_RADIUS the arrow end, and these
  // should come from the arrow (thick, ARC_LENGTH_START) and thin toward
  // the blob (ARC_LENGTH_END) — the opposite of the hub's own spokes, which
  // start thick near the center and thin going outward.
  const lengthStep = (ARC_LENGTH_START - ARC_LENGTH_END) / (ZOOM_SONAR_COUNT - 1);
  let paths = '';
  for (let k = 0; k < ZOOM_SONAR_COUNT; k++) {
    const radius = ZOOM_SONAR_INNER_RADIUS + radiusStep * k;
    const length = ARC_LENGTH_END + lengthStep * k;
    const halfAngle = halfAngleForLength(length, radius);
    paths += `<path class="menu-edge-arc" d="${arcPath(cx, cy, radius, ZOOM_DIAGONAL_DEG, halfAngle)}"></path>`;
  }
  return paths;
}

// The enlarged blob's own center — shared by zoomedNodeHtml itself and the
// subchannel fan below, which is placed relative to the blob, not HOME.pos.
function zoomBlobCenter() {
  return pointAt(ZOOM_DIAGONAL_DEG, ZOOM_BLOB_RADIUS);
}

// The circle the diagonal guide (blobNormalGuideHtml) traces, and the same
// one the whole zoomed assembly (blob/beams/subchannels — see
// switchZoomedChannel) orbits along when switching channels. Fixed for the
// whole app session: every input (ZOOM_DIAGONAL_DEG/ZOOM_BLOB_RADIUS/
// ARC_CURVE_RADIUS) is itself a constant, so this is the same point every
// render, not something that varies by channel.
function zoomArcCenter() {
  return pointAtFrom(zoomBlobCenter(), ZOOM_DIAGONAL_DEG, ARC_CURVE_RADIUS);
}

// The blob's own angle as seen from zoomArcCenter() — the arc's angular
// midpoint (blobNormalGuideHtml) and the assembly's own resting rotation
// (switchZoomedChannel, which rotates away from/into this exact angle).
function zoomArcBaseAngle() {
  return ZOOM_DIAGONAL_DEG + 180;
}

// A tapered beam (a filled quad, not a uniform-width line) from `startRadius`
// to `endRadius` out of `center` along `angleDeg`, narrower at one end than
// the other — same perpendicular-offset construction the back arrow's own
// triangle uses, just two different half-widths instead of one.
function beamPoints(center, angleDeg, startRadius, endRadius, startHalfWidth, endHalfWidth) {
  const toRad = Math.PI / 180;
  const fx = Math.cos(angleDeg * toRad);
  const fy = Math.sin(angleDeg * toRad);
  const px = Math.cos((angleDeg + 90) * toRad);
  const py = Math.sin((angleDeg + 90) * toRad);
  const start = { x: center.x + fx * startRadius, y: center.y + fy * startRadius };
  const end = { x: center.x + fx * endRadius, y: center.y + fy * endRadius };
  const p1 = { x: start.x + px * startHalfWidth, y: start.y + py * startHalfWidth };
  const p2 = { x: start.x - px * startHalfWidth, y: start.y - py * startHalfWidth };
  const p3 = { x: end.x - px * endHalfWidth, y: end.y - py * endHalfWidth };
  const p4 = { x: end.x + px * endHalfWidth, y: end.y + py * endHalfWidth };
  return `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`;
}

// One beam per subchannel slot, from near the blob's own edge out to near
// that subchannel's — wider at the blob end, narrower at the subchannel end
// (BEAM_START_HALF_WIDTH > BEAM_END_HALF_WIDTH), colored the channel's own
// hex (channelHex — same source channelColorVars uses for the blob's
// border), so each zoomed page reads in its own channel's color even
// though the blob/subchannel nodes themselves stay neutral.
const BEAM_START_RADIUS = 100;
// 60 short of ZOOM_SUB_RADIUS (below) — same gap kept whenever that one
// changes, so the beam always stops just short of the subchannel node's
// own edge instead of running into or drifting away from it.
const BEAM_END_RADIUS = 540;
const BEAM_START_HALF_WIDTH = 16;
const BEAM_END_HALF_WIDTH = 7;

function zoomedBeamsHtml(channel) {
  const center = zoomBlobCenter();
  const hex = channelHex(channel);
  // Same border color the blob itself rests at (--node-color-dim —
  // channelColorVars' own 0.35-opacity version of this hex), interior
  // fainter still.
  return zoomSubAngles().map((angle) => {
    const points = beamPoints(center, angle, BEAM_START_RADIUS, BEAM_END_RADIUS, BEAM_START_HALF_WIDTH, BEAM_END_HALF_WIDTH);
    return `<polygon class="menu-sub-beam" points="${points}" style="fill:${hexToRgba(hex, 0.1)}; stroke:${hexToRgba(hex, 0.35)};"></polygon>`;
  }).join('');
}

// transform-origin for the SVG orbit group (.menu-zoom-orbit-edges below) —
// pivots on zoomArcCenter(), the exact same point blobNormalGuideHtml's
// dashed arc already traces, so switching channels (switchZoomedChannel)
// visibly travels along that same curve. transform-box: view-box makes the
// SVG viewBox's own 0-1000 user units available to transform-origin (same
// trick .menu-spoke-ring uses in styles.css) — without it, transform-origin
// would default to this <g>'s own bounding box instead.
function zoomOrbitEdgesOriginAttr() {
  const { x, y } = zoomArcCenter();
  return `transform-box: view-box; transform-origin: ${x}px ${y}px;`;
}

// Same pivot as above, but for the HTML orbit group (buildZoomed's own
// .menu-zoom-orbit-nodes, position: absolute; inset: 0; in styles.css) —
// percentage-based since that's a plain HTML box, not an SVG one; /10
// converts zoomArcCenter()'s 0-1000 logical units to the 0-100% that box
// resolves transform-origin against, same conversion nodeStyle already
// uses for left/top.
function zoomOrbitNodesOriginAttr() {
  const { x, y } = zoomArcCenter();
  return `transform-origin: ${x / 10}% ${y / 10}%;`;
}

function zoomedEdgesHtml(channel) {
  return `<svg class="menu-tree-edges" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">${blobNormalGuideHtml()}${zoomSonarHtml()}<g class="menu-zoom-orbit-edges" style="${zoomOrbitEdgesOriginAttr()}">${zoomedBeamsHtml(channel)}</g>${backArrowHtml()}${beamMidpointMarkersHtml()}</svg>`;
}

// Less organic than the hub's own blobs (.menu-blob-N) — see
// .menu-node-channel-zoomed in styles.css, which overrides whichever preset
// class this still carries (kept for color/border continuity with its hub
// node, just not for shape here).
//
// The label is wrapped in .menu-node-content — same counter-rotation trick
// the hub's own channelNodesHtml uses — so switchZoomedChannel can spin
// .menu-zoom-orbit-nodes (this button's parent) without the text itself
// visibly rotating along with it.
function zoomedNodeHtml(channel) {
  const idx = REGULAR.findIndex((c) => c.id === channel.id);
  const sizeStyle = `width:${ZOOM_BLOB_SIZE}px; height:${ZOOM_BLOB_SIZE}px;`;
  return `
    <button type="button" class="menu-node menu-node-channel menu-node-channel-zoomed menu-blob-${idx % BLOB_PRESET_COUNT}" data-channel="${escapeHtml(channel.id)}" style="${nodeStyle(zoomBlobCenter())} ${sizeStyle} ${channelColorVars(channel)}" title="${escapeHtml(channel.label)}">
      <span class="menu-node-content">
        ${channelLetterHtml(channel)}
        <span class="menu-node-label mono">${escapeHtml(channel.label)}</span>
      </span>
    </button>
  `;
}

// 4 subchannel slots fanning out from the blob (same "N real ones + ???
// placeholders fill the rest" pattern the outer ring's 8 slots use) — one
// per 30°, from vertical (90°, subs[0]) down to the horizontal (0°,
// subs[3]), into the open space away from the back arrow's corner — so the
// subchannel list reads top-to-bottom in array order, matching
// ArrowLeft/ArrowRight's own up-the-list/down-the-list direction (see
// applySubSelection). Angles are given "from the horizontal" in the usual
// sense (0 = pointing right, 90 = straight up, standard y-up convention) —
// negated here since this file's own angle convention is screen space (y
// down), where a positive angle points downward instead.
const ZOOM_SUB_ANGLES_FROM_HORIZONTAL_DEG = [90, 60, 30, 0];
// Pulled in from the square frame's own edges (shorter than the 0°/90°
// ones would need to be to land right on them) so the subchannels sit
// closer to the blob — BEAM_END_RADIUS stays offset from this by the same
// 60 units it always was, so the beam still stops just short of each
// node's own edge rather than drifting apart from it as this changes.
const ZOOM_SUB_RADIUS = 600;
const ZOOM_SUB_SIZE = 96;

function zoomSubAngles() {
  return ZOOM_SUB_ANGLES_FROM_HORIZONTAL_DEG.map((deg) => -deg);
}

function zoomedSubNodesHtml(channel) {
  const center = zoomBlobCenter();
  const subs = channel.subchannels || [];
  const hex = channelHex(channel);
  return zoomSubAngles().map((angle, i) => {
    const sub = subs[i];
    const label = sub ? sub.label : '???';
    const sizeStyle = `width:${ZOOM_SUB_SIZE}px; height:${ZOOM_SUB_SIZE}px;`;
    // is-selected reused from the pre-v65 selection system (styles.css) —
    // ArrowLeft/ArrowRight (onKeyDown/applySubSelection) toggle it directly on
    // the matching data-sub-index button rather than triggering a rebuild,
    // same reasoning applyRotation's own in-place class/style updates give.
    const selectedClass = i === zoomedSubIndex ? ' is-selected' : '';
    return `
      <button type="button" class="menu-node menu-node-channel menu-node-sub-zoomed${selectedClass}" data-sub-index="${i}" style="${nodeStyle(pointAtFrom(center, angle, ZOOM_SUB_RADIUS))} ${sizeStyle}" title="${escapeHtml(label)}">
        <span class="menu-node-content">
          ${letterHtml(label, hex)}
          <span class="menu-node-label mono">${escapeHtml(label)}</span>
        </span>
      </button>
    `;
  }).join('');
}

// Step 4: one circle per outer-ring channel, placed at its spoke's own
// SPOKE_OUTER_RADIUS endpoint — REGULAR[i] sits on spokeAngles()[i], same
// index pairing spokeArcsHtml() uses for its own 8 spokes, so a channel
// always lands exactly where its spoke points. Clicking one zooms in (see
// buildHub's click handler below), same logic for every channel.
//
// Each node is wrapped in a .menu-sector div (its own 45°-wide pie slice of
// the whole stage, see sectorClipPath) — hovering anywhere in that slice,
// not just the small blob itself, triggers the blob-expansion hover rule
// (see .menu-sector:hover in styles.css). Shapes cycle through
// BLOB_PRESET_COUNT (js/pebbles.js).

// The whole group rotates as one rigid body (position AND the blobs'
// borders/shape along with it) via .menu-channel-ring's own transform, so
// each button keeps using its *base* spokeAngles() position — same ones
// the (also-rotating) spokes/arcs use, so a blob is always sitting right
// where its own spoke points regardless of rotationSteps. Only the visible
// label content is counter-rotated back upright (.menu-node-content), not
// the button itself — keeping that off the button means its hover
// scale-up transition (fast, 150ms) never fights with the rotation's own
// (slow, 500ms) on the same CSS property.
function channelNodesHtml() {
  const angles = spokeAngles();
  const counterRotate = `${-rotationDeg()}deg`;
  const items = REGULAR.map((c, i) => `
    <div class="menu-sector" style="clip-path: ${sectorClipPath(angles[i])};">
      <button type="button" class="menu-node menu-node-channel menu-blob-${i % BLOB_PRESET_COUNT}" data-channel="${escapeHtml(c.id)}" style="${nodeStyle(pointAt(angles[i], SPOKE_OUTER_RADIUS))} ${channelColorVars(c)}" title="${escapeHtml(c.label)}">
        <span class="menu-node-content" style="--counter-rotate:${counterRotate};">
          ${channelLetterHtml(c)}
          <span class="menu-node-label mono">${escapeHtml(c.label)}</span>
        </span>
      </button>
    </div>
  `).join('');
  return `<div class="menu-channel-ring" style="transform: rotate(${rotationDeg()}deg);">${items}</div>`;
}

function buildHub() {
  container.innerHTML = `
    <div class="menu-stage">
      <div class="menu-tree-stage">
        ${frameHtml()}
        <div class="menu-tree-viewport">
          ${edgesHtml()}
          <div class="menu-tree-nodes">
            <button type="button" class="menu-node menu-node-home" data-action="home" style="${nodeStyle(HOME.pos)}" title="Home">
              <span class="menu-node-home-label mono">Home</span>
            </button>
            ${channelNodesHtml()}
          </div>
          ${layerArrowHtml()}
        </div>
      </div>
    </div>
  `;

  wireLayerArrow();

  container.querySelector('[data-action="home"]')?.addEventListener('click', goHome);

  // Clicking a channel's blob zooms into its own page (buildZoomed) — same
  // logic for every channel, selected purely by id.
  container.querySelectorAll('[data-channel]').forEach((el) => {
    const channel = channelById(el.dataset.channel);
    if (!channel) return;
    el.addEventListener('click', () => enterChannel(channel));
  });
}

// How long the zoom-back-out animation takes — shared by the FLIP transform
// below and the fade-in of whatever page-specific content the hub has that
// the zoomed page didn't, so both finish together.
const ZOOM_TRANSITION_MS = 350;

// The actual "zooms back out of a channel" effect (going in uses
// zoomTransition instead): a FLIP animation (First-Last-Invert-Play).
// `originEl` is measured as the "first" state before `setState` + build()
// switch pages; the SAME channel's blob on the new page (matched by
// data-channel) is the "last" state. Rather than faking a generic scale-down,
// this measures both real rects and animates the *exact* delta between them,
// so the blob visually shrinks and slides from right where it was into right
// where it lands.
function flipChannelBlob(channel, originEl, setState) {
  // The back arrow can still be clicked while the channel is zooming in (keys
  // are already held off in onKeyDown).
  if (zoomTimer) return;
  const firstRect = originEl.getBoundingClientRect();

  setState();
  build();

  const newBlob = container.querySelector(`.menu-node-channel[data-channel="${channel.id}"]`);
  if (!newBlob) return;
  const lastRect = newBlob.getBoundingClientRect();

  const dx = (firstRect.left + firstRect.width / 2) - (lastRect.left + lastRect.width / 2);
  const dy = (firstRect.top + firstRect.height / 2) - (lastRect.top + lastRect.height / 2);
  const scale = firstRect.width / lastRect.width;

  // Jump to the "first" state with transitions off, force a layout flush
  // so the browser actually registers that starting point, then switch
  // transitions on and flip to the natural resting transform — same
  // translate(-50%,-50%) .menu-node's own CSS already centers it with,
  // just with the FLIP delta appended so it starts exactly over firstRect.
  newBlob.style.transition = 'none';
  newBlob.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${scale})`;
  void newBlob.offsetWidth;
  newBlob.style.transition = `transform ${ZOOM_TRANSITION_MS}ms ease`;
  requestAnimationFrame(() => {
    newBlob.style.transform = 'translate(-50%, -50%)';
  });
  setTimeout(() => {
    newBlob.style.transition = '';
    newBlob.style.transform = '';
  }, ZOOM_TRANSITION_MS);

  fadeInRestOfPage(newBlob);
}

// Fades in everything on the just-rendered page except `keepEl` (the blob
// still mid-FLIP) and the square frame (present on both pages already, so
// fading it would just flicker it) — the hub's other 7 blobs/sectors, Home,
// its spokes and ring.
function fadeInRestOfPage(keepEl) {
  const candidates = container.querySelectorAll('.menu-tree-nodes > *, .menu-tree-edges > *');
  const targets = [...candidates].filter((n) => {
    if (n.classList.contains('menu-square-frame')) return false;
    if (n === keepEl || n.contains(keepEl)) return false;
    return true;
  });
  targets.forEach((n) => {
    n.style.opacity = '0';
    n.style.transition = 'none';
  });
  void container.querySelector('.menu-tree-viewport')?.getBoundingClientRect();
  targets.forEach((n) => {
    n.style.transition = `opacity ${ZOOM_TRANSITION_MS}ms ease`;
  });
  requestAnimationFrame(() => {
    targets.forEach((n) => { n.style.opacity = '1'; });
  });
  setTimeout(() => {
    targets.forEach((n) => {
      n.style.transition = '';
      n.style.opacity = '';
    });
  }, ZOOM_TRANSITION_MS);
}

// The zoomed-into-a-channel page itself: the enlarged blob, its 4
// subchannel nodes, and the back arrow (see ZOOM_BLOB_RADIUS/
// backArrowHtml's comments). The blob + subchannels share one wrapping
// div (.menu-zoom-orbit-nodes) — same pivot (zoomOrbitNodesOriginAttr) its
// SVG counterpart (.menu-zoom-orbit-edges, zoomedEdgesHtml) uses for the
// beams — so switchZoomedChannel can rotate the two together around
// zoomArcCenter() without the back arrow/sonar arcs/square frame/guide
// (which stay fixed) moving with them.
function buildZoomed(channel) {
  // menu-stage-zoomed: lets phone mode (styles.css) treat this page apart
  // from the hub/layers.
  container.innerHTML = `
    <div class="menu-stage menu-stage-zoomed">
      <div class="menu-tree-stage">
        ${frameHtml()}
        <div class="menu-tree-viewport">
          ${zoomedEdgesHtml(channel)}
          <div class="menu-tree-nodes">
            <div class="menu-zoom-orbit-nodes" style="${zoomOrbitNodesOriginAttr()}">
              ${zoomedNodeHtml(channel)}
              ${zoomedSubNodesHtml(channel)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-action="back"]')?.addEventListener('click', () => goBackToHub(channel));
  container.querySelector('[data-action="prev-channel"]')?.addEventListener('click', () => switchZoomedChannel(-1));
  container.querySelector('[data-action="next-channel"]')?.addEventListener('click', () => switchZoomedChannel(1));

  // Clicking a subchannel node navigates straight to it — same destination
  // a letter keybind (onKeyDown/subchannelByLetter) already reaches, just
  // found by its own data-sub-index (zoomedSubNodesHtml) instead. A `???`
  // placeholder slot (no real sub at that index) is a no-op, same as every
  // other placeholder in the app.
  container.querySelectorAll('[data-sub-index]').forEach((el) => {
    const sub = channel.subchannels?.[Number(el.dataset.subIndex)];
    if (!sub?.route) return;
    el.addEventListener('click', () => { location.hash = '#' + sub.route; });
  });
}

// How long switchZoomedChannel's own fade takes, each way (the full switch
// is twice this — fade out the old channel's page, then fade in the new
// one) — also drives the orbit-rotate animation below, kept in lockstep
// with the fade.
const SWITCH_FADE_MS = 250;

// How far the whole zoomed assembly (blob + beams + subchannel nodes, via
// .menu-zoom-orbit-nodes/.menu-zoom-orbit-edges) swings around
// zoomArcCenter() on each switchZoomedChannel step — the same circle
// blobNormalGuideHtml's dashed arc traces. A separate knob from
// ARC_HALF_ANGLE_DEG on purpose: that one's just how much of the circle the
// dashed guide itself draws, not how far content actually travels along it.
// Tunable — not dialed in yet.
const SWITCH_ARC_STEP_DEG = 50;

// Rotates both orbit groups together (kept in lockstep — the beams have to
// stay attached to the blob/subchannels they connect) by `deg` around
// zoomArcCenter(), plus the matching counter-rotation on every node's own
// .menu-node-content inside them so labels stay upright through the motion
// — same trick the hub ring's own channelNodesHtml uses, just driven here
// with switchZoomedChannel's own transition timing instead of the hub
// ring's persistent 500ms one (see .menu-zoom-orbit-nodes in styles.css).
function setZoomOrbitRotation(root, deg, withTransition) {
  const edges = root?.querySelector('.menu-zoom-orbit-edges');
  const nodes = root?.querySelector('.menu-zoom-orbit-nodes');
  if (!edges || !nodes) return;
  const transition = withTransition ? `transform ${SWITCH_FADE_MS}ms ease` : 'none';
  edges.style.transition = transition;
  nodes.style.transition = transition;
  edges.style.transform = `rotate(${deg}deg)`;
  nodes.style.transform = `rotate(${deg}deg)`;
  nodes.querySelectorAll('.menu-node-content').forEach((el) => {
    el.style.transition = transition;
    el.style.transform = `rotate(${-deg}deg)`;
  });
}

// Switches which REGULAR channel is zoomed into, by `direction` (-1/+1),
// wrapping around REGULAR's own order. The current assembly (blob/beams/
// subchannels) swings further around zoomArcCenter() in `direction`'s own
// sense — positive = clockwise, same convention applyRotation uses for the
// hub ring (see spokeAngles' own comment) — while fading out; the next
// channel's own assembly starts from the opposite side of that same arc
// and swings back in to rest while fading in. direction=+1 (the bottom-
// right beam marker, "next") rotates toward increasing angle, the same
// side of the arc that marker itself sits on; direction=-1 (top-left,
// "prev") rotates toward decreasing angle, matching that marker's own
// side — see zoomArcBaseAngle/ARC_HALF_ANGLE_DEG for how the arc's two
// ends line up with those two corners.
function switchZoomedChannel(direction) {
  if (zoomTimer || !zoomedChannelId) return;
  const currentIdx = REGULAR.findIndex((c) => c.id === zoomedChannelId);
  if (currentIdx === -1) return;
  const n = REGULAR.length;
  const nextChannel = REGULAR[((currentIdx + direction) % n + n) % n];

  const viewport = container?.querySelector('.menu-tree-viewport');
  if (!viewport) return;

  viewport.style.transition = `opacity ${SWITCH_FADE_MS}ms ease`;
  viewport.style.opacity = '0';
  setZoomOrbitRotation(viewport, direction * SWITCH_ARC_STEP_DEG, true);

  setTimeout(() => {
    zoomedChannelId = nextChannel.id;
    zoomedSubIndex = -1;
    build();

    const newViewport = container?.querySelector('.menu-tree-viewport');
    if (!newViewport) return;
    newViewport.style.transition = 'none';
    newViewport.style.opacity = '0';
    setZoomOrbitRotation(newViewport, -direction * SWITCH_ARC_STEP_DEG, false);
    void newViewport.offsetWidth;
    newViewport.style.transition = `opacity ${SWITCH_FADE_MS}ms ease`;
    requestAnimationFrame(() => {
      newViewport.style.opacity = '1';
      setZoomOrbitRotation(newViewport, 0, true);
    });
    setTimeout(() => {
      newViewport.style.transition = '';
      newViewport.style.opacity = '';
    }, SWITCH_FADE_MS);
  }, SWITCH_FADE_MS);
}

// Same FLIP animation as zooming in, run in reverse — the zoomed blob is
// the "first" state, its hub counterpart (still the same channel) is the
// "last" one. Matched by data-channel specifically — the subchannel nodes
// are also .menu-node-channel but don't carry that attribute. Shared by
// the back arrow's click (buildZoomed) and Escape (onKeyDown).
function goBackToHub(channel) {
  const blob = container?.querySelector(`.menu-node-channel[data-channel="${channel.id}"]`);
  if (!blob) return;
  flipChannelBlob(channel, blob, () => { zoomedChannelId = null; zoomedSubIndex = -1; });
}

// A non-hub layer's whole page for now: one ??? shape at the center, captioned
// with which layer this is. A plain div, not a button — nothing to click yet.
// Each layer also carries the hub's thin ring (innerRingHtml), with the shape's
// tips just inside it.
// How far the tips stop short of the ring, in the stage's 0-1000 logical units
// — 10px at the stage's full 640px size (1 unit = 0.64px).
const LAYER_SHAPE_RING_GAP = 16;
// Inner is a circle with a serrated edge, Outer (null) a plain circle. Radii are
// in layerShapeHtml's own 0-100 viewBox — lower notchRadius cuts deeper.
const LAYER_SHAPES = {
  '-1': { points: 15, notchRadius: 43 },
  1: null,
};
// Tips stop just short of the box's edge (50) so the stroke isn't clipped.
const LAYER_SHAPE_TIP_RADIUS = 49;

// The shape's outline as SVG: a polygon alternating tip/notch points, since a
// CSS border can't follow a jagged edge, or a plain circle of the same reach.
function layerShapeHtml(shape) {
  let outline = `<circle cx="50" cy="50" r="${LAYER_SHAPE_TIP_RADIUS}"></circle>`;
  if (shape) {
    const points = [];
    for (let i = 0; i < shape.points * 2; i++) {
      const radius = i % 2 === 0 ? LAYER_SHAPE_TIP_RADIUS : shape.notchRadius;
      const { x, y } = pointAtFrom({ x: 50, y: 50 }, -90 + i * (180 / shape.points), radius);
      points.push(`${x},${y}`);
    }
    outline = `<polygon points="${points.join(' ')}"></polygon>`;
  }
  return `<svg class="menu-layer-shape" viewBox="0 0 100 100" aria-hidden="true">${outline}</svg>`;
}

// The Inner layer's radial lines — same span as the hub's sonar stacks
// (SPOKE_INNER_RADIUS to SPOKE_OUTER_RADIUS), but each one a dashed triangle
// with its tip on the thin ring, widening outward. 72° apart from north, which
// also lands each one on a serration tooth (15 teeth = 24° each).
const INNER_RADIAL_COUNT = 5;
const INNER_RADIAL_BASE_HALF_WIDTH = 20;

function innerRadialAngle(i) {
  return -90 + i * (360 / INNER_RADIAL_COUNT);
}

function innerRadialsHtml() {
  const toRad = Math.PI / 180;
  let triangles = '';
  for (let i = 0; i < INNER_RADIAL_COUNT; i++) {
    const angle = innerRadialAngle(i);
    const tip = pointAt(angle, SPOKE_INNER_RADIUS);
    const baseCenter = pointAt(angle, SPOKE_OUTER_RADIUS);
    const px = Math.cos((angle + 90) * toRad) * INNER_RADIAL_BASE_HALF_WIDTH;
    const py = Math.sin((angle + 90) * toRad) * INNER_RADIAL_BASE_HALF_WIDTH;
    triangles += `<polygon class="menu-layer-radial" points="${tip.x},${tip.y} ${baseCenter.x + px},${baseCenter.y + py} ${baseCenter.x - px},${baseCenter.y - py}"></polygon>`;
  }
  return triangles;
}

// One pebble on the end of each radial, centered on its base the way a hub
// pebble sits on its spoke's end — colored and lettered the same way a hub
// channel is when INNER_LAYER_CHANNELS has one for that slot, ??? otherwise.
// One with a `route` opens it on click (wireInnerPebbles); the rest are inert.
// Wrapped in the same .menu-channel-ring the hub's pebbles use, so
// applyRotation turns them with the radials and keeps their labels upright.
function innerPebblesHtml() {
  const counterRotate = `${-innerRotationDeg()}deg`;
  let pebbles = '';
  for (let i = 0; i < INNER_RADIAL_COUNT; i++) {
    const channel = INNER_LAYER_CHANNELS[i];
    const link = channel?.route ? ` menu-node-layer-link" data-route="${channel.route}` : '';
    pebbles += `
      <div class="menu-node menu-node-channel menu-node-layer-pebble${channel?.fullStrength ? ' menu-node-full-strength' : ''} menu-blob-${i % BLOB_PRESET_COUNT}${link}" style="${nodeStyle(pointAt(innerRadialAngle(i), SPOKE_OUTER_RADIUS))} ${channel ? channelColorVars(channel) : ''}">
        <span class="menu-node-content" style="--counter-rotate:${counterRotate};">
          ${channel ? channelLetterHtml(channel) : ''}
          <span class="menu-node-label mono">${channel ? escapeHtml(channel.label) : '???'}</span>
        </span>
      </div>
    `;
  }
  return `<div class="menu-channel-ring" style="transform: rotate(${innerRotationDeg()}deg);">${pebbles}</div>`;
}

// Which INNER_LAYER_CHANNELS entry the rotation has brought to the bottom-right
// slot (radial 2's angle) — same idea as the hub's channelInBottomRightSlot.
function innerPebbleInBottomRightSlot() {
  const i = (((2 - innerRotationSteps) % INNER_RADIAL_COUNT) + INNER_RADIAL_COUNT) % INNER_RADIAL_COUNT;
  return INNER_LAYER_CHANNELS[i];
}

function openInnerPebble(channel) {
  if (channel?.route) location.hash = '#' + channel.route;
}

function wireInnerPebbles() {
  container.querySelectorAll('.menu-node-layer-link[data-route]').forEach((el) => {
    el.addEventListener('click', () => { location.hash = '#' + el.dataset.route; });
  });
}

// The radials in the same rotating <g> the hub's spokes use, plus the fixed
// bottom-right slot marker at whichever radial angle is the bottom-right one.
function innerLayerEdgesHtml() {
  return `<g class="menu-spoke-ring" style="transform: rotate(${innerRotationDeg()}deg);">${innerRadialsHtml()}</g>${slotIndicatorHtml(innerRadialAngle(2))}`;
}

function buildLayerPlaceholder(name) {
  // A % of the stage, not fixed px like the hub's nodes, so the shape scales with
  // the ring it has to fit inside: the box whose tips (LAYER_SHAPE_TIP_RADIUS of
  // its half-width, 50) land LAYER_SHAPE_RING_GAP short of SPOKE_INNER_RADIUS.
  const tipRadius = SPOKE_INNER_RADIUS - LAYER_SHAPE_RING_GAP;
  const sizePercent = (tipRadius * (50 / LAYER_SHAPE_TIP_RADIUS) * 2) / 10;
  const sizeStyle = `width:${sizePercent}%; height:${sizePercent}%;`;
  const edges = `<svg class="menu-tree-edges" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">${innerRingHtml()}${currentLayer === INNER_LAYER ? innerLayerEdgesHtml() : ''}</svg>`;
  container.innerHTML = `
    <div class="menu-stage">
      <div class="menu-tree-stage">
        ${frameHtml()}
        <div class="menu-tree-viewport">
          ${edges}
          <div class="menu-tree-nodes">
            <div class="menu-node menu-node-layer" style="${nodeStyle(HOME.pos)} ${sizeStyle}">
              ${layerShapeHtml(LAYER_SHAPES[currentLayer])}
              <span class="menu-node-label mono">???</span>
              <span class="menu-node-layer-name mono">${name}</span>
            </div>
            ${currentLayer === INNER_LAYER ? innerPebblesHtml() : ''}
          </div>
          ${layerArrowHtml()}
        </div>
      </div>
    </div>
  `;
  wireLayerArrow();
  wireInnerPebbles();
}

// The touch equivalent of I/O: the back arrow's glyph in the top-left corner of
// every layer, up going one layer out (O) and down one layer in (I). Each only
// shows if that move exists: Outer has only down and Inner only up, both in the
// same spot (LAYER_ARROW_MID), while the hub stacks its two either side of it.
// Their own SVG after the nodes layer, unlike the back arrow, because the hub's
// .menu-sector wedges cover the corners and would otherwise take the click.
const LAYER_ARROW_SCALE = 0.6;
const LAYER_ARROW_MID = { x: 75, y: 85 };
const LAYER_ARROW_HUB_SPREAD = 32;
const LAYER_ARROWS = [
  { delta: 1, directionDeg: -90, sign: -1 },
  { delta: -1, directionDeg: 90, sign: 1 },
];

function layerExists(layer) {
  return layer === MAIN_LAYER || Boolean(LAYER_NAMES[layer]);
}

function layerArrowHtml() {
  // A glyph's center is its head's base, not its visual middle — this shifts
  // it so a flipped arrow covers exactly the same box as an unflipped one.
  const glyphOffset = ((ARROW_LENGTH - ARROW_TAIL_GAP) / 2) * LAYER_ARROW_SCALE;
  const spread = currentLayer === MAIN_LAYER ? LAYER_ARROW_HUB_SPREAD : 0;
  const arrows = LAYER_ARROWS
    .filter(({ delta }) => layerExists(currentLayer + delta))
    .map(({ delta, directionDeg, sign }) => {
      const center = { x: LAYER_ARROW_MID.x, y: LAYER_ARROW_MID.y + sign * (spread - glyphOffset) };
      return arrowGlyphHtml(center, directionDeg, `class="menu-back-arrow" data-layer-delta="${delta}"`, 'menu-back-arrow-head', 'menu-back-arrow-tail', LAYER_ARROW_SCALE);
    })
    .join('');
  return `<svg class="menu-tree-edges menu-layer-arrow-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">${arrows}</svg>`;
}

function wireLayerArrow() {
  container.querySelectorAll('[data-layer-delta]').forEach((el) => {
    el.addEventListener('click', () => goToLayer(currentLayer + Number(el.dataset.layerDelta)));
  });
}

// How long each half of a zoom takes (the old page leaving, then the new one
// arriving), and how far each one scales on its way. Reuses
// .menu-tree-viewport's own --zoom-scale, so everything inside it moves as one
// while the square frame (a sibling, see frameHtml) holds still.
const ZOOM_FADE_MS = 200;
const ZOOM_SCALE_SMALL = 0.6;
const ZOOM_SCALE_LARGE = 1.6;

// Moves to layer `next`, no-op past either end of LAYER_NAMES.
function goToLayer(next) {
  if (next === currentLayer) return;
  if (next !== MAIN_LAYER && !LAYER_NAMES[next]) return;
  zoomTransition(next > currentLayer, () => { currentLayer = next; });
}

// Swaps to whatever page `setState` + build() produce, as a zoom. Both halves
// scale the same way, so it reads as one continuous motion: going out, the old
// page shrinks away and the new one settles down from oversized; going in, the
// old page grows past the camera and the new one grows up from small. With a
// `focusSelector`, each half pivots on the element it matches on that half's
// page; without one, on the stage's center.
function zoomTransition(zoomingOut, setState, focusSelector) {
  if (zoomTimer) return;
  const viewport = container?.querySelector('.menu-tree-viewport');
  if (!viewport) return;

  const transition = `transform ${ZOOM_FADE_MS}ms ease, opacity ${ZOOM_FADE_MS}ms ease`;

  setZoomOrigin(viewport, focusSelector);
  viewport.style.transition = transition;
  viewport.style.opacity = '0';
  viewport.style.setProperty('--zoom-scale', zoomingOut ? ZOOM_SCALE_SMALL : ZOOM_SCALE_LARGE);

  zoomTimer = setTimeout(() => {
    setState();
    build();

    const newViewport = container.querySelector('.menu-tree-viewport');
    newViewport.style.transition = 'none';
    // Measured before the scale below, while the page is still at its true size.
    setZoomOrigin(newViewport, focusSelector);
    newViewport.style.opacity = '0';
    newViewport.style.setProperty('--zoom-scale', zoomingOut ? ZOOM_SCALE_LARGE : ZOOM_SCALE_SMALL);
    void newViewport.offsetWidth;
    newViewport.style.transition = transition;
    requestAnimationFrame(() => {
      newViewport.style.opacity = '1';
      newViewport.style.setProperty('--zoom-scale', 1);
    });

    zoomTimer = setTimeout(() => {
      zoomTimer = null;
      newViewport.style.transition = '';
      newViewport.style.opacity = '';
      newViewport.style.removeProperty('--zoom-scale');
      newViewport.style.transformOrigin = '';
    }, ZOOM_FADE_MS);
  }, ZOOM_FADE_MS);
}

// Points `viewport`'s transform-origin at the on-screen center of the element
// `focusSelector` matches inside it. Measured rather than computed from angles,
// so it's right wherever the ring's current rotation has put a hub pebble.
function setZoomOrigin(viewport, focusSelector) {
  const el = focusSelector && viewport.querySelector(focusSelector);
  if (!el) return;
  const box = viewport.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const x = ((rect.left + rect.width / 2 - box.left) / box.width) * 100;
  const y = ((rect.top + rect.height / 2 - box.top) / box.height) * 100;
  viewport.style.transformOrigin = `${x}% ${y}%`;
}

function build() {
  if (!container) return;
  if (currentLayer !== MAIN_LAYER) {
    buildLayerPlaceholder(LAYER_NAMES[currentLayer]);
    return;
  }
  const channel = zoomedChannelId ? channelById(zoomedChannelId) : null;
  if (channel) buildZoomed(channel);
  else buildHub();
}
