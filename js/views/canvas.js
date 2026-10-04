import { fetchCanvasEvents, getCachedCanvasEvents, setPendingSchedule, takePendingHighlight, setPendingCalendarHighlight, getCanvasFlag, setCanvasFlag } from '../canvas.js?v=33';
import { fetchNotionTasks, getCachedNotionTasks, pushCheckboxUpdates, updateTask, patchCachedNotionTask } from '../notion.js?v=33';
import { hexForCourse } from '../notionColors.js?v=33';
import { escapeHtml, hexToRgba } from '../format.js?v=33';
import { store } from '../store.js?v=33';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let container = null;
let allEvents = [];
let taskByCanvasId = new Map(); // canvas event id -> matching Notion task, only for linked events (deadline set)
let loadError = null;

let viewMode = 'week'; // 'week' | 'month'
let anchor = startOfDay(new Date());
let courseFilter = '';
// Hides anything already handled — marked complete, or just linked to a
// Notion task at all (it's now tracked on Calendar, so it doesn't need to
// keep cluttering the raw Canvas feed).
let hideHandled = false;
let searchQuery = '';

// Same highlight-and-save pattern as the Calendar tab. Clicking an already-
// linked event stages it into `pending` like Calendar does, which gets
// pushed to Notion (and so to Calendar) on Save/Enter. Clicking an unlinked
// one instead stages a flag into `localPending` (see setCanvasFlag) — on
// save that's synced via the CanvasFlags table, never Notion, so marking
// complete/urgent here never silently creates a Calendar item. Either kind
// of staged-but-unsaved mark is discarded by Escape. No mass-delete or
// free-standing add-task here — those stay Calendar-only.
const HIGHLIGHT_KINDS = {
  urgent: { field: 'urgent', property: 'Urgent', label: 'urgent' },
  completed: { field: 'mark', property: '?', label: 'completed' },
};
const HIGHLIGHT_KEYS = { completed: 'C', urgent: 'U' };
const HIGHLIGHT_COLORS = { completed: '#9b9a97', urgent: '#ffffff' };
let activeHighlight = null; // null | 'urgent' | 'completed'
let pending = new Set(); // linked task ids
// Same "only cards actually clicked this session" tracking as calendar.js —
// see taskChipHtml there for the full rationale.
let touchedThisSession = new Set(); // linked task ids
// Unlinked-card counterpart to `pending`/`touchedThisSession` — canvas event
// id -> staged boolean. Only committed (see setCanvasFlag) on Save/Enter,
// same as `pending` only reaches Notion on save, so Escape can discard
// either kind of unsaved mark the same way.
let localPending = new Map();
let localTouchedThisSession = new Set();
let saveError = null;

// Unlink: press L, then click a linked (purple-striped) card to unlink it
// immediately — clears that task's Deadline. No confirm step; relinking
// from the card again is just as easy, so this isn't treated as destructive.
const UNLINK_COLOR = '#9b59b6';
let unlinkMode = false;
let unlinking = false;

// Course filter: courses currently active on the Home page come first;
// everything else (including the CITL/VCSTUD misc bucket) is hidden behind
// the "Other" toggle button until archiving/reorganizing that bucket is
// worth revisiting.
let showOtherCourses = false;

// WASD spatial-navigation highlight — same idea as calendar.js, but with no
// modal dialog on this page to tie the "clear" trigger to; a page navigation
// (unmounting this view) clears it implicitly instead.
let keyNavFocusId = null;
let mousePos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function addMonths(d, n) {
  const copy = new Date(d);
  copy.setMonth(copy.getMonth() + n);
  return copy;
}

function startOfWeek(d) {
  const copy = startOfDay(d);
  return addDays(copy, -copy.getDay());
}

function isoDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isTypingTarget() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// 'F' keybind — jumps focus into the search box and selects any existing
// text, so typing immediately replaces it (same idea as '/' search in a lot
// of other apps).
function focusSearch() {
  const el = container?.querySelector('[data-action="search"]');
  if (el) { el.focus(); el.select(); }
}

function trackMouse(e) {
  mousePos = { x: e.clientX, y: e.clientY };
}

