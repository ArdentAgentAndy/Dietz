import { store } from './store.js?v=52';

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
// linking them to a Notion task — there's no backing task to store them
// on, so they live in their own synced table (CanvasFlags) instead, keyed
// by the Canvas event id. Synced like any other table (via store.upsert's
// outbox) rather than kept local-only, so the Apps Script backend can see
// a completed mark too, for the digest/due-soon-reminder triggers (see
// Code.gs's canvasDoneIds_). Only ever written via setCanvasFlag on
// Save/Enter — see js/views/canvas.js's toggleHighlight/saveHighlight,
// which stage these the same way `pending` stages linked-task changes so
// Escape can discard an unsaved mark instead of it having already synced.
export function getCanvasFlag(eventId, field) {
  return Boolean(store.table('CanvasFlags').find((f) => f.id === eventId)?.[field]);
}

export function setCanvasFlag(eventId, field, value) {
  store.upsert('CanvasFlags', { id: eventId, [field]: value });
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
