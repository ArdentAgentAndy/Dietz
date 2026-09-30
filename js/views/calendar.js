import { fetchNotionTasks, getCachedNotionTasks, pushCheckboxUpdates, createTask, updateTask, deleteTask, patchCachedNotionTask, removeCachedNotionTask, addCachedNotionTask } from '../notion.js?v=14';
import { hexForNotionColor } from '../notionColors.js?v=14';
import { escapeHtml, hexToRgba } from '../format.js?v=14';
import { takePendingSchedule, setPendingHighlight, takePendingCalendarHighlight } from '../canvas.js?v=14';

// Categories that get a course/project/lead sub-filter and two-tone
// (border = category, fill = sub-value) chip styling. Everything else in
// this list (minus Lesson, which lives on its own Classes page) just gets
// a flat category-colored chip.
const SUB_FILTER_BY_CATEGORY = {
  Project: { prop: 'project', colorProp: 'projectColor', label: 'Project' },
  Research: { prop: 'lead', colorProp: 'leadColor', label: 'Lead' },
  Revision: { prop: 'course', colorProp: 'courseColor', label: 'Course' },
  Homework: { prop: 'course', colorProp: 'courseColor', label: 'Course' },
  Examination: { prop: 'course', colorProp: 'courseColor', label: 'Course' },
};

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Display/sort order for categories, grouped with visual gaps between
// groups. Anything not listed here (shouldn't happen) sorts after all of it.
const CATEGORY_GROUPS = [
  ['Examination', 'Revision', 'Homework'],
  ['Project', 'Research'],
  ['Task', 'Date'],
  ['Application'],
];
const CATEGORY_ORDER = CATEGORY_GROUPS.flat();