function allChipEls() {
  return container ? [...container.querySelectorAll('.cal-chip[data-task-id]')] : [];
}

function chipCenter(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function applyKeyNavFocus() {
  if (!container) return;
  container.querySelectorAll('.cal-chip.is-keynav-focus').forEach((el) => el.classList.remove('is-keynav-focus'));
  if (!keyNavFocusId) return;
  const el = container.querySelector(`.cal-chip[data-task-id="${keyNavFocusId}"]`);
  if (el) {
    el.classList.add('is-keynav-focus');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
}

function focusNearestToCursor() {
  const els = allChipEls();
  if (!els.length) return;
  let best = null;
  let bestDist = Infinity;
  for (const el of els) {
    const c = chipCenter(el);
    const d = Math.hypot(c.x - mousePos.x, c.y - mousePos.y);
    if (d < bestDist) { bestDist = d; best = el; }
  }
  if (best) {
    keyNavFocusId = best.dataset.taskId;
    applyKeyNavFocus();
  }
}

function moveKeyNavFocus(dir) {
  const els = allChipEls();
  const current = els.find((el) => el.dataset.taskId === keyNavFocusId);
  if (!current) { focusNearestToCursor(); return; }

  const from = chipCenter(current);
  let best = null;
  let bestScore = Infinity;
  for (const el of els) {
    if (el === current) continue;
    const c = chipCenter(el);
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    let primary;
    let ortho;
    if (dir === 'up') { if (dy >= -1) continue; primary = -dy; ortho = Math.abs(dx); }
    else if (dir === 'down') { if (dy <= 1) continue; primary = dy; ortho = Math.abs(dx); }
    else if (dir === 'left') { if (dx >= -1) continue; primary = -dx; ortho = Math.abs(dy); }
    else { if (dx <= 1) continue; primary = dx; ortho = Math.abs(dy); }
    const score = primary + ortho * 2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) {
    keyNavFocusId = best.dataset.taskId;
    applyKeyNavFocus();
  }
}

function handleKeyNav(dir) {
  if (!keyNavFocusId) focusNearestToCursor();
  else moveKeyNavFocus(dir);
}

// Drops out of unlink mode or discards an in-progress (unsaved) highlight
// mark — the same thing Escape does, minus the search-box-blur special
// case, so it can also back a tap target for mobile, where there's no
// Escape key. A no-op when neither mode is active.
function cancelActiveMode() {
  if (unlinkMode) { unlinkMode = false; rebuild(); return; }
  if (activeHighlight) { activeHighlight = null; pending = new Set(); touchedThisSession = new Set(); localPending = new Map(); localTouchedThisSession = new Set(); rebuild(); }
}

function onKeyDown(e) {
  if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    // Checked ahead of isTypingTarget() below so Escape still works while
    // the search box itself has focus — just hands focus back, leaving
    // whatever was typed in place (mirrors the Enter/F flow, which is why
    // this isn't gated the same way plain letter keybinds are).
    if (document.activeElement?.dataset?.action === 'search') { document.activeElement.blur(); return; }
    cancelActiveMode();
    return;
  }

  if (isTypingTarget() || e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    if (activeHighlight) { saveHighlight(activeHighlight); return; }
    if (keyNavFocusId) {
      const el = container?.querySelector(`.cal-chip[data-task-id="${keyNavFocusId}"]`);
      el?.click();
    }
    return;
  }

  switch (e.key) {
    case 'f': case 'F': e.preventDefault(); focusSearch(); break;
    case 'h': case 'H': hideHandled = !hideHandled; rebuild(); break;
    case 'c': case 'C': if (!activeHighlight) toggleHighlight('completed'); break;
    case 'u': case 'U': if (!activeHighlight) toggleHighlight('urgent'); break;
    case 'l': case 'L': toggleUnlinkMode(); break;
    case 'w': case 'W': handleKeyNav('up'); break;
    case 'a': case 'A': handleKeyNav('left'); break;
    case 's': case 'S': handleKeyNav('down'); break;
    case 'd': case 'D': handleKeyNav('right'); break;
    case 'm': case 'M': viewMode = 'month'; rebuild(); break;
    case 't': case 'T': anchor = startOfDay(new Date()); rebuild(); break;
    case 'q': case 'Q': case '<': case ',': anchor = viewMode === 'week' ? addDays(anchor, -7) : addMonths(anchor, -1); rebuild(); break;
    case 'e': case 'E': case '>': case '.': anchor = viewMode === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1); rebuild(); break;
    default: return;
  }
}

