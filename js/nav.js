import { MENU, CHANNELS } from './channels.js?v=59';

// Menu is rendered separately from the channels row (see #top-nav-menu in
// index.html, to the right of the Settings gear) and isn't part of the
// arrow-key-cyclable strip at all — it's always reachable (click, or [M]
// from anywhere), but while it's actually open (activePath === MENU.route)
// the channels row itself renders empty and ArrowLeft/Right/Up/Down/Enter
// are no-ops: channels are only reachable from the Menu page's own octagon
// constellation while Menu is open, never from this row. highlightIndex is
// a plain index into CHANNELS. Landing on a channel only highlights it and
// reveals its dropdown — channels carry no content of their own, so
// ArrowUp/ArrowDown (move within row 2) or a click is what actually
// navigates to one of its subchannels — except a channel that itself
// carries a `route` (Records/Public, see channels.js), which navigates
// immediately instead, same as Menu does. The dropdown auto-closes after a
// few seconds of inactivity, or immediately on a click outside it.
const DROPDOWN_TIMEOUT_MS = 4000;

let mount = null;
let menuMount = null;
let highlightIndex = 0;
let activePath = '/';
let dropdownOpen = false;
let dismissTimerId = null;
// channelId -> last-visited (or arrowed-to) subchannel index. Absent means
// "never visited this session" — see moveSub, which lands on the first/last
// subchannel on that first press instead of wrapping past it.
const subHighlightByChannelId = new Map();

function onMenuPage() {
  return activePath === MENU.route;
}

function currentChannel() {
  return CHANNELS[highlightIndex];
}

function isTypingTarget() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function isBlocked(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  if (isTypingTarget()) return true;
  if (document.querySelector('dialog[open]')) return true;
  return false;
}

function scheduleAutoDismiss() {
  clearTimeout(dismissTimerId);
  dismissTimerId = setTimeout(closeDropdown, DROPDOWN_TIMEOUT_MS);
}

// No-op (and no re-render) for a channel with nothing to show — a
// not-yet-populated channel like Practice/Placeholder — so a popup never
// flashes open just to display an empty dash.
function openDropdown() {
  const ch = currentChannel();
  if (!ch || !ch.subchannels.length) return;
  dropdownOpen = true;
  render();
  scheduleAutoDismiss();
}

function closeDropdown() {
  clearTimeout(dismissTimerId);
  dismissTimerId = null;
  if (!dropdownOpen) return;
  dropdownOpen = false;
  render();
}

function moveChannel(delta) {
  const n = CHANNELS.length;
  highlightIndex = ((highlightIndex + delta) % n + n) % n;
  // A channel that carries its own route (Records/Public — the exception
  // to "channels have no content", see channels.js) navigates immediately
  // instead of leaving the highlighter sitting there showing nothing.
  const ch = currentChannel();
  if (ch?.route) {
    goToPage(ch);
    return;
  }
  openDropdown();
  render();
}

function moveSub(delta) {
  const ch = currentChannel();
  if (!ch || !ch.subchannels.length) return;
  const n = ch.subchannels.length;
  let next;
  if (subHighlightByChannelId.has(ch.id)) {
    next = ((subHighlightByChannelId.get(ch.id) + delta) % n + n) % n;
  } else {
    next = delta > 0 ? 0 : n - 1;
  }
  subHighlightByChannelId.set(ch.id, next);
  openDropdown();
  location.hash = '#' + ch.subchannels[next].route;
}

// Takes any {route} object — Menu, or a channel that carries its own route
// (Records/Public).
function goToPage(page) {
  closeDropdown();
  location.hash = '#' + page.route;
}

function onKeyDown(e) {
  if (e.key === 'm' || e.key === 'M') {
    if (isBlocked(e)) return;
    e.preventDefault();
    goToPage(MENU);
    return;
  }

  const digit = Number(e.key);
  const isDigit = e.key.length === 1 && Number.isInteger(digit) && digit >= 1 && digit <= 9;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key) && !isDigit) return;
  if (isBlocked(e)) return;
  // Channels aren't shown (or reachable from here) while Menu is open —
  // see onMenuPage(). Left as a no-op (not even preventDefault) so menu.js's
  // own handling for the octagon constellation (including its own digit
  // keys) gets the keypress untouched.
  if (onMenuPage()) return;
  // Enter only ever confirms a subchannel the dropdown is already showing
  // (opened by Left/Right/Up/Down — see moveChannel/moveSub, both of which
  // call openDropdown()). With no dropdown open there's nothing to confirm:
  // highlightIndex/activePath track whatever page is currently on screen
  // (see syncActiveRoute), not just deliberate keyboard navigation, so
  // without this guard pressing Enter for an unrelated reason anywhere in
  // the app (submitting a form, confirming a dialog) was also hijacked into
  // a same-page "confirm" that flashed this row's dropdown open. A
  // route-carrying channel (Records/Public) doesn't need Enter at all —
  // moveChannel already navigates to it immediately on arrow-key press.
  if (e.key === 'Enter' && !dropdownOpen) return;
  e.preventDefault();

  if (e.key === 'ArrowLeft') moveChannel(-1);
  else if (e.key === 'ArrowRight') moveChannel(1);
  else if (e.key === 'ArrowUp') moveSub(-1);
  else if (e.key === 'ArrowDown') moveSub(1);
  else if (e.key === 'Enter') confirmSub();
  else if (isDigit) selectByNumber(digit);
}

// Enter on a channel — goes to whichever subchannel is already highlighted
// (remembered from a prior visit this session), defaulting to the first one
// if this channel has never been visited.
function confirmSub() {
  const ch = currentChannel();
  if (!ch || !ch.subchannels.length) return;
  const idx = subHighlightByChannelId.has(ch.id) ? subHighlightByChannelId.get(ch.id) : 0;
  subHighlightByChannelId.set(ch.id, idx);
  openDropdown();
  location.hash = '#' + ch.subchannels[idx].route;
}

