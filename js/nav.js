import { MENU, CHANNELS } from './channels.js?v=65';
import { isConfigured } from './sync.js?v=65';

// Menu is rendered separately from the channel row (see #top-nav-menu in
// index.html, to the right of the Settings gear) and isn't part of the
// arrow-key-cyclable strip at all — it's always reachable (click, or [M]
// from anywhere), but while it's actually open (activePath === MENU.route)
// the row itself renders empty: channels/subchannels are only reachable
// from the Menu page's own node tree then, not from this row (that page
// also owns a page-scoped Escape binding of its own, js/views/menu.js —
// nothing here listens for Escape, so there's nothing to guard against it).
//
// This row only ever shows the ONE channel the current page actually
// belongs to (derived straight from activePath, see currentChannel) plus
// that channel's own subchannels, flat — no dropdown, no cycling through
// other channels from here at all. Switching which *channel* you're in is
// Menu's job now (its own node tree, [M]); this row is purely "where am I,
// and what are this channel's other pages" — ArrowLeft/ArrowRight walk
// those subchannels directly, navigating immediately on each press, same
// as clicking one.
let mount = null;
let menuMount = null;
let activePath = '/';

function onMenuPage() {
  return activePath === MENU.route;
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

// The one channel activePath actually belongs to — either the channel's
// own route (Records/Public/Contacts) or one of its subchannels' routes.
// Null for anything else (Settings, a course detail page, Home) — the row
// renders empty then, same as while Menu is open.
function currentChannel() {
  return CHANNELS.find((c) => c.route === activePath || c.subchannels.some((s) => s.route === activePath)) || null;
}

function currentSubIndex(channel) {
  if (!channel) return -1;
  return channel.subchannels.findIndex((s) => s.route === activePath);
}

// ArrowLeft/ArrowRight — walks currentChannel's own subchannels (wrapping),
// navigating immediately, same shape the old dropdown's moveSub had, just
// without a dropdown to open/track first. First press with nothing
// currently matching a subchannel (e.g. a channel whose own route isn't
// also a subchannel's, mid-transition) lands on the first/last one in that
// direction rather than wrapping past a starting point.
function moveSub(delta) {
  const channel = currentChannel();
  if (!channel || !channel.subchannels.length) return;
  const n = channel.subchannels.length;
  const idx = currentSubIndex(channel);
  const next = idx === -1 ? (delta > 0 ? 0 : n - 1) : ((idx + delta) % n + n) % n;
  location.hash = '#' + channel.subchannels[next].route;
}

function goToPage(page) {
  location.hash = '#' + page.route;
}

function onKeyDown(e) {
  if (e.key === 'm' || e.key === 'M') {
    if (isBlocked(e)) return;
    e.preventDefault();
    goToPage(MENU);
    return;
  }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (isBlocked(e)) return;
  // Channels aren't shown (or reachable from here) while Menu is open —
  // see onMenuPage(). Left as a no-op (not even preventDefault) so menu.js's
  // own handling for the octagon constellation gets the keypress untouched.
  if (onMenuPage()) return;
  e.preventDefault();
  moveSub(e.key === 'ArrowLeft' ? -1 : 1);
}

function channelRowHtml() {
  const channel = currentChannel();
  if (!channel) return '';
  // An unconfigured device (see router.js's redirect) only ever reaches
  // Public/Settings — Public itself is safe to show (it has no
  // subchannels to leak anyway), but this guards against ever rendering
  // channel structure to a stranger if that redirect ever had a gap.
  if (!isConfigured() && channel.id !== 'public') return '';

  // Forward array order (first subchannel leftmost), same order
  // ArrowLeft/ArrowRight (moveSub) walk them in.
  const subsHtml = channel.subchannels.map((s) => {
    const classes = ['nav-subchannel', activePath === s.route ? 'active' : ''].filter(Boolean).join(' ');
    return `<a href="#${s.route}" class="${classes}">${s.label}</a>`;
  }).join('');

  // Always outlined (is-current — a border only, distinct from .active's
  // filled accent background) since currentChannel() only ever resolves to
  // this channel when activePath genuinely belongs to it (its own route or
  // one of its subchannels'): by the time this function has gotten this
  // far, it IS the current one, regardless of whether activePath happens
  // to equal its own route exactly — most channels (Academics, Schedule)
  // don't even have one of their own, only their subchannels do. A
  // separate class from .active on purpose: .active also lands on the
  // Today pill right next to it (Records' own route doubles as Today's),
  // and using the same filled style for both would read as the same
  // duplicate highlight that got fixed before — the outline instead marks
  // "this is the channel you're in" without competing with "this is the
  // exact page" on the subchannel beside it.
  const channelClasses = 'nav-channel is-current';
  const channelHtml = channel.route
    ? `<a href="#${channel.route}" class="${channelClasses}">${channel.label}</a>`
    : `<span class="${channelClasses}">${channel.label}</span>`;

  return `<div class="nav-channels">${subsHtml}${channelHtml}</div>`;
}

function render() {
  if (!mount) return;
  // Empty while Menu is open — channels are only reachable from the Menu
  // page's own octagon constellation then, not from this row.
  mount.innerHTML = onMenuPage() ? '' : channelRowHtml();
}

function renderMenuLink() {
  if (!menuMount) return;
  // Menu's octagon constellation just links out to the same channels this
  // row itself would hide from an unconfigured device — so the link itself
  // is hidden too rather than leading somewhere that would just show
  // nothing useful.
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
  window.addEventListener('keydown', onKeyDown);
  render();
  renderMenuLink();
}

// Called by the router after every navigation so this row always reflects
// whatever page is actually on screen.
export function syncActiveRoute(path) {
  activePath = '/' + (path.split('/')[1] || '');
  renderMenuLink();
  render();
}