export function render(rootEl) {
  container = rootEl;
  container.closest('#app')?.classList.add('app-wide');
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('mousemove', trackMouse);

  const cachedEvents = getCachedCanvasEvents();
  const cachedTasks = getCachedNotionTasks();
  if (cachedEvents.length) {
    allEvents = cachedEvents;
    taskByCanvasId = computeTaskByCanvasId(cachedTasks);
    loadError = null;
    rebuild();
  } else {
    container.innerHTML = `
      <section class="card"><h1 class="mono">Canvas</h1></section>
      <section class="card"><p class="muted">Loading…</p></section>
    `;
  }
  load();
}

export function unmount() {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('mousemove', trackMouse);
  const app = container?.closest('#app');
  app?.classList.remove('app-wide', 'has-mode-tint');
  app?.style.removeProperty('--mode-color');
  app?.style.removeProperty('--mode-tint');
  container = null;
  keyNavFocusId = null;
}

function computeTaskByCanvasId(tasks) {
  const map = new Map();
  for (const t of tasks) if (t.canvasId && t.deadline?.start) map.set(t.canvasId, t);
  return map;
}

async function load() {
  const [eventsResult, tasksResult] = await Promise.all([fetchCanvasEvents(), fetchNotionTasks()]);
  if (!container) return;
  if (eventsResult.error && getCachedCanvasEvents().length) return; // keep showing cached data
  allEvents = eventsResult.events;
  taskByCanvasId = computeTaskByCanvasId(tasksResult.tasks.length ? tasksResult.tasks : getCachedNotionTasks());
  loadError = eventsResult.error;
  rebuild();
}

// Canvas cross-lists some courses under a different code than the Home
// page/Notion use for the same course (e.g. AFST 112 shows up in Canvas as
// HIST 112) — mapped here so the course filter still recognizes it as the
// same active Home course instead of stranding it in "Other".
const CANVAS_COURSE_ALIASES = { 'HIST 112': 'AFST 112' };
function homeCourseCode(canvasCode) {
  return CANVAS_COURSE_ALIASES[canvasCode] || canvasCode;
}

// Courses currently active on the Home page come first, in the same order
// as the Home page (Courses table's sortOrder); everything else (including
// CITL/VCSTUD, campus workshops/services Canvas still tags with a
// course-shaped code) is a second, hidden-by-default group revealed by the
// "Other" button, alphabetical. Archiving/reorganizing that second group is
// deferred.
function homeActiveCourses() {
  return store.table('Courses').filter((c) => c.status === 'active');
}

function availableCourseGroups() {
  const courses = [...new Set(allEvents.map((e) => e.course).filter(Boolean))];
  const activeCourses = homeActiveCourses();
  const sortOrderByCode = new Map(activeCourses.map((c) => [c.code, c.sortOrder]));
  const isActive = (c) => sortOrderByCode.has(homeCourseCode(c));

  const primary = courses.filter(isActive)
    .sort((a, b) => sortOrderByCode.get(homeCourseCode(a)) - sortOrderByCode.get(homeCourseCode(b)));
  const other = courses.filter((c) => !isActive(c)).sort();
  return { primary, other };
}

