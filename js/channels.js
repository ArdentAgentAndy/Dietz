// Top-nav structure: Menu (rendered to the right of the Settings gear, see
// index.html's #top-nav-menu — always reachable, never part of the
// arrow-key-cyclable channel row) plus the channels below, each holding
// subchannels (the actual pages). Channels themselves carry no
// route/content of their own — see nav.js, which renders this into the
// header and does all the channel/subchannel keyboard+mouse navigation,
// and hides the whole channel row while Menu itself is open (channels are
// then only reachable from Menu's own node-tree page).
// Home is temporary and deliberately not a top-nav item at all — only
// reachable via the central node (keybind H) on the Menu page
// (js/views/menu.js). Its route constant stays here so that page (and
// router.js) have one shared place to read it from.
export const HOME = { id: 'home', label: 'Home', route: '/home', pos: { x: 500, y: 500 } };
export const MENU = { id: 'menu', label: 'Menu', route: '/' };

// Array order still matters beyond the top nav: it's what Left/Right
// cycling and the number-key shortcuts (js/views/menu.js's moveSelection/
// selectByNumber) walk — purely by index, same as before. It is NOT what
// positions anything on screen anymore (see `pos` below) — the two are
// independent on purpose, so reordering this array (to change keyboard
// cycling order) never has to touch anyone's hand-placed coordinates, and
// vice versa.
//
// A channel's own `route` is the one exception to "channels carry no
// content of their own" — Records, Public, and Contacts each ARE a page
// rather than just a placeholder for subchannels. nav.js treats any channel
// with a `route` as directly navigable (like a hub): a click or Left/Right
// arrow jumps straight to that route. A route-carrying channel can still
// have subchannels of its own (Records does: Today/Logging) — Up/Down arrow
// still opens/walks that dropdown exactly like it does for a channel with no
// route of its own (Academics/Schedule), since nav.js's dropdown logic never
// actually checks for a `route` — only the direct click/Left-Right jump does.
//
// `pos: {x, y}` is a hand-authored position on a fixed 0-1000 logical
// square — js/views/menu.js draws this 1:1 against an SVG viewBox of the
// same size (pos.x is literally the line's x-coordinate; divided by 10,
// it's also the node's CSS left%). This replaces the old version's
// angle-from-index trig entirely: nothing about layout is computed anymore,
// it's just edited here, same "hand-edit an array, no build step" spirit as
// the rest of this file. Keep new nodes roughly within 60-940 on each axis
// so they don't crowd the stage's edge.
//
// icon: a single emoji shown large/translucent inside a channel's node on
// the Menu page (js/views/menu.js's nodesHtml) — purely decorative
// (aria-hidden there), so it carries no meaning the label itself doesn't
// already.
export const CHANNELS = [
  {
    id: 'contacts',
    label: 'Contacts',
    icon: '👥',
    route: '/contacts',
    pos: { x: 500, y: 240 },
    subchannels: [],
  },
  {
    id: 'academics',
    label: 'Academics',
    icon: '🎓',
    pos: { x: 740, y: 260 },
    subchannels: [
      { id: 'courses', label: 'Courses', route: '/courses', pos: { x: 910, y: 150 } },
      { id: 'lessons', label: 'Lessons', route: '/lessons', pos: { x: 940, y: 260 } },
      { id: 'revision', label: 'Revision', route: '/revision', pos: { x: 900, y: 370 } },
    ],
  },
  {
    id: 'schedule',
    label: 'Schedule',
    icon: '📅',
    pos: { x: 800, y: 500 },
    subchannels: [
      { id: 'calendar', label: 'Calendar', route: '/calendar', pos: { x: 940, y: 420 } },
      { id: 'canvas', label: 'Canvas', route: '/canvas', pos: { x: 940, y: 580 } },
    ],
  },
  {
    id: 'application',
    label: 'Application',
    icon: '🚀',
    pos: { x: 677, y: 677 },
    subchannels: [
      { id: 'roadmap', label: 'Roadmap', route: '/roadmap', pos: { x: 800, y: 800 } },
    ],
  },
  {
    id: 'public',
    label: 'Public',
    icon: '🌐',
    route: '/public',
    pos: { x: 500, y: 760 },
    subchannels: [],
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: '📚',
    pos: { x: 323, y: 677 },
    subchannels: [],
  },
  {
    id: 'practice',
    label: 'Practice',
    icon: '🎹',
    pos: { x: 200, y: 500 },
    subchannels: [
      { id: 'sight-reading', label: 'Sight Reading', route: '/sight-reading', pos: { x: 55, y: 560 } },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    icon: '🗂️',
    route: '/today',
    // Mirrors Academics (pos.x = 1000 - Academics' 740) across the tree's
    // vertical center line, same idea the old subchannelSlots trick aimed
    // for (Records visually matching Academics) but now just literal,
    // visible coordinates instead of an index into a shared slot table —
    // see Today/Logging below, mirrored against Academics' own top two
    // subchannels (Courses/Lessons) the same way.
    pos: { x: 260, y: 260 },
    subchannels: [
      { id: 'today', label: 'Today', route: '/today', pos: { x: 90, y: 150 } },
      { id: 'logging', label: 'Logging', route: '/logging', pos: { x: 60, y: 260 } },
    ],
  },
];
