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
// content of their own" — Records and Public each ARE a page (Records
// doubles as the existing Logging page; Public is its own stub) rather than
// just a placeholder for subchannels. nav.js treats any channel with a
// `route` as directly navigable (like a hub) instead of dropdown-only.
export const CHANNELS = [
  {
    id: 'records',
    label: 'Records',
    route: '/logging',
    subchannels: [],
  },
  {
    id: 'academics',
    label: 'Academics',
    subchannels: [
      { id: 'courses', label: 'Courses', route: '/courses' },
      { id: 'lessons', label: 'Lessons', route: '/lessons' },
    ],
  },
  {
    id: 'schedule',
    label: 'Schedule',
    subchannels: [
      { id: 'today', label: 'Today', route: '/today' },
      { id: 'calendar', label: 'Calendar', route: '/calendar' },
      { id: 'canvas', label: 'Canvas', route: '/canvas' },
    ],
  },
  {
    id: 'application',
    label: 'Application',
    subchannels: [
      { id: 'roadmap', label: 'Roadmap', route: '/roadmap' },
    ],
  },
  {
    id: 'public',
    label: 'Public',
    route: '/public',
    subchannels: [],
  },
  {
    id: 'resources',
    label: 'Resources',
    subchannels: [],
  },
  {
    id: 'practice',
    label: 'Practice',
    subchannels: [],
  },
  {
    id: 'contacts',
    label: 'Contacts',
    subchannels: [],
  },
];
