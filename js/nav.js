import { MENU, CHANNELS } from './channels.js?v=56';

// Row 1 ("channels") is Menu + CHANNELS, one continuous strip:
// ArrowLeft/ArrowRight always move across this strip. highlightIndex 0 is
// Menu; index i+1 is CHANNELS[i]. Landing on a channel only highlights it
// and reveals its dropdown — channels carry no content of their own, so
// ArrowUp/ArrowDown (move within row 2) or a click is what actually
// navigates to one of its subchannels. Menu is different: it's a page in
// its own right, not a placeholder, so arrowing onto it navigates straight
// there (see moveChannel) — same as the explicit [M] shortcut (goToMenu).
// The dropdown auto-closes after a few seconds of inactivity, or
// immediately on a click outside it.
const DROPDOWN_TIMEOUT_MS = 4000;

let mount = null;
let highlightIndex = 0;
let activePath = '/';
let dropdownOpen = false;
let dismissTimerId = null;
// channelId -> last-visited (or arrowed-to) subchannel index. Absent means
// "never visited this session" — see moveSub, which lands on the first/last
// subchannel on that first press instead of wrapping past it.
const subHighlightByChannelId = new Map();

function currentChannel() {
  return highlightIndex === 0 ? null : CHANNELS[highlightIndex - 1];
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

// No-op (and no re-render) for a channel with nothing to show — Menu, or a
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
  const n = CHANNELS.length + 1; // + Menu
  highlightIndex = ((highlightIndex + delta) % n + n) % n;
  // Menu isn't a channel — it has no subchannel dropdown to reveal, it's a
  // page in its own right, so arrowing onto it navigates immediately
  // instead of leaving the highlighter sitting there showing nothing.
  if (highlightIndex === 0) {
    goToMenu();
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

function goToMenu() {
  closeDropdown();
  location.hash = '#' + MENU.route;
}

function onKeyDown(e) {
  if (e.key === 'm' || e.key === 'M') {
    if (isBlocked(e)) return;
    e.preventDefault();
    goToMenu();
    return;
  }

  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) return;
  if (isBlocked(e)) return;
  e.preventDefault();

  if (e.key === 'ArrowLeft') moveChannel(-1);
  else if (e.key === 'ArrowRight') moveChannel(1);
  else if (e.key === 'ArrowUp') moveSub(-1);
  else if (e.key === 'ArrowDown') moveSub(1);
  else if (e.key === 'Enter') {
    if (highlightIndex === 0) goToMenu();
    else confirmSub();
  }
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

// Clicking the Menu link navigates (see the data-menu branch below).
// Clicking a channel button only moves the highlighter and opens its
// dropdown — it never navigates, since channels carry no content. Clicking
// a subchannel inside the dropdown closes it (its own href handles the
// actual navigation).
function onClick(e) {
  // Stops here so onDocumentClick never sees this event — necessary, not
  // just tidy: a channel click calls render() synchronously below, which
  // replaces mount's children and detaches e.target from the document, so
  // by the time the event would otherwise reach onDocumentClick,
  // mount.contains(e.target) wrongly reads false and immediately undoes
  // the openDropdown() this same click just triggered.
  e.stopPropagation();

  // Driven explicitly, same as every other nav item, rather than left to
  // the browser's native anchor-click default action — the Menu link is the
  // only nav item that still had content inside #top-nav's own DOM subtree
  // rely on that default action, and it proved unreliable once this click
  // handler started doing synchronous DOM work (render()) on ancestors of
  // the clicked element during the same click.
  if (e.target.closest('[data-menu]')) {
    e.preventDefault();
    goToMenu();
    return;
  }

  const channelBtn = e.target.closest('[data-channel]');
  if (channelBtn) {
    const idx = CHANNELS.findIndex((c) => c.id === channelBtn.dataset.channel);
    if (idx !== -1) {
      highlightIndex = idx + 1;
      openDropdown();
      render();
    }
    return;
  }

  if (e.target.closest('.nav-subchannel')) {
    closeDropdown();
    return;
  }
}

function onDocumentClick(e) {
  if (!dropdownOpen) return;
  if (mount?.contains(e.target)) return;
  closeDropdown();
}

function channelRowHtml() {
  const menuClasses = ['nav-channel', highlightIndex === 0 ? 'is-current' : '', activePath === MENU.route ? 'active' : ''].filter(Boolean).join(' ');
  const channelsHtml = CHANNELS.map((c, i) => {
    const isHighlighted = highlightIndex === i + 1;
    const classes = ['nav-channel', isHighlighted ? 'is-current' : ''].filter(Boolean).join(' ');
    const dropdown = isHighlighted && dropdownOpen ? dropdownHtml(c) : '';
    return `
      <div class="nav-channel-wrap">
        <button type="button" class="${classes}" data-channel="${c.id}">${c.label}</button>
        ${dropdown}
      </div>
    `;
  }).join('');
  return `
    <div class="nav-channels">
      <a href="#${MENU.route}" data-menu class="${menuClasses}">${MENU.label}</a>
      ${channelsHtml}
    </div>
  `;
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
  mount.innerHTML = channelRowHtml();
}

export function initNav(mountEl) {
  mount = mountEl;
  mount.addEventListener('click', onClick);
  // Capture phase, not bubble — a few page elements elsewhere (e.g. a
  // card's manage-pencil button) call stopPropagation() on their own click,
  // which would otherwise stop this from ever seeing those clicks. Capture
  // runs top-down before any of that, so it always sees the click first.
  document.addEventListener('click', onDocumentClick, true);
  window.addEventListener('keydown', onKeyDown);
  render();
}

// Called by the router after every navigation so the nav's highlighted
// channel/subchannel always reflects whatever page is actually on screen —
// a route not owned by any channel (e.g. a course detail page, or Settings'
// gear icon) leaves the highlight wherever it already was. Doesn't touch
// dropdownOpen — a route change from outside the nav itself (a link on the
// page, a direct URL) shouldn't pop a dropdown open on its own.
export function syncActiveRoute(path) {
  activePath = '/' + (path.split('/')[1] || '');

  if (activePath === MENU.route) {
    highlightIndex = 0;
    render();
    return;
  }

  const channelIndex = CHANNELS.findIndex((c) => c.subchannels.some((s) => s.route === activePath));
  if (channelIndex !== -1) {
    highlightIndex = channelIndex + 1;
    const ch = CHANNELS[channelIndex];
    const subIndex = ch.subchannels.findIndex((s) => s.route === activePath);
    subHighlightByChannelId.set(ch.id, subIndex);
  }

  render();
}
