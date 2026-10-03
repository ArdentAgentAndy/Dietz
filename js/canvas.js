import { store } from './store.js?v=28';

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

// Complete/urgent flags for Canvas events the user has marked WITHOUT
// linking them to a Notion task. Kept purely client-side (this device only,
// never pushed to Notion/Calendar) since there's no backing task to store
// them on. Only ever written via setLocalCanvasFlag on Save/Enter — see
// js/views/canvas.js's toggleHighlight/saveHighlight, which stage these the
// same way `pending` stages linked-task changes so Escape can discard an
// unsaved mark instead of it having already landed in localStorage.
const LOCAL_FLAGS_KEY = 'dietz:canvasLocalFlags';

function getAllLocalCanvasFlags() {
  try {
    const raw = localStorage.getItem(LOCAL_FLAGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function setAllLocalCanvasFlags(flags) {
  try {
    localStorage.setItem(LOCAL_FLAGS_KEY, JSON.stringify(flags));
  } catch (e) {
    // ignore — local-only flags are a convenience, not critical data
  }
}

export function getLocalCanvasFlag(eventId, field) {
  return Boolean(getAllLocalCanvasFlags()[eventId]?.[field]);
}

export function setLocalCanvasFlag(eventId, field, value) {
  const flags = getAllLocalCanvasFlags();
  const current = flags[eventId] || {};
  flags[eventId] = { ...current, [field]: value };
  setAllLocalCanvasFlags(flags);
}

// Cross-page handoff, since navigating between #/canvas and #/calendar
// unmounts one view's module state entirely. Both views import this same
// module instance to pass a "pending" item across that boundary.
let pendingSchedule = null; // { id, name, course, deadline } | null — id is the Canvas event's own id
let pendingHighlightEventId = null; // string | null — Canvas event id to flash on return
let pendingCalendarHighlightTaskId = null; // string | null — Notion task id to flash on the Calendar tab

export function setPendingSchedule(item) {
  pendingSchedule = item;
}

export function takePendingSchedule() {
  const item = pendingSchedule;
  pendingSchedule = null;
  return item;
}

export function setPendingHighlight(eventId) {
  pendingHighlightEventId = eventId;
}

export function takePendingHighlight() {
  const eventId = pendingHighlightEventId;
  pendingHighlightEventId = null;
  return eventId;
}

// Clicking an already-linked Canvas card jumps to its existing Calendar
// task instead of letting you create a duplicate — see canvas.js's click
// handler and calendar.js's applyPendingCalendarHighlight.
export function setPendingCalendarHighlight(taskId) {
  pendingCalendarHighlightTaskId = taskId;
}

export function takePendingCalendarHighlight() {
  const taskId = pendingCalendarHighlightTaskId;
  pendingCalendarHighlightTaskId = null;
  return taskId;
}
