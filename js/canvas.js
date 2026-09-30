import { store } from './store.js?v=14';

const CACHE_KEY = 'dietz:canvasCache';

function getConfig() {
  const settings = store.table('Settings');
  const url = settings.find((s) => s.key === 'appsScriptUrl')?.value;
  const token = settings.find((s) => s.key === 'appsScriptToken')?.value;
  return url && token ? { url, token } : null;
}

export function getCachedCanvasEvents() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function setCachedCanvasEvents(events) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(events));
  } catch (e) {
    // ignore — cache is a convenience only
  }
}

export async function fetchCanvasEvents() {
  const config = getConfig();
  if (!config) return { events: [], error: 'Apps Script not configured (see Settings)' };

  const res = await fetch(`${config.url}?action=canvas-events&token=${encodeURIComponent(config.token)}`);
  const data = await res.json();
  if (data.error) return { events: [], error: data.error };
  setCachedCanvasEvents(data.events || []);
  return { events: data.events || [], error: null };
}

// Cross-page handoff, since navigating between #/canvas and #/calendar
// unmounts one view's module state entirely. Both views import this same
// module instance to pass a "pending" item across that boundary.
let pendingSchedule = null; // { name, course, deadline } | null
let pendingHighlightName = null; // string | null — Canvas item to flash on return
let pendingCalendarHighlightName = null; // string | null — task to flash on the Calendar tab

export function setPendingSchedule(item) {
  pendingSchedule = item;
}

export function takePendingSchedule() {
  const item = pendingSchedule;
  pendingSchedule = null;
  return item;
}

export function setPendingHighlight(name) {
  pendingHighlightName = name;
}

export function takePendingHighlight() {
  const name = pendingHighlightName;
  pendingHighlightName = null;
  return name;
}

// Clicking an already-linked Canvas card jumps to its existing Calendar
// task instead of letting you create a duplicate — see canvas.js's click
// handler and calendar.js's applyPendingCalendarHighlight.
export function setPendingCalendarHighlight(name) {
  pendingCalendarHighlightName = name;
}

export function takePendingCalendarHighlight() {
  const name = pendingCalendarHighlightName;
  pendingCalendarHighlightName = null;
  return name;
}
