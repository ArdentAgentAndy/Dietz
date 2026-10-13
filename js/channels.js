// Top-nav structure: a "Menu" hub (route '/', keybind M) plus the channels
// below, each holding subchannels (the actual pages). Channels themselves
// carry no route/content of their own — see nav.js, which renders this into
// the header and does all the channel/subchannel keyboard+mouse navigation.
export const MENU = { id: 'menu', label: 'Menu', route: '/' };

export const CHANNELS = [
  {
    id: 'records',
    label: 'Records',
    subchannels: [
      { id: 'logging', label: 'Logging', route: '/logging' },
    ],
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
    id: 'practice',
    label: 'Practice',
    subchannels: [],
  },
  {
    id: 'placeholder1',
    label: 'Placeholder 1',
    subchannels: [],
  },
  {
    id: 'placeholder2',
    label: 'Placeholder 2',
    subchannels: [],
  },
  {
    id: 'placeholder3',
    label: 'Placeholder 3',
    subchannels: [],
  },
];

// Flat lookup from a route's top-level path segment (e.g. '/courses') to the
// channel that owns it — used to sync the nav's highlighted channel/
// subchannel with whatever page is actually on screen.
export function channelForRoute(path) {
  const top = '/' + (path.split('/')[1] || '');
  return CHANNELS.find((c) => c.subchannels.some((s) => s.route === top)) || null;
}

export function subchannelForRoute(path) {
  const top = '/' + (path.split('/')[1] || '');
  for (const c of CHANNELS) {
    const sub = c.subchannels.find((s) => s.route === top);
    if (sub) return sub;
  }
  return null;
}