function categoryRank(category) {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

// Midpoint-marker shape per category (unfiltered view only). Categories not
// listed default to a plain circle.
const SHAPE_BY_CATEGORY = {
  Examination: 'circle',
  Revision: 'square',
  Homework: 'diamond',
  Project: 'triangle',
  Research: 'x',
};

// Notion's own color for Research is "default" (a muted slate-gray), which
// reads too close to Project's gray and isn't very legible on the dark
// background. Override with something in the same neutral family as
// Project's gray, just lighter — distinguishable and legible.
const CATEGORY_COLOR_OVERRIDES = {
  Research: '#4a4844',
};

function categoryColorForTask(task) {
  return CATEGORY_COLOR_OVERRIDES[task.category] || hexForNotionColor(task.categoryColor);
}

let container = null;
let allTasks = [];
let loadError = null;

let viewMode = 'week'; // 'week' | 'month'
let anchor = startOfDay(new Date());
let categoryFilter = '';
let subFilter = '';
let hideCompleted = false;

// Highlight-and-save write-back: press "Highlight urgent"/"Mark completed"
// to start marking cards (click toggles membership in `pending`, a local
// draft), then the button becomes "Save …" and writes the diff against each
// task's current Notion value for that checkbox. Only one kind active at a
// time — the other button is disabled while one is in progress.
const HIGHLIGHT_KINDS = {
  urgent: { field: 'urgent', property: 'Urgent', label: 'urgent' },
  completed: { field: 'mark', property: '?', label: 'completed' },
};
let activeHighlight = null; // null | 'urgent' | 'completed'
let pending = new Set();
// Cards actually clicked during the current highlight-mode session — used to
// draw the static dotted border only on newly-toggled cards, not on ones
// that were already true (and so already in `pending`) before the mode
// started (see taskChipHtml's isPendingSelected).
let touchedThisSession = new Set();
let saving = false;
let saveError = null;

// WASD spatial-navigation highlight: separate from the mouse-hover effect,
// started on whichever card is nearest the cursor, then moved with W/A/S/D.
// Persists across mouse movement and rebuild()s; only cleared when the
// Add/Edit Task dialog is opened and then closed/canceled (see
// openTaskDialog's 'close' listener).
let keyNavFocusId = null;
let mousePos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

let draggedTaskId = null;

// Set on mount if we arrived here from a Canvas card click (see render()
// below) — while non-null, day columns/cells become click targets that
// create a linked Homework task, and existing task cards become click
// targets to link to instead of creating a duplicate.
let schedulingItem = null;
let schedulingError = null;
let schedulingBusy = false; // true while the add/link request is in flight — shown immediately, before the backend confirms

// Mass delete: press D to start marking cards (click toggles a big red X
// over them), press D again to confirm — a real confirm() warning first,
// since this is destructive — which archives every marked task in Notion.
let deleteMode = false;
let markedForDelete = new Set();
let deleting = false;

function isFieldActive(task, kind) {
  const cfg = HIGHLIGHT_KINDS[kind];
  return activeHighlight === kind ? pending.has(task.id) : Boolean(task[cfg.field]);
}

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

// Sunday-based week start.
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

function taskDay(task) {
  if (!task.date?.start) return null;
  return task.date.start.slice(0, 10);
}

// Ignored while typing in a form field or with a modifier held, so the
// shortcuts don't hijack normal typing or browser/OS shortcuts.
function isTypingTarget() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
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

function clearKeyNavFocus() {
  keyNavFocusId = null;
  applyKeyNavFocus();
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

// Directional nearest-neighbor: among cards strictly in `dir` from the
// current focus, pick the one minimizing (distance along dir + 2x lateral
// offset) so it favors staying roughly aligned with the current column/row.
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

function onKeyDown(e) {
  // Escape cancels whatever's currently open/active — checked first, ahead
  // of isTypingTarget(), so it still works while focus is on a field inside
  // the dialog (e.g. mid-typing a task name) and isn't gated behind the
  // dialog-open guard below.
  if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const dialog = container?.querySelector('#modal-dialog');
    if (dialog?.open) { dialog.close(); return; }
    if (schedulingItem) { schedulingItem = null; rebuild(); return; }
    if (deleteMode) { deleteMode = false; markedForDelete = new Set(); rebuild(); return; }
    if (activeHighlight) { activeHighlight = null; pending = new Set(); touchedThisSession = new Set(); rebuild(); return; }
    return;
  }

  if (isTypingTarget() || e.metaKey || e.ctrlKey || e.altKey) return;
  // Belt-and-suspenders: ignore every shortcut below while the Add/Edit
  // dialog is open, regardless of which element inside it has focus (a
  // focused <button> isn't caught by isTypingTarget()).
  if (container?.querySelector('#modal-dialog')?.open) return;

  if (e.key === 'Enter') {
    // Without this, opening the dialog moves focus into its form while this
    // same physical Enter keypress is still being processed by the browser —
    // the still-pending default action then submits that freshly-opened
    // form, saving immediately instead of leaving it open to edit.
    e.preventDefault();
    if (deleteMode) { toggleDeleteMode(); return; }
    if (activeHighlight) { saveHighlight(activeHighlight); return; }
    if (keyNavFocusId) {
      const task = allTasks.find((t) => t.id === keyNavFocusId);
      if (task) openTaskDialog(task);
    }
    return;
  }

  switch (e.key) {
    case '=': openTaskDialog(null); break;
    case 'h': case 'H': hideCompleted = !hideCompleted; rebuild(); break;
    case 'c': case 'C': if (!activeHighlight) toggleHighlight('completed'); break;
    case 'u': case 'U': if (!activeHighlight) toggleHighlight('urgent'); break;
    case 'x': case 'X': if (!deleteMode) toggleDeleteMode(); break;
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
  schedulingItem = takePendingSchedule();
  schedulingError = null;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('mousemove', trackMouse);

  // Cache-first: render whatever we already have instantly (no "Loading…"
  // flash on every tab switch/reload), then silently refresh in the background.
  const cached = getCachedNotionTasks();
  if (cached.length) {
    allTasks = cached.filter((t) => t.category !== 'Lesson');
    loadError = null;
    rebuild();
  } else {
    container.innerHTML = `
      <section class="card"><h1 class="mono">Calendar</h1></section>
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

// Tints the grid card + day columns/cells and colors the card-hover
// marching-ants border to match whichever mode (mass delete, mark
// completed, highlight urgent) is currently active, so it's obvious at a
// glance which mode you're in.
function currentModeColor() {
  if (deleteMode) return '#ff6b6b';
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

async function load() {
  const { tasks, error } = await fetchNotionTasks();
  if (!container) return;
  if (error && getCachedNotionTasks().length) return; // keep showing the cached data
  allTasks = tasks.filter((t) => t.category !== 'Lesson');
  loadError = error;
  rebuild();
}

// Commits the pending Canvas item as a new Homework task: Date = the day
// clicked, Deadline = Canvas's own due date (kept separate — see the
// deadline/link row in taskChipHtml). Returns to the Canvas tab on success.
async function scheduleCanvasTask(day) {
  if (!schedulingItem || !day || schedulingBusy) return;

  // Show "Saving…" and stop responding to further clicks immediately —
  // before the backend confirms — so a slow request never reads as "did
  // that even register?" and invites a second, duplicate click.
  schedulingBusy = true;
  rebuild();

  const item = schedulingItem;
  const result = await createTask({
    name: item.name,
    category: 'Homework',
    course: item.course || '',
    date: day,
    deadline: item.deadline || '',
  });

  if (result.ok) {
    if (result.task) addCachedNotionTask(result.task);
    location.hash = '/canvas';
  } else {
    schedulingBusy = false;
    schedulingError = result.error || 'Failed to add task';
    rebuild();
  }
}

// Linking to an existing task instead of creating a new one — sets that
// task's Deadline to the Canvas item's due date, nothing else.
async function linkCanvasTaskToExisting(taskId) {
  if (!schedulingItem || schedulingBusy) return;

  schedulingBusy = true;
  rebuild();

  const item = schedulingItem;
  const result = await updateTask(taskId, { deadline: item.deadline || '' });

  if (result.ok) {
    if (result.task) patchCachedNotionTask(taskId, result.task);
    location.hash = '/canvas';
  } else {
    schedulingBusy = false;
    schedulingError = result.error || 'Failed to link task';
    rebuild();
  }
}

// Dropping a card onto a day changes only the date part of its Date
// property, preserving the original time-of-day if it had one.
async function moveTaskToDate(taskId, newDay) {
  const task = allTasks.find((t) => t.id === taskId);
  if (!task || !newDay) return;

  const oldStart = task.date?.start;
  if (oldStart && oldStart.slice(0, 10) === newDay) return; // dropped on the same day, no-op

  let newStart;
  if (oldStart && oldStart.length > 10) {
    const oldD = new Date(oldStart);
    const hh = String(oldD.getHours()).padStart(2, '0');
    const mm = String(oldD.getMinutes()).padStart(2, '0');
    newStart = new Date(`${newDay}T${hh}:${mm}:00`).toISOString();
  } else {
    newStart = newDay;
  }

  const prevDate = task.date;
  task.date = { start: newStart, end: task.date?.end || null };
  rebuild();

  const result = await updateTask(taskId, { date: newStart });
  if (!result.ok) {
    task.date = prevDate;
    saveError = result.error || 'Failed to move task';
    rebuild();
  }
}

async function saveHighlight(kind) {
  const cfg = HIGHLIGHT_KINDS[kind];
  const changed = allTasks.filter((t) => Boolean(t[cfg.field]) !== pending.has(t.id));

  if (!changed.length) {
    activeHighlight = null;
    pending = new Set();
    touchedThisSession = new Set();
    rebuild();
    return;
  }

  saving = true;
  rebuild();

  const updates = changed.map((t) => ({ pageId: t.id, value: pending.has(t.id) }));
  const result = await pushCheckboxUpdates(cfg.property, updates);

  if (result.ok) {
    for (const t of changed) {
      const value = pending.has(t.id);
      t[cfg.field] = value;
      patchCachedNotionTask(t.id, { [cfg.field]: value });
    }
    saveError = null;
  } else {
    saveError = result.error || `Failed to save ${cfg.label} flags to Notion`;
  }

  activeHighlight = null;
  saving = false;
  pending = new Set();
  touchedThisSession = new Set();
  rebuild();
}

// Categories present in the data, grouped/ordered per CATEGORY_GROUPS
// (only non-empty groups, only categories that actually occur).
function groupedAvailableCategories() {
  const present = new Set();
  for (const t of allTasks) if (t.category) present.add(t.category);
  return CATEGORY_GROUPS.map((g) => g.filter((c) => present.has(c))).filter((g) => g.length);
}

function categoryColorHex(category) {
  if (CATEGORY_COLOR_OVERRIDES[category]) return CATEGORY_COLOR_OVERRIDES[category];
  const task = allTasks.find((t) => t.category === category);
  return task ? hexForNotionColor(task.categoryColor) : null;
}

function filterButtonStyle(color, isActive) {
  if (!isActive || !color) return '';
  return ` style="border-color:${color}; color:${color}; background:${hexToRgba(color, 0.14)};"`;
}

function availableSubValues(category) {
  const config = SUB_FILTER_BY_CATEGORY[category];
  if (!config) return [];
  const seen = new Set();
  for (const t of allTasks) {
    if (t.category === category && t[config.prop]) seen.add(t[config.prop]);
  }
  return [...seen].sort();
}

function subValueColorHex(category, value) {
  const config = SUB_FILTER_BY_CATEGORY[category];
  if (!config) return null;
  const task = allTasks.find((t) => t.category === category && t[config.prop] === value);
  return task ? hexForNotionColor(task[config.colorProp]) : null;
}

function visibleTasks() {
  return allTasks.filter((t) => {
    if (hideCompleted && t.mark) return false;
    if (categoryFilter && t.category !== categoryFilter) return false;
    if (categoryFilter && subFilter) {
      const config = SUB_FILTER_BY_CATEGORY[categoryFilter];
      if (config && t[config.prop] !== subFilter) return false;
    }
    return true;
  });
}

// Priority: done (gray stripes) > urgent (red stripes) > filtered view (flat
// solid color, sub-value's own color when there is one) > default unfiltered
// (category-colored border/fill, decorative center line above the bottom
// row, drawn via ::before using the --chip-line-color var set here).
function chipStyle(task) {
  const config = SUB_FILTER_BY_CATEGORY[task.category];
  const catColor = categoryColorForTask(task);
  const hasSub = Boolean(config && task[config.prop]);
  const subColor = hasSub ? hexForNotionColor(task[config.colorProp]) : null;
  const borderAlpha = hasSub ? 0.6 : 0.3;

  if (isFieldActive(task, 'completed')) {
    const grayStripes = `repeating-linear-gradient(45deg, ${hexToRgba('#9b9a97', 0.1)} 0 8px, transparent 8px 16px)`;
    return `border: 2px solid ${hexToRgba(catColor, borderAlpha)}; background-color: ${hexToRgba(catColor, 0.1)}; background-image: ${grayStripes};`;
  }

  if (isFieldActive(task, 'urgent')) {
    const whiteStripes = `repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.28) 0 8px, transparent 8px 16px)`;
    // Outline sits outside the existing category border (positive offset)
    // instead of replacing or overlapping it.
    return `border: 2px solid ${hexToRgba(catColor, borderAlpha)}; outline: 2px solid rgba(255, 255, 255, 0.85); outline-offset: 2px; background-color: ${hexToRgba(catColor, 0.12)}; background-image: ${whiteStripes};`;
  }

  if (categoryFilter) {
    const flatColor = subColor || catColor;
    return `border: 2px solid ${hexToRgba(flatColor, 0.6)}; background-color: ${hexToRgba(flatColor, 0.18)};`;
  }

  return `border: 2px solid ${hexToRgba(catColor, borderAlpha)}; background-color: ${hexToRgba(catColor, 0.18)}; --chip-line-color: ${hexToRgba(subColor || catColor, 0.7)};`;
}

// The category-shaped emblem sits at the very bottom-left of the chip, in
// the bottom row itself (not a floating decoration) — a colored glyph for
// Research's "x" mark, otherwise a colored box shaped per SHAPE_BY_CATEGORY.
function shapeEmblemHtml(task, catColor) {
  const shape = SHAPE_BY_CATEGORY[task.category] || 'circle';
  if (shape === 'x') {
    return `<span class="cal-chip-shape shape-x" style="color:${catColor};">&#10005;</span>`;
  }
  return `<span class="cal-chip-shape shape-${shape}" style="background:${catColor};"></span>`;
}