function visibleEvents() {
  const q = searchQuery.trim().toLowerCase();
  return allEvents.filter((e) => {
    if (courseFilter && e.course !== courseFilter) return false;
    if (hideHandled && taskByCanvasId.has(e.id)) return false;
    if (q) {
      // Search against whatever name is actually shown — the linked
      // Calendar task's name once linked, same as eventChipHtml.
      const displayName = taskByCanvasId.get(e.id)?.name || e.name;
      if (!displayName.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function eventDay(event) {
  if (!event.deadline) return null;
  return event.deadline.slice(0, 10);
}

// Linked events source their flag from the Notion task (and `pending` while
// a save is armed); unlinked events have no task, so they fall back to the
// synced CanvasFlags table (and `localPending` while a save is armed — see
// setCanvasFlag/toggleCanvasOnlyMark), same two-stage shape as the
// linked-task path so Escape can discard either one unsaved.
function isFieldActive(event, task, kind) {
  const field = HIGHLIGHT_KINDS[kind].field;
  if (!task) {
    if (activeHighlight === kind && localPending.has(event.id)) return localPending.get(event.id);
    return getCanvasFlag(event.id, field);
  }
  return activeHighlight === kind ? pending.has(task.id) : Boolean(task[field]);
}

// Mirrors calendar.js's chipStyle, simplified (no category shape/line
// system — just course color, with done/urgent overrides for linked events).
function eventChipStyle(color, event, task) {
  if (isFieldActive(event, task, 'completed')) {
    const grayStripes = `repeating-linear-gradient(45deg, ${hexToRgba('#9b9a97', 0.1)} 0 8px, transparent 8px 16px)`;
    return `border: 2px solid ${hexToRgba(color, 0.6)}; background-color: ${hexToRgba(color, 0.1)}; background-image: ${grayStripes};`;
  }
  if (isFieldActive(event, task, 'urgent')) {
    const whiteStripes = `repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.28) 0 8px, transparent 8px 16px)`;
    return `border: 2px solid ${hexToRgba(color, 0.6)}; outline: 2px solid rgba(255, 255, 255, 0.85); outline-offset: 2px; background-color: ${hexToRgba(color, 0.12)}; background-image: ${whiteStripes};`;
  }
  return `border: 2px solid ${hexToRgba(color, 0.6)}; background-color: ${hexToRgba(color, 0.18)};`;
}

function eventChipHtml(event) {
  const color = hexForCourse(event.course);
  const task = taskByCanvasId.get(event.id);
  const isLinked = Boolean(task);
  // Once linked, show the Calendar task's own name instead of Canvas's raw
  // scraped title — neither side's actual Name is ever touched by linking
  // (see linkCanvasTaskToExisting), so this is purely a display preference.
  const displayName = task?.name || event.name;
  const done = isFieldActive(event, task, 'completed');
  const time = event.deadline?.length > 10
    ? new Date(event.deadline).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';

  // Only linked events can be marked/unlinked through Notion. In highlight
  // mode (not unlink mode), clicking an unlinked event stages its local-only
  // flag instead — see toggleCanvasOnlyMark — rather than creating a Notion
  // task and pulling it onto Calendar just because it got marked here.
  let interactionClass = 'canvas-chip';
  if (unlinkMode) {
    interactionClass += isLinked ? ' is-highlightable' : '';
  } else if (activeHighlight) {
    interactionClass += isLinked ? ' is-highlightable' : ' canvas-chip-clickable';
  } else {
    interactionClass += ' canvas-chip-clickable';
  }

  const title = unlinkMode
    ? (isLinked ? 'Click to unlink' : '')
    : activeHighlight
      ? (isLinked ? `Click to toggle ${HIGHLIGHT_KINDS[activeHighlight].label}` : `Click to mark ${HIGHLIGHT_KINDS[activeHighlight].label} (local only — won't link to Calendar; Save/Enter to keep, Escape to discard)`)
      : (isLinked ? 'Already linked — click to view on Calendar' : event.name);

  // Same static dotted-selected indicator as Calendar's — non-animated,
  // distinct from the marching-ants hover effect, and (like Calendar) only
  // on cards actually clicked this session, not ones already true before
  // the mode started. Unlinked cards use localPending/localTouchedThisSession
  // in place of pending/touchedThisSession.
  const isPendingSelected = activeHighlight && (
    task
      ? pending.has(task.id) && touchedThisSession.has(task.id)
      : localPending.get(event.id) === true && localTouchedThisSession.has(event.id)
  );

  return `
    <div class="cal-chip ${interactionClass}${done ? ' is-done' : ''}${isLinked ? ' has-deadline' : ''}${isPendingSelected ? ' is-pending-selected' : ''}" style="${eventChipStyle(color, event, task)}" title="${escapeHtml(title)}" data-name="${escapeHtml(event.name)}" data-event-id="${escapeHtml(event.id)}" data-course="${escapeHtml(event.course)}" data-deadline="${escapeHtml(event.deadline || '')}" data-task-id="${escapeHtml(task?.id || '')}">
      <span class="cal-chip-ants"></span>
      <span class="cal-chip-name">${escapeHtml(displayName)}</span>
      <div class="cal-chip-bottom-stack">
        <div class="cal-chip-bottom-row">
          <span class="cal-chip-sub-badge" style="border-color:${hexToRgba(color, 0.6)}; background:${hexToRgba(color, 0.18)}; color:${color};">${escapeHtml(event.course || '—')}</span>
          <span class="cal-chip-meta mono">${escapeHtml(time)}</span>
        </div>
      </div>
    </div>
  `;
}

function weekViewHtml(events) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = {};
  for (const e of events) {
    const day = eventDay(e);
    if (!day) continue;
    (byDay[day] = byDay[day] || []).push(e);
  }
  for (const key of Object.keys(byDay)) byDay[key].sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''));

  return `
    <div class="cal-week-grid">
      ${days.map((d, i) => {
        const key = isoDay(d);
        const items = byDay[key] || [];
        return `
          <div class="cal-day-col">
            <div class="cal-day-head mono">${WEEKDAY_NAMES[i]} <span class="muted">${d.getMonth() + 1}/${d.getDate()}</span></div>
            <div class="cal-day-items">${items.map(eventChipHtml).join('') || '<p class="muted cal-empty">—</p>'}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function monthViewHtml(events) {
  const byDay = {};
  for (const e of events) {
    const day = eventDay(e);
    if (!day) continue;
    (byDay[day] = byDay[day] || []).push(e);
  }
  for (const key of Object.keys(byDay)) byDay[key].sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''));

  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const MAX_PER_CELL = 2;

  return `
    <div class="cal-month-grid">
      ${WEEKDAY_NAMES.map((w) => `<div class="cal-month-headcell muted mono">${w}</div>`).join('')}
      ${cells.map((d) => {
        const key = isoDay(d);
        const items = byDay[key] || [];
        const inMonth = d.getMonth() === anchor.getMonth();
        const shown = items.slice(0, MAX_PER_CELL);
        const extra = items.length - shown.length;
        return `
          <div class="cal-month-cell${inMonth ? '' : ' is-outside'}">
            <div class="cal-month-daynum mono">${d.getDate()}</div>
            ${shown.map(eventChipHtml).join('')}
            ${extra > 0 ? `<p class="muted cal-more">+${extra} more</p>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function rangeLabel() {
  if (viewMode === 'week') {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    const sameMonth = start.getMonth() === end.getMonth();
    const startLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const endLabel = end.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
    return `${startLabel} – ${endLabel}, ${end.getFullYear()}`;
  }
  return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function highlightButtonHtml(kind, idleLabel) {
  const isActive = activeHighlight === kind;
  const isOtherActive = (activeHighlight && activeHighlight !== kind) || unlinkMode;
  const label = isActive ? `Save ${HIGHLIGHT_KINDS[kind].label}` : idleLabel;
  const keyHint = isActive ? 'Enter' : HIGHLIGHT_KEYS[kind];
  const color = HIGHLIGHT_COLORS[kind];
  const style = isActive ? ` style="border-color:${color}; color:${color}; background:${hexToRgba(color, 0.14)};"` : '';
  return `<button data-highlight="${kind}" class="${isActive ? 'active' : ''}"${style} ${isOtherActive ? 'disabled' : ''}>[${keyHint}] ${label}</button>`;
}

function unlinkButtonHtml() {
  const disabled = unlinking || activeHighlight;
  const label = unlinking ? 'Unlinking…' : (unlinkMode ? 'Click a card to unlink' : 'Unlink');
  const style = unlinkMode ? ` style="border-color:${UNLINK_COLOR}; color:${UNLINK_COLOR}; background:${hexToRgba(UNLINK_COLOR, 0.14)};"` : '';
  return `<button data-action="unlink-mode" class="${unlinkMode ? 'active' : ''}"${style} ${disabled ? 'disabled' : ''}>[L] ${label}</button>`;
}

// Shared by the button click and the 'c'/'u' keybinds.
function toggleHighlight(kind) {
  if (unlinkMode) return; // mutual exclusion
  if (activeHighlight !== kind) {
    activeHighlight = kind;
    const field = HIGHLIGHT_KINDS[kind].field;
    pending = new Set([...taskByCanvasId.values()].filter((t) => t[field]).map((t) => t.id));
    touchedThisSession = new Set();
    localPending = new Map();
    localTouchedThisSession = new Set();
    rebuild();
  } else {
    saveHighlight(kind);
  }
}

async function saveHighlight(kind) {
  const cfg = HIGHLIGHT_KINDS[kind];
  const linkedTasks = [...taskByCanvasId.values()];
  const changed = linkedTasks.filter((t) => Boolean(t[cfg.field]) !== pending.has(t.id));
  const newValues = new Map(changed.map((t) => [t.id, pending.has(t.id)]));

  // Unlinked marks never touch Notion, so there's nothing to push for
  // them there — just commit whatever was staged this arm to CanvasFlags,
  // same moment the linked side's changes go out.
  for (const [eventId, value] of localPending) setCanvasFlag(eventId, cfg.field, value);

  activeHighlight = null;
  pending = new Set();
  touchedThisSession = new Set();
  localPending = new Map();
  localTouchedThisSession = new Set();

  if (!changed.length) {
    rebuild();
    return;
  }

  // Apply immediately, before the Notion round-trip — a failure rolls these
  // back (see below) rather than leaving the UI waiting on the network for
  // something that already happened locally.
  const prevValues = new Map(changed.map((t) => [t.id, t[cfg.field]]));
  for (const t of changed) {
    t[cfg.field] = newValues.get(t.id);
    patchCachedNotionTask(t.id, { [cfg.field]: newValues.get(t.id) });
  }
  saveError = null;
  rebuild();

  const updates = changed.map((t) => ({ pageId: t.id, value: newValues.get(t.id) }));
  const result = await pushCheckboxUpdates(cfg.property, updates);

  if (!result.ok) {
    for (const t of changed) {
      t[cfg.field] = prevValues.get(t.id);
      patchCachedNotionTask(t.id, { [cfg.field]: prevValues.get(t.id) });
    }
    saveError = result.error || `Failed to save ${cfg.label} flags to Notion`;
    rebuild();
  }
}

// Clicking an unlinked card while Mark completed/Highlight urgent is armed:
// stage its local-only flag in `localPending` (mirrors how a linked click
// stages into `pending`) and re-render. Nothing is written to CanvasFlags,
// no Notion task gets created, and nothing reaches Calendar, until Save/
// Enter actually commits it — so Escape can discard it like any other
// unsaved mark instead of it having already taken effect.
function toggleCanvasOnlyMark(event, kind) {
  const field = HIGHLIGHT_KINDS[kind].field;
  const current = localPending.has(event.id) ? localPending.get(event.id) : getCanvasFlag(event.id, field);
  localPending.set(event.id, !current);
  localTouchedThisSession.add(event.id);
  rebuild();
}

function toggleUnlinkMode() {
  if (activeHighlight) return; // mutual exclusion
  unlinkMode = !unlinkMode;
  rebuild();
}

// Immediate (optimistic) unlink — clears the task's Deadline and CanvasId
// (the latter is what taskByCanvasId matches on; leaving it behind would
// make this task look linked again the moment a new deadline was set). No
// confirm step; relinking from the Canvas card again is just as easy.
async function unlinkTask(taskId) {
  if (!taskId || unlinking) return;
  const task = [...taskByCanvasId.values()].find((t) => t.id === taskId);
  if (!task) return;

  const prevDeadline = task.deadline;
  const prevCanvasId = task.canvasId;
  task.deadline = null;
  task.canvasId = '';
  unlinking = true;
  rebuild();

  const result = await updateTask(taskId, { deadline: '', canvasId: '' });

  if (result.ok) {
    patchCachedNotionTask(taskId, { deadline: null, canvasId: '' });
    saveError = null;
  } else {
    task.deadline = prevDeadline;
    task.canvasId = prevCanvasId;
    saveError = result.error || 'Failed to unlink task';
  }

  unlinking = false;
  rebuild();
}

function currentModeColor() {
  if (unlinkMode) return UNLINK_COLOR;
  if (activeHighlight) return HIGHLIGHT_COLORS[activeHighlight];
  return null;
}

function applyModeVisuals() {
  const app = container?.closest('#app');
  if (!app) return;
  const color = currentModeColor();
  if (color) {
    app.classList.add('has-mode-tint');
    app.style.setProperty('--mode-color', color);
    app.style.setProperty('--mode-tint', hexToRgba(color, 0.05));
  } else {
    app.classList.remove('has-mode-tint');
    app.style.removeProperty('--mode-color');
    app.style.removeProperty('--mode-tint');
  }
}

function rebuild() {
  if (!container) return;

  if (loadError && !allEvents.length) {
    container.innerHTML = `
      <section class="card"><h1 class="mono">Canvas</h1></section>
      <section class="card"><p class="muted">Couldn't load: ${escapeHtml(loadError)}</p></section>
    `;
    return;
  }

  const { primary, other } = availableCourseGroups();
  const events = visibleEvents();

  // rebuild() replaces the whole DOM tree, including the search input
  // itself, on every keystroke — capture focus/cursor beforehand so typing
  // doesn't kick focus out of the box after each character.
  const searchEl = container.querySelector('[data-action="search"]');
  const searchWasFocused = document.activeElement === searchEl;
  const searchSelection = searchWasFocused ? [searchEl.selectionStart, searchEl.selectionEnd] : null;

  function courseButtonHtml(c) {
    const isActive = courseFilter === c;
    const color = hexForCourse(c);
    const style = isActive ? ` style="border-color:${color}; color:${color}; background:${hexToRgba(color, 0.14)};"` : '';
    return `<button data-course-filter="${escapeHtml(c)}" class="${isActive ? 'active' : ''}"${style}>${escapeHtml(c)}</button>`;
  }

  container.innerHTML = `
    <section class="card">
      <div class="row-between">
        <h1 class="mono">Canvas</h1>
        <div style="display:flex; gap:8px;">
          <button data-action="hide-handled" class="${hideHandled ? 'active' : ''}">[H] ${hideHandled ? 'Showing unlinked only' : 'Hide completed/linked'}</button>
          ${highlightButtonHtml('completed', 'Mark completed')}
          ${highlightButtonHtml('urgent', 'Highlight urgent')}
          ${unlinkButtonHtml()}
        </div>
      </div>
      ${saveError ? `<p class="muted" style="color:var(--red); margin-top:8px;">${escapeHtml(saveError)}</p>` : ''}

      <div class="row-between" style="margin-top:12px;">
        <div class="range-toggle">
          <button data-view="week" class="${viewMode === 'week' ? 'active' : ''}">Week</button>
          <button data-view="month" class="${viewMode === 'month' ? 'active' : ''}">[M] Month</button>
        </div>
        <div class="cal-nav">
          <button data-action="prev">[Q]</button>
          <span class="mono cal-range-label">${rangeLabel()}</span>
          <button data-action="today">[T] Today</button>
          <button data-action="next">[E]</button>
        </div>
      </div>

      <div class="row-between" style="margin-top:12px; justify-content:flex-end;">
        <input type="text" class="cal-search-input mono" data-action="search" placeholder="[F] Search assignments…" value="${escapeHtml(searchQuery)}">
      </div>

      <div class="range-toggle" style="margin-top:12px; flex-wrap: wrap;">
        <button data-course-filter="" class="${courseFilter === '' ? 'active' : ''}">All</button>
        ${primary.map(courseButtonHtml).join('')}
        ${other.length ? `
          <span class="filter-gap"></span>
          <button data-action="toggle-other" class="${showOtherCourses ? 'active' : ''}">${showOtherCourses ? 'Other ▾' : 'Other ▸'}</button>
        ` : ''}
        ${showOtherCourses ? other.map(courseButtonHtml).join('') : ''}
      </div>

      <div class="row-between" style="margin-top:12px; justify-content:flex-end;">
        <button data-action="cancel-mode" class="cal-cancel-btn">Cancel</button>
      </div>
    </section>

    <section class="card cal-grid-card">
      ${viewMode === 'week' ? weekViewHtml(events) : monthViewHtml(events)}
    </section>
  `;

  attachEvents();
  applyPendingHighlight();
  applyModeVisuals();
  applyKeyNavFocus();

  if (searchWasFocused) {
    const newSearchEl = container.querySelector('[data-action="search"]');
    if (newSearchEl) {
      newSearchEl.focus();
      newSearchEl.setSelectionRange(...searchSelection);
    }
  }
}

function attachEvents() {
  container.querySelector('[data-action="cancel-mode"]')?.addEventListener('click', cancelActiveMode);

  container.querySelector('[data-action="search"]')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    rebuild();
  });

  container.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.view;
      rebuild();
    });
  });

  container.querySelector('[data-action="prev"]')?.addEventListener('click', () => {
    anchor = viewMode === 'week' ? addDays(anchor, -7) : addMonths(anchor, -1);
    rebuild();
  });
  container.querySelector('[data-action="next"]')?.addEventListener('click', () => {
    anchor = viewMode === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1);
    rebuild();
  });
  container.querySelector('[data-action="today"]')?.addEventListener('click', () => {
    anchor = startOfDay(new Date());
    rebuild();
  });

  container.querySelectorAll('[data-course-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      courseFilter = btn.dataset.courseFilter;
      rebuild();
    });
  });

  container.querySelector('[data-action="toggle-other"]')?.addEventListener('click', () => {
    showOtherCourses = !showOtherCourses;
    rebuild();
  });

  container.querySelector('[data-action="hide-handled"]')?.addEventListener('click', () => {
    hideHandled = !hideHandled;
    rebuild();
  });

  container.querySelectorAll('[data-highlight]').forEach((btn) => {
    btn.addEventListener('click', () => toggleHighlight(btn.dataset.highlight));
  });

  container.querySelector('[data-action="unlink-mode"]')?.addEventListener('click', () => toggleUnlinkMode());

  if (unlinkMode) {
    container.querySelectorAll('.cal-chip.is-highlightable').forEach((el) => {
      el.addEventListener('click', () => unlinkTask(el.dataset.taskId));
    });
  } else {
    if (activeHighlight) {
      container.querySelectorAll('.cal-chip.is-highlightable').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.taskId;
          if (pending.has(id)) pending.delete(id);
          else pending.add(id);
          touchedThisSession.add(id);
          rebuild();
        });
      });
    }
    // .canvas-chip-clickable only ever matches unlinked events once
    // activeHighlight is set (linked ones get is-highlightable instead, with
    // their own handler above), so this always means "no backing task yet"
    // here — flip the local-only mark rather than creating a task and
    // detouring onto Calendar. Outside highlight mode it still means the
    // pick-day/link flow.
    container.querySelectorAll('.canvas-chip-clickable').forEach((el) => {
      el.addEventListener('click', () => {
        const item = {
          id: el.dataset.eventId,
          name: el.dataset.name,
          course: el.dataset.course,
          deadline: el.dataset.deadline,
        };

        if (activeHighlight) {
          toggleCanvasOnlyMark(item, activeHighlight);
          return;
        }

        // Already linked — jump to the existing Calendar task instead of
        // letting another click create a duplicate.
        const linkedTask = taskByCanvasId.get(el.dataset.eventId);
        if (linkedTask) {
          setPendingCalendarHighlight(linkedTask.id);
          location.hash = '/calendar';
          return;
        }
        setPendingSchedule(item);
        location.hash = '/calendar';
      });
    });
  }
}

// Called after a normal render and when returning here via the link glyph
// on a Calendar card (see calendar.js) — flashes a dashed outline on the
// matching card so it's easy to spot again.
function applyPendingHighlight() {
  const eventId = takePendingHighlight();
  if (!eventId || !container) return;
  const match = [...container.querySelectorAll('.cal-chip')].find((el) => el.dataset.eventId === eventId);
  if (!match) return;
  match.classList.add('is-highlighted');
  match.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => match.classList.remove('is-highlighted'), 2500);
}