// Same number-key convention as the Menu page's octagon constellation
// (js/views/menu.js) — 1, 2, 3... in list order, only ever picking among
// the currently highlighted channel's subchannels (ArrowLeft/Right is the
// only way to move between channels themselves). Navigates immediately,
// same as ArrowUp/ArrowDown — no Enter needed here, unlike the Menu page.
function selectByNumber(n) {
  const ch = currentChannel();
  if (!ch || n > ch.subchannels.length) return;
  const idx = n - 1;
  subHighlightByChannelId.set(ch.id, idx);
  openDropdown();
  location.hash = '#' + ch.subchannels[idx].route;
}

// Clicking a channel button moves the highlighter and opens its dropdown —
// unless the channel carries its own route (Records/Public), in which case
// it navigates immediately instead. Clicking a subchannel inside the
// dropdown closes it (its own href handles the actual navigation). Menu's
// own click handling lives in onMenuClick below — it's a separate DOM
// subtree now, not part of this row.
function onClick(e) {
  // Stops here so onDocumentClick never sees this event — necessary, not
  // just tidy: a channel click calls render() synchronously below, which
  // replaces mount's children and detaches e.target from the document, so
  // by the time the event would otherwise reach onDocumentClick,
  // mount.contains(e.target) wrongly reads false and immediately undoes
  // the openDropdown() this same click just triggered.
  e.stopPropagation();

  const channelBtn = e.target.closest('[data-channel]');
  if (channelBtn) {
    const idx = CHANNELS.findIndex((c) => c.id === channelBtn.dataset.channel);
    if (idx !== -1) {
      highlightIndex = idx;
      const ch = CHANNELS[idx];
      if (ch.route) goToPage(ch);
      else { openDropdown(); render(); }
    }
    return;
  }

  if (e.target.closest('.nav-subchannel')) {
    closeDropdown();
    return;
  }
}

// Driven explicitly, same reliability reasoning as every other nav item —
// relying on the native anchor-click default action proved fragile once
// click handlers elsewhere started doing synchronous DOM work.
function onMenuClick(e) {
  e.preventDefault();
  goToPage(MENU);
}

function onDocumentClick(e) {
  if (!dropdownOpen) return;
  if (mount?.contains(e.target)) return;
  closeDropdown();
}

function channelRowHtml() {
  const channelsHtml = CHANNELS.map((c, i) => {
    const isHighlighted = highlightIndex === i;
    const classes = ['nav-channel', isHighlighted ? 'is-current' : '', c.route && activePath === c.route ? 'active' : ''].filter(Boolean).join(' ');
    const dropdown = isHighlighted && dropdownOpen ? dropdownHtml(c) : '';
    return `
      <div class="nav-channel-wrap">
        <button type="button" class="${classes}" data-channel="${c.id}">${c.label}</button>
        ${dropdown}
      </div>
    `;
  }).join('');
  return `<div class="nav-channels">${channelsHtml}</div>`;
}

function dropdownHtml(channel) {
  const pendingIdx = subHighlightByChannelId.get(channel.id);
  const items = channel.subchannels.map((s, i) => {
    const classes = ['nav-subchannel', activePath === s.route ? 'active' : '', pendingIdx === i ? 'is-current' : ''].filter(Boolean).join(' ');
    return `<a href="#${s.route}" class="${classes}">${s.label}</a>`;
  }).join('');
  return `<div class="nav-dropdown">${items}</div>`;
}

function render() {
  if (!mount) return;
  // Empty while Menu is open — channels are only reachable from the Menu
  // page's own octagon constellation then, not from this row.
  mount.innerHTML = onMenuPage() ? '' : channelRowHtml();
}

function renderMenuLink() {
  if (!menuMount) return;
  const classes = ['nav-channel', onMenuPage() ? 'active' : ''].filter(Boolean).join(' ');
  menuMount.innerHTML = `<a href="#${MENU.route}" class="${classes}">${MENU.label}</a>`;
}

export function initNav(mountEl, menuMountEl) {
  mount = mountEl;
  menuMount = menuMountEl;
  mount.addEventListener('click', onClick);
  menuMount.addEventListener('click', onMenuClick);
  // Capture phase, not bubble — a few page elements elsewhere (e.g. a
  // card's manage-pencil button) call stopPropagation() on their own click,
  // which would otherwise stop this from ever seeing those clicks. Capture
  // runs top-down before any of that, so it always sees the click first.
  document.addEventListener('click', onDocumentClick, true);
  window.addEventListener('keydown', onKeyDown);
  render();
  renderMenuLink();
}

// Called by the router after every navigation so the nav's highlighted
// channel/subchannel always reflects whatever page is actually on screen —
// a route not owned by any channel (e.g. a course detail page, or
// Settings' gear icon) leaves the highlight wherever it already was.
// Doesn't touch dropdownOpen — a route change from outside the nav itself
// (a link on the page, a direct URL) shouldn't pop a dropdown open on its
// own.
export function syncActiveRoute(path) {
  activePath = '/' + (path.split('/')[1] || '');
  renderMenuLink();

  if (onMenuPage()) {
    render();
    return;
  }

  const channelIndex = CHANNELS.findIndex((c) => c.route === activePath || c.subchannels.some((s) => s.route === activePath));
  if (channelIndex !== -1) {
    highlightIndex = channelIndex;
    const ch = CHANNELS[channelIndex];
    const subIndex = ch.subchannels.findIndex((s) => s.route === activePath);
    if (subIndex !== -1) subHighlightByChannelId.set(ch.id, subIndex);
  }

  render();
}