function shortDate(dateStr) {
  const d = dateStr.length > 10 ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function taskChipHtml(task) {
  const config = SUB_FILTER_BY_CATEGORY[task.category];
  const subValue = config ? task[config.prop] : '';
  const subColor = subValue ? hexForNotionColor(task[config.colorProp]) : null;
  const catColor = categoryColorForTask(task);
  const time = task.date?.start?.length > 10
    ? new Date(task.date.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const meta = [time, task.duration ? `${task.duration}m` : ''].filter(Boolean).join(' · ');
  const done = isFieldActive(task, 'completed');
  const urgent = isFieldActive(task, 'urgent');
  const showDecoration = !done && !urgent && !categoryFilter;
  const hasDeadline = Boolean(task.deadline?.start);
  const isMarked = deleteMode && markedForDelete.has(task.id);
  const canLinkTarget = schedulingItem && !schedulingBusy && !activeHighlight && !deleteMode;
  const interactionClass = (activeHighlight || deleteMode) ? 'is-highlightable' : (canLinkTarget ? 'is-link-target' : 'is-editable');
  // Selected-so-far indicator while marking for a highlight mode — a static
  // (non-animated) dotted border, distinct from the marching-ants hover
  // effect, so you can see at a glance which cards you've actively clicked
  // this session. Cards that were already true before the mode started (and
  // so already in `pending`) don't get it unless also clicked.
  const isPendingSelected = activeHighlight && pending.has(task.id) && touchedThisSession.has(task.id);
  const classes = [
    'cal-chip',
    done ? 'is-done' : '',
    interactionClass,
    urgent && !done ? 'is-urgent' : '',
    showDecoration ? 'has-line' : '',
    hasDeadline ? 'has-deadline' : '',
    isPendingSelected ? 'is-pending-selected' : '',
  ].filter(Boolean).join(' ');

  // The meta span is always rendered, even empty — it reserves its line's
  // height so a duration-less task's title can't grow into that space.
  // Draggable only outside a highlight/delete mode — dragging a card onto a
  // different day/cell reschedules it (see attachEvents' drop handler).
  // The deadline/link row (from a Canvas-linked task — see scheduleCanvasTask)
  // sits just above the center line; clicking the link glyph jumps back to
  // the Canvas tab and flashes the matching card there.
  return `
    <div class="${classes}" style="${chipStyle(task)}" title="${escapeHtml(task.name)}" data-task-id="${escapeHtml(task.id)}" draggable="${(activeHighlight || deleteMode || schedulingItem) ? 'false' : 'true'}">
      ${isMarked ? '<div class="cal-chip-delete-mark">&#10006;</div>' : ''}
      <span class="cal-chip-ants"></span>
      <span class="cal-chip-name">${escapeHtml(task.name || 'Untitled')}</span>
      ${hasDeadline ? `
        <div class="cal-chip-deadline-row mono">
          <span>${escapeHtml(shortDate(task.deadline.start))}</span>
          <span class="cal-chip-link" data-link-name="${escapeHtml(task.name)}" title="Back to Canvas">&#128279;</span>
        </div>
      ` : ''}
      <div class="cal-chip-bottom-stack">
        <div class="cal-chip-bottom-row">
          ${showDecoration ? shapeEmblemHtml(task, catColor) : ''}
          ${subValue ? `<span class="cal-chip-sub-badge" style="border-color:${hexToRgba(subColor, 0.6)}; background:${hexToRgba(subColor, 0.18)}; color:${subColor};">${escapeHtml(subValue)}</span>` : ''}
          <span class="cal-chip-meta mono">${escapeHtml(meta)}</span>
        </div>
      </div>
    </div>
  `;
}

function weekViewHtml(tasks) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = {};
  for (const t of tasks) {
    const day = taskDay(t);
    if (!day) continue;
    (byDay[day] = byDay[day] || []).push(t);
  }
  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || (a.date.start || '').localeCompare(b.date.start || ''));
  }

  return `
    <div class="cal-week-grid">
      ${days.map((d, i) => {
        const key = isoDay(d);
        const items = byDay[key] || [];
        return `
          <div class="cal-day-col" data-date="${key}">
            <div class="cal-day-head mono">${WEEKDAY_NAMES[i]} <span class="muted">${d.getMonth() + 1}/${d.getDate()}</span></div>
            <div class="cal-day-items">${items.map(taskChipHtml).join('') || '<p class="muted cal-empty">—</p>'}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function monthViewHtml(tasks) {
  const byDay = {};
  for (const t of tasks) {
    const day = taskDay(t);
    if (!day) continue;
    (byDay[day] = byDay[day] || []).push(t);
  }
  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || (a.date.start || '').localeCompare(b.date.start || ''));
  }

  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const MAX_PER_CELL = 2; // chips are now 128px tall — keep month cells from getting huge

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
          <div class="cal-month-cell${inMonth ? '' : ' is-outside'}" data-date="${key}">
            <div class="cal-month-daynum mono">${d.getDate()}</div>
            ${shown.map(taskChipHtml).join('')}
            ${extra > 0 ? `<p class="muted cal-more">+${extra} more</p>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

const HIGHLIGHT_KEYS = { completed: 'C', urgent: 'U' };
// Match the button's active highlight to what it actually marks — gray for
// done, white for urgent (matching the white-striped urgent cards) —
// instead of the generic blue.
const HIGHLIGHT_COLORS = { completed: '#9b9a97', urgent: '#ffffff' };

function highlightButtonHtml(kind, idleLabel) {
  const isActive = activeHighlight === kind;
  const isOtherActive = (activeHighlight && activeHighlight !== kind) || deleteMode;
  const label = isActive ? (saving ? 'Saving…' : `Save ${HIGHLIGHT_KINDS[kind].label}`) : idleLabel;
  const keyHint = isActive ? 'Enter' : HIGHLIGHT_KEYS[kind];
  const color = HIGHLIGHT_COLORS[kind];
  const style = isActive ? ` style="border-color:${color}; color:${color}; background:${hexToRgba(color, 0.14)};"` : '';
  return `<button data-highlight="${kind}" class="${isActive ? 'active' : ''}"${style} ${saving || isOtherActive ? 'disabled' : ''}>[${keyHint}] ${label}</button>`;
}

// Shared by the button click and the 'c'/'u' keybinds (see attachKeybinds).
function toggleHighlight(kind) {
  if (deleteMode) return; // mutual exclusion with mass delete
  if (activeHighlight !== kind) {
    activeHighlight = kind;
    const field = HIGHLIGHT_KINDS[kind].field;
    pending = new Set(allTasks.filter((t) => t[field]).map((t) => t.id));
    touchedThisSession = new Set();
    rebuild();
  } else {
    saveHighlight(kind);
  }
}

function deleteButtonHtml() {
  const disabled = deleting || (activeHighlight && !deleteMode);
  const label = deleteMode ? (deleting ? 'Deleting…' : 'Confirm delete') : 'Mass delete';
  const keyHint = deleteMode ? 'Enter' : 'X';
  const style = deleteMode ? ' style="border-color:#ff6b6b; color:#ff6b6b; background:rgba(255, 107, 107, 0.14);"' : '';
  return `<button data-action="delete-mode" class="${deleteMode ? 'active' : ''}"${style} ${disabled ? 'disabled' : ''}>[${keyHint}] ${label}</button>`;
}

// Shared by the button click and the 'd' keybind. First press enters
// delete mode (click cards to mark them); second press confirms — with a
// real warning first, since this is destructive — and archives every
// marked task in Notion.
async function toggleDeleteMode() {
  if (!deleteMode) {
    if (activeHighlight) return; // mutual exclusion with highlight modes
    deleteMode = true;
    markedForDelete = new Set();
    rebuild();
    return;
  }

  if (!markedForDelete.size) {
    deleteMode = false;
    rebuild();
    return;
  }

  const count = markedForDelete.size;
  const ok = confirm(`Delete ${count} task${count === 1 ? '' : 's'}? They'll be moved to Notion's trash, recoverable there.`);
  if (!ok) return; // stay in delete mode so the selection can still be adjusted

  deleting = true;
  rebuild();

  const ids = [...markedForDelete];
  const results = await Promise.all(ids.map((id) => deleteTask(id)));
  const failed = results.some((r) => !r.ok);

  if (!failed) {
    allTasks = allTasks.filter((t) => !markedForDelete.has(t.id));
    for (const id of ids) removeCachedNotionTask(id);
    saveError = null;
  } else {
    saveError = 'Some tasks failed to delete — check Notion and try again.';
  }

  deleteMode = false;
  deleting = false;
  markedForDelete = new Set();
  rebuild();
}

function uniqueValues(prop) {
  return [...new Set(allTasks.map((t) => t[prop]).filter(Boolean))].sort();
}

function splitDateTime(dateObj) {
  if (!dateObj?.start) return { date: '', time: '' };
  if (dateObj.start.length <= 10) return { date: dateObj.start, time: '' };
  const d = new Date(dateObj.start);
  return { date: isoDay(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
}

function combineDateTime(date, time) {
  if (!date) return '';
  if (!time) return date;
  return new Date(`${date}T${time}:00`).toISOString();
}

function subFieldLabel(category) {
  return SUB_FILTER_BY_CATEGORY[category]?.label || '';
}

function subFieldProp(category) {
  return SUB_FILTER_BY_CATEGORY[category]?.prop || '';
}

function datalistFor(category) {
  const prop = subFieldProp(category);
  if (!prop) return [];
  return uniqueValues(prop);
}

function openTaskDialog(existing) {
  const dialog = container.querySelector('#modal-dialog');
  const { date, time } = splitDateTime(existing?.date);
  const initialCategory = existing?.category || CATEGORY_ORDER[0];

  function renderSubField(category) {
    const label = subFieldLabel(category);
    const wrap = dialog.querySelector('[data-sub-field-wrap]');
    if (!label) {
      wrap.innerHTML = '';
      return;
    }
    const value = existing && existing.category === category ? existing[subFieldProp(category)] || '' : '';
    wrap.innerHTML = `
      <label>${escapeHtml(label)}
        <input type="text" name="subValue" list="sub-field-options" value="${escapeHtml(value)}" placeholder="${escapeHtml(label)}">
      </label>
      <datalist id="sub-field-options">
        ${datalistFor(category).map((v) => `<option value="${escapeHtml(v)}">`).join('')}
      </datalist>
    `;
  }

  dialog.innerHTML = `
    <form method="dialog" class="modal-form">
      <h2 class="mono">${existing ? 'Edit task' : 'Add task'}</h2>
      <label>Name
        <input type="text" name="name" value="${existing ? escapeHtml(existing.name || '') : ''}" required>
      </label>
      <label>Category
        <select name="category" required>
          ${CATEGORY_ORDER.map((c) => `<option value="${c}" ${c === initialCategory ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </label>
      <div data-sub-field-wrap></div>
      <div class="field-row">
        <label>Date
          <input type="date" name="date" value="${date}">
        </label>
        <label>Time (optional)
          <input type="time" name="time" value="${time}">
        </label>
      </div>
      <label>Duration (minutes, optional)
        <input type="number" name="duration" min="0" step="1" value="${existing?.duration ?? ''}">
      </label>
      <div class="field-row">
        <label style="flex-direction:row; align-items:center; gap:6px;"><input type="checkbox" name="mark" ${existing?.mark ? 'checked' : ''}> Completed</label>
        <label style="flex-direction:row; align-items:center; gap:6px;"><input type="checkbox" name="urgent" ${existing?.urgent ? 'checked' : ''}> Urgent</label>
      </div>
      <p class="muted" data-form-error style="color:var(--red); display:none;"></p>
      <div class="modal-actions">
        ${existing ? '<button type="button" class="btn-danger" data-action="delete">Delete</button>' : ''}
        <button type="button" data-action="cancel">Cancel</button>
        <button type="submit" class="btn-primary">${existing ? 'Save' : 'Add'}</button>
      </div>
    </form>
  `;

  renderSubField(initialCategory);

  const form = dialog.querySelector('form');
  form.querySelector('[name="category"]').addEventListener('change', (e) => renderSubField(e.target.value));
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());

  form.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${existing.name || 'this task'}"? It'll be moved to Notion's trash, recoverable there.`)) return;

    const deleteBtn = form.querySelector('[data-action="delete"]');
    const errorEl = form.querySelector('[data-form-error]');
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting…';

    const result = await deleteTask(existing.id);
    if (result.ok) {
      dialog.close();
      await load();
    } else {
      errorEl.textContent = result.error || 'Something went wrong talking to Notion.';
      errorEl.style.display = 'block';
      deleteBtn.disabled = false;
      deleteBtn.textContent = 'Delete';
    }
  });

  form.addEventListener('submit', async (e) => {
    // Unlike the app's other (synchronous) dialogs, this one awaits a
    // network call — without preventDefault, the method="dialog" form's
    // native auto-close would fire immediately on submit, before the
    // request resolves, regardless of success or failure.
    e.preventDefault();
    const data = new FormData(form);
    const category = data.get('category');
    const prop = subFieldProp(category);
    const submitBtn = form.querySelector('button[type="submit"]');
    const errorEl = form.querySelector('[data-form-error]');

    const fields = {
      name: data.get('name'),
      category,
      date: combineDateTime(data.get('date'), data.get('time')),
      duration: data.get('duration') ? Number(data.get('duration')) : null,
      mark: data.get('mark') === 'on',
      urgent: data.get('urgent') === 'on',
    };
    if (prop) fields[prop] = data.get('subValue') || '';

    submitBtn.disabled = true;
    submitBtn.textContent = existing ? 'Saving…' : 'Adding…';

    const result = existing ? await updateTask(existing.id, fields) : await createTask(fields);

    if (result.ok) {
      dialog.close();
      await load();
    } else {
      errorEl.textContent = result.error || 'Something went wrong talking to Notion.';
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = existing ? 'Save' : 'Add';
    }
  });

  // Clears the WASD keynav focus once this editing window actually closes —
  // covers the Cancel button, a successful save/delete (both call
  // dialog.close()), and the native Escape-to-close behavior alike.
  dialog.addEventListener('close', clearKeyNavFocus, { once: true });

  dialog.showModal();
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

