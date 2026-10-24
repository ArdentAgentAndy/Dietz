import { MENU, CHANNELS } from './channels.js?v=64';
import { isConfigured } from './sync.js?v=64';

// Menu is rendered separately from the channels row (see #top-nav-menu in
// index.html, to the right of the Settings gear) and isn't part of the
// arrow-key-cyclable strip at all — it's always reachable (click, or [M]
// from anywhere), but while it's actually open (activePath === MENU.route)
// the channels row itself renders empty and ArrowLeft/Right/Up/Down/Enter
// are no-ops: channels are only reachable from the Menu page's own node
// tree while Menu is open, never from this row (that page also owns a
// page-scoped Escape binding of its own, js/views/menu.js — nothing here
// listens for Escape, so there's nothing to guard against it). highlightIndex is
// a plain index into CHANNELS. A click, or ArrowLeft/ArrowRight landing on
// a channel, opens its dropdown whenever it has subchannels to show
// (ArrowUp/ArrowDown, moveSub below, is what then walks that dropdown) —
// that's true even for a channel that also carries its own `route`
// (Records, see channels.js): its default page is just the dropdown's own
// first item, not a click-through shortcut that would otherwise make the
// dropdown unreachable by mouse entirely. Only a channel with a `route` and
// no subchannels at all (Public/Contacts) skips the dropdown and navigates
// immediately, since there'd be nothing in it to show. The dropdown
// auto-closes after a few seconds of inactivity, or immediately on a click
// outside it.
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

// An unconfigured device (a stranger who's never entered the Apps
// Script URL/token — see router.js's redirect) can only ever reach
// Public, so every other channel name/page would just be a dead end
// that still leaks the app's structure to them. Shown channels (and the
// Menu link, see renderMenuLink) collapse to just Public until that
// changes.
function visibleChannels() {
  return isConfigured() ? CHANNELS : CHANNELS.filter((c) => c.id === 'public');
}

function currentChannel() {
  return visibleChannels()[highlightIndex];
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
  const n = visibleChannels().length;
  highlightIndex = ((highlightIndex + delta) % n + n) % n;
  // A channel that carries its own route but has no subchannels of its own
  // to show (Public/Contacts — the exception to "channels have no
  // content", see channels.js) navigates immediately instead of leaving the
  // highlighter sitting there showing nothing. A channel with subchannels
  // always opens its dropdown instead, even if it also carries a route
  // (Records) — otherwise that dropdown would never be reachable by mouse
  // at all (click goes through the exact same check, see onClick below),
  // only ever by the separate ArrowUp/ArrowDown handling in moveSub.
  const ch = currentChannel();
  if (ch?.route && !ch.subchannels.length) {
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
  // route-carrying channel with no subchannels of its own (Public/Contacts)
  // doesn't need Enter at all — moveChannel already navigates to it
  // immediately on arrow-key press. One that does have subchannels
  // (Records) can still use Enter the normal way, to confirm whichever
  // subchannel ArrowUp/ArrowDown last highlighted in its dropdown.
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
// unless the channel carries its own route AND has no subchannels of its
// own to show (Public/Contacts), in which case it navigates immediately
// instead. A channel with subchannels always opens the dropdown on click,
// even if it also carries a route (Records, defaulting to Today) — that
// default route is still just as reachable, as the dropdown's own first
// item, one click further in; the alternative (clicking the channel button
// itself always skipping straight past the dropdown) left that dropdown
// completely unreachable by mouse. Clicking a subchannel inside the
// dropdown navigates explicitly via location.hash (see below) rather than
// relying on the link's own native click behavior — closeDropdown()
// re-renders mount's innerHTML synchronously, which detaches the clicked
// <a> from the document before the browser gets to the link's default
// action, silently swallowing the navigation. Menu's own click handling
// lives in onMenuClick below — it's a separate DOM subtree now, not part
// of this row.
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
    const channels = visibleChannels();
    const idx = channels.findIndex((c) => c.id === channelBtn.dataset.channel);
    if (idx !== -1) {
      highlightIndex = idx;
      const ch = channels[idx];
      if (ch.route && !ch.subchannels.length) goToPage(ch);
      else { openDropdown(); render(); }
    }
    return;
  }

  const subLink = e.target.closest('.nav-subchannel');
  if (subLink) {
    e.preventDefault();
    const href = subLink.getAttribute('href');
    closeDropdown();
    if (href) location.hash = href;
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
  const channelsHtml = visibleChannels().map((c, i) => {
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
  // Menu's octagon constellation just links out to the same channels
  // visibleChannels() already hides from an unconfigured device — so the
  // link itself is hidden too rather than leading somewhere that would
  // just show nothing useful.
  if (!isConfigured()) {
    menuMount.innerHTML = '';
    return;
  }
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

  const channels = visibleChannels();
  const channelIndex = channels.findIndex((c) => c.route === activePath || c.subchannels.some((s) => s.route === activePath));
  if (channelIndex !== -1) {
    highlightIndex = channelIndex;
    const ch = channels[channelIndex];
    const subIndex = ch.subchannels.findIndex((s) => s.route === activePath);
    if (subIndex !== -1) subHighlightByChannelId.set(ch.id, subIndex);
  }

  render();
}
