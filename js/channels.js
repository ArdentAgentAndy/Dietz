// Top-nav structure: Menu (rendered to the right of the Settings gear, see
// index.html's #top-nav-menu — always reachable, never part of the
// arrow-key-cyclable channel row) plus the channels below, each holding
// subchannels (the actual pages). Channels themselves carry no
// route/content of their own — see nav.js, which renders this into the
// header and does all the channel/subchannel keyboard+mouse navigation,
// and hides the whole channel row while Menu itself is open (channels are
// then only reachable from Menu's own octagon constellation).
// Home is temporary and deliberately not a top-nav item at all — only
// reachable via the octagon button (keybind H) on the Menu page
// (js/views/menu.js). Its route constant stays here so that page (and
// router.js) have one shared place to read it from.
export const HOME = { id: 'home', label: 'Home', route: '/home' };
export const MENU = { id: 'menu', label: 'Menu', route: '/' };

// Order matters beyond just the top nav: Menu's octagon constellation
// (js/views/menu.js) places CHANNELS[0] at the top and walks the rest
// clockwise, one per 45°, in this same array order.
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
// icon: a single emoji shown large/translucent inside the channel's circle
// on the Menu page's constellation (js/views/menu.js's circlesHtml) —
// purely decorative (aria-hidden there), so it carries no meaning the
// label itself doesn't already.
export const CHANNELS = [
  {
    id: 'contacts',
    label: 'Contacts',
    icon: '👥',
    route: '/contacts',
    subchannels: [],
  },
  {
    id: 'academics',
    label: 'Academics',
    icon: '🎓',
    subchannels: [
      { id: 'courses', label: 'Courses', route: '/courses' },
      { id: 'lessons', label: 'Lessons', route: '/lessons' },
      { id: 'revision', label: 'Revision', route: '/revision' },
    ],
    // Which of the menu page's 3 standard diagonal slots (top/middle/bottom
    // — see js/views/menu.js's CANONICAL_SLOT_OFFSETS) each subchannel
    // above renders in, by index into *this* array: courses (index 0) in
    // slot 2 (bottom), lessons (index 1) in slot 1 (middle, unchanged),
    // revision (index 2) in slot 0 (top) — a deliberate swap, not the
    // default top-to-bottom-by-array-order placement every other channel
    // uses. The array/label order above (and the 1/2/3 keyboard shortcuts
    // that follow it) is untouched; only the on-screen position moves.
    subchannelSlots: [2, 1, 0],
  },
  {
    id: 'schedule',
    label: 'Schedule',
    icon: '📅',
    subchannels: [
      { id: 'calendar', label: 'Calendar', route: '/calendar' },
      { id: 'canvas', label: 'Canvas', route: '/canvas' },
    ],
  },
  {
    id: 'application',
    label: 'Application',
    icon: '🚀',
    subchannels: [
      { id: 'roadmap', label: 'Roadmap', route: '/roadmap' },
    ],
  },
  {
    id: 'public',
    label: 'Public',
    icon: '🌐',
    route: '/public',
    subchannels: [],
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: '📚',
    subchannels: [],
  },
  {
    id: 'practice',
    label: 'Practice',
    icon: '🎹',
    subchannels: [
      { id: 'sight-reading', label: 'Sight Reading', route: '/sight-reading' },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    icon: '🗂️',
    route: '/today',
    subchannels: [
      { id: 'today', label: 'Today', route: '/today' },
      { id: 'logging', label: 'Logging', route: '/logging' },
    ],
    // Records (135deg) and Academics (225deg) are mirror images of each
    // other across the vertical axis — same distance from center, same
    // resulting row heights — so pinning Records to Academics' top two
    // slots (0, 1 — see that channel's own subchannelSlots) makes the two
    // sides of the menu page symmetrical: today/logging sit at exactly the
    // same two heights as revision/lessons do on the other side.
    subchannelSlots: [0, 1],
  },
];