function rebuild() {
  if (!container) return;

  if (loadError) {
    container.innerHTML = `
      <section class="card"><h1 class="mono">Calendar</h1></section>
      <section class="card"><p class="muted">Couldn't load: ${escapeHtml(loadError)}</p></section>
    `;
    return;
  }

  const categoryGroups = groupedAvailableCategories();
  const subValues = categoryFilter ? availableSubValues(categoryFilter) : [];
  const subLabel = SUB_FILTER_BY_CATEGORY[categoryFilter]?.label;
  const tasks = visibleTasks();

  container.innerHTML = `
    <section class="card">
      <div class="row-between">
        <h1 class="mono">Calendar</h1>
        <div style="display:flex; gap:8px;">
          <button data-action="add-task">[=] + Add task</button>
          <button data-action="hide-completed" class="${hideCompleted ? 'active' : ''}">[H] ${hideCompleted ? 'Showing active only' : 'Hide completed'}</button>
          ${highlightButtonHtml('completed', 'Mark completed')}
          ${highlightButtonHtml('urgent', 'Highlight urgent')}
          ${deleteButtonHtml()}
        </div>
      </div>
      ${saveError ? `<p class="muted" style="color:var(--red); margin-top:8px;">Couldn't save: ${escapeHtml(saveError)}</p>` : ''}
      ${schedulingItem ? `
        <div class="row-between" style="margin-top:8px; padding:8px 10px; background:var(--accent-dim); border-radius:var(--radius-sm);">
          <span class="mono">${schedulingBusy ? 'Saving…' : `Pick a day for "${escapeHtml(schedulingItem.name)}", or click an existing task (purple) to link to it instead`}</span>
          <button data-action="cancel-schedule" ${schedulingBusy ? 'disabled' : ''}>Cancel</button>
        </div>
      ` : ''}
      ${schedulingError ? `<p class="muted" style="color:var(--red); margin-top:8px;">${escapeHtml(schedulingError)}</p>` : ''}

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

      <div class="range-toggle" style="margin-top:12px; flex-wrap: wrap;">
        <button data-category="" class="${categoryFilter === '' ? 'active' : ''}">All</button>
        <span class="filter-gap"></span>
        ${categoryGroups.map((group) => group.map((c) => {
          const isActive = categoryFilter === c;
          return `<button data-category="${escapeHtml(c)}" class="${isActive ? 'active' : ''}"${filterButtonStyle(categoryColorHex(c), isActive)}>${escapeHtml(c)}</button>`;
        }).join('')).join('<span class="filter-gap"></span>')}
      </div>

      ${subLabel ? `
        <div class="range-toggle" style="margin-top:8px; flex-wrap: wrap;">
          <button data-sub="" class="${subFilter === '' ? 'active' : ''}">All ${escapeHtml(subLabel)}s</button>
          ${subValues.map((v) => {
            const isActive = subFilter === v;
            return `<button data-sub="${escapeHtml(v)}" class="${isActive ? 'active' : ''}"${filterButtonStyle(subValueColorHex(categoryFilter, v), isActive)}>${escapeHtml(v)}</button>`;
          }).join('')}
        </div>
      ` : ''}
    </section>

    <section class="card cal-grid-card">
      ${viewMode === 'week' ? weekViewHtml(tasks) : monthViewHtml(tasks)}
    </section>

    <dialog id="modal-dialog"></dialog>
  `;

  attachEvents();
  applyPendingCalendarHighlight();
  applyModeVisuals();
  applyKeyNavFocus();
}

// Arrived here from clicking an already-linked Canvas card — jump the
// anchor to that task's date (guaranteeing it's actually rendered, since
// it could be far outside the currently displayed week/month) and flash it.
function applyPendingCalendarHighlight() {
  const name = takePendingCalendarHighlight();
  if (!name) return;
  const task = allTasks.find((t) => t.name === name);
  if (!task) return;

  if (task.date?.start) {
    const start = task.date.start.length > 10 ? task.date.start : `${task.date.start}T00:00:00`;
    anchor = startOfDay(new Date(start));
    // Re-render at the corrected date. Its own end-of-rebuild call to this
    // function no-ops (the pending name is already consumed above), so
    // finding/flashing the chip continues right after, against fresh DOM.
    rebuild();
  }

  const match = container.querySelector(`.cal-chip[data-task-id="${task.id}"]`);
  if (!match) return;
  match.classList.add('is-highlight-flash');
  match.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => match.classList.remove('is-highlight-flash'), 2500);
}

function attachEvents() {
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

  container.querySelector('[data-action="hide-completed"]')?.addEventListener('click', () => {
    hideCompleted = !hideCompleted;
    rebuild();
  });

  container.querySelector('[data-action="add-task"]')?.addEventListener('click', () => openTaskDialog(null));

  container.querySelectorAll('[data-highlight]').forEach((btn) => {
    btn.addEventListener('click', () => toggleHighlight(btn.dataset.highlight));
  });

  container.querySelector('[data-action="delete-mode"]')?.addEventListener('click', () => toggleDeleteMode());

  if (deleteMode) {
    container.querySelectorAll('.cal-chip.is-highlightable').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.taskId;
        if (markedForDelete.has(id)) markedForDelete.delete(id);
        else markedForDelete.add(id);
        rebuild();
      });
    });
  } else if (activeHighlight) {
    container.querySelectorAll('.cal-chip.is-highlightable').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.taskId;
        if (pending.has(id)) pending.delete(id);
        else pending.add(id);
        touchedThisSession.add(id);
        rebuild();
      });
    });
  } else {
    container.querySelectorAll('.cal-chip.is-editable').forEach((el) => {
      el.addEventListener('click', () => {
        const task = allTasks.find((t) => t.id === el.dataset.taskId);
        if (task) openTaskDialog(task);
      });
    });
  }

  container.querySelectorAll('.cal-chip-link').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation(); // don't also trigger the card's own click-to-edit
      setPendingHighlight(el.dataset.linkName);
      location.hash = '/canvas';
    });
  });

  container.querySelectorAll('.cal-chip[draggable="true"]').forEach((el) => {
    el.addEventListener('dragstart', () => {
      draggedTaskId = el.dataset.taskId;
      el.classList.add('is-dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('is-dragging');
      draggedTaskId = null;
    });
  });

  container.querySelectorAll('[data-date]').forEach((el) => {
    el.addEventListener('dragover', (e) => {
      if (!draggedTaskId) return;
      e.preventDefault();
      el.classList.add('is-drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('is-drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('is-drop-target');
      if (draggedTaskId) moveTaskToDate(draggedTaskId, el.dataset.date);
    });

    if (schedulingItem && !schedulingBusy) {
      el.classList.add('is-schedulable');
      el.addEventListener('mouseenter', () => el.classList.add('is-drop-target'));
      el.addEventListener('mouseleave', () => el.classList.remove('is-drop-target'));
      el.addEventListener('click', () => scheduleCanvasTask(el.dataset.date));
    }
  });

  container.querySelectorAll('.cal-chip.is-link-target').forEach((el) => {
    el.addEventListener('click', () => linkCanvasTaskToExisting(el.dataset.taskId));
  });

  container.querySelector('[data-action="cancel-schedule"]')?.addEventListener('click', () => {
    schedulingItem = null;
    rebuild();
  });

  container.querySelectorAll('[data-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      categoryFilter = btn.dataset.category;
      subFilter = '';
      rebuild();
    });
  });

  container.querySelectorAll('[data-sub]').forEach((btn) => {
    btn.addEventListener('click', () => {
      subFilter = btn.dataset.sub;
      rebuild();
    });
  });
}
