import { fetchNotionTasks, getCachedNotionTasks, updateTask, deleteTask, patchCachedNotionTask, removeCachedNotionTask, addCachedNotionTask } from '../notion.js?v=72';
import { escapeHtml, hexToRgba, formatDisplayDate, formatDuration, formatHMS, formatDateISO } from '../format.js?v=72';
import { categoryColorForTask, shapeEmblemHtml, subValueForTask, isoDay, taskDay, compareTasksForDay } from '../taskDisplay.js?v=72';
import {
  resolvableCategory,
  resolveCategoryForTask,
  unresolvedLabelForTask,
  todayTimerState,
  startTodayTimer,
  stopTodayTimer,
  elapsedMinutesSince,
  existingTodayMinutesForTask,
  addMinutesToTodaySession,
  closeStaleTodayTimer,
  logCompletionTime,
  resetTodayTaskTime,
} from '../todaySessions.js?v=72';
import { store } from '../store.js?v=72';
import { hexForNotionColor } from '../notionColors.js?v=72';

// ---- break days (holidays): synced BreakDays table, one row per day.
// On a break day, lessons are left out of the hour plan. ----
function breakDayId(day) {
  return `break-${day}`;
}

function isBreakDay(day = isoDay(new Date())) {
  return store.table('BreakDays').some((r) => r.id === breakDayId(day));
}

function toggleBreakDay() {
  const day = isoDay(new Date());
  if (placingTaskId) placingTaskId = null; // the plan's contents change under the ghost
  if (isBreakDay(day)) store.remove('BreakDays', breakDayId(day));
  else store.upsert('BreakDays', { id: breakDayId(day), date: day });
  rebuild();
}

// ---- lessons in the plan (this replaced the old Lessons subchannel).
// Lessons are a weekly timetable in Notion (grouped by weekday, whatever
// their actual date), so "today's lessons" = Lesson tasks on today's
// weekday, at their own time of day, minus archived courses (matched by
// course code, since Notion's Course select has no link to Courses). Shown as
// read-only blocks: they can't be removed from the plan, but they do block
// placing like any other block. None on a break day. ----
function archivedCourseCodes() {
  return new Set(store.table('Courses').filter((c) => c.status === 'archived').map((c) => (c.code || '').trim().toLowerCase()));
}

// ---- the week's lessons, in a popup (header button). Same grouping the old
// Lessons page used: by weekday, Monday first, by time of day within a day.
// The dialog is attached to <body>, not the page container, because
// rebuild() replaces the container's HTML whenever tasks reload and would
// otherwise destroy an open popup. ----
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function weekLessonsHtml() {
  const archived = archivedCourseCodes();
  const lessons = allTasks.filter((t) => t.category === 'Lesson'
    && t.date?.start?.length > 10
    && !archived.has((t.course || '').trim().toLowerCase()));
  if (!lessons.length) return '<p class="muted">No lessons found.</p>';

  const byDay = {};
  for (const t of lessons) {
    const day = new Date(t.date.start).toLocaleDateString('en-US', { weekday: 'long' });
    (byDay[day] = byDay[day] || []).push(t);
  }
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  return WEEKDAYS.filter((d) => byDay[d]).map((day) => {
    const rows = byDay[day]
      .sort((a, b) => minutesIntoDay(new Date(a.date.start)) - minutesIntoDay(new Date(b.date.start)))
      .map((t) => {
        // Color-coded by course (Notion's Course select color), like the old
        // Lessons page — unlike the plan's blocks, which use the Lesson
        // category color. Falls back to that if a lesson has no course color.
        const color = t.courseColor ? hexForNotionColor(t.courseColor) : categoryColorForTask(t);
        const where = [t.location, t.room].filter(Boolean).join(' · ');
        return `
          <div class="wl-row" style="background:${hexToRgba(color, 0.12)}; border-left-color:${color};">
            <span class="wl-course mono" style="color:${color};">${escapeHtml(t.course || '—')}</span>
            <span class="wl-time mono">${escapeHtml(timeLabel(t))}</span>
            <span class="wl-name">${escapeHtml(t.name || 'Untitled')}</span>
            <span class="wl-dur muted">${t.duration ? `${t.duration}min` : ''}</span>
            <span class="wl-where muted">${escapeHtml(where)}</span>
          </div>`;
      }).join('');
    return `
      <h3 class="wl-day mono ${day === todayName ? 'is-today' : ''}">${day}${day === todayName ? ' · today' : ''}</h3>
      <div class="wl-list">${rows}</div>`;
  }).join('');
}

function openWeekLessons() {
  closeWeekLessons();
  const dialog = document.createElement('dialog');
  dialog.className = 'today-lessons-dialog';
  dialog.innerHTML = `
    <div class="row-between" style="margin-bottom:12px;">
      <h2 class="mono" style="margin:0;">Lessons this week</h2>
      <button type="button" data-action="close-lessons" title="Close (Esc)">&#10006;</button>
    </div>
    ${isBreakDay() ? '<p class="muted" style="margin:0 0 10px;">Today is a break day: today\'s lessons are off the plan.</p>' : ''}
    ${weekLessonsHtml()}
  `;
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="close-lessons"]')) { dialog.close(); return; }
    // The backdrop counts as the dialog itself, but so does its own padding —
    // only close when the click is actually outside the box.
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
}

function closeWeekLessons() {
  document.querySelector('dialog.today-lessons-dialog')?.close();
}

function allTodayLessons() {
  if (isBreakDay()) return [];
  const weekday = new Date().getDay();
  const archived = archivedCourseCodes();
  return allTasks.filter((t) => t.category === 'Lesson'
    && t.date?.start?.length > 10
    && new Date(t.date.start).getDay() === weekday
    && !archived.has((t.course || '').trim().toLowerCase()));
}

// ---- a single lesson called off for today (block's "hide" button):
// synced SkippedLessons table. A skipped lesson drops out of the plan's
// real blocks (no lane, no conflicts) and is drawn as a faint outline with
// a restore button instead. ----
function skipId(lessonId, day = isoDay(new Date())) {
  return `skip-${day}-${lessonId}`;
}

function isLessonSkipped(lessonId) {
  return store.table('SkippedLessons').some((r) => r.id === skipId(lessonId));
}

function setLessonSkipped(lessonId, skipped) {
  const id = skipId(lessonId);
  if (skipped) store.upsert('SkippedLessons', { id, date: isoDay(new Date()), lessonId });
  else if (store.table('SkippedLessons').some((r) => r.id === id)) store.remove('SkippedLessons', id);
  rebuild();
}

function todayLessons() {
  return allTodayLessons().filter((t) => !isLessonSkipped(t.id));
}

function skippedLessonsHtml() {
  return allTodayLessons().filter((t) => isLessonSkipped(t.id)).map((t) => {
    const start = minutesIntoDay(new Date(t.date.start));
    const end = Math.min(24 * 60, start + Math.max(PLAN_MIN_BLOCK_MIN, t.duration || 0));
    return `
      <div class="plan-block plan-block-skipped"
        style="top:${(start / 60) * PLAN_HOUR_PX}px; height:${Math.max(14, ((end - start) / 60) * PLAN_HOUR_PX - 2)}px; left:2px; width:calc(100% - 4px);"
        title="${escapeHtml(`Cancelled today: ${t.name || 'Lesson'}`)}">
        <span class="plan-block-name">${escapeHtml(t.name || 'Untitled')}<span class="plan-block-inline">cancelled today</span></span>
        <button type="button" class="plan-block-remove plan-block-restore" data-action="unskip-lesson" data-task-id="${escapeHtml(t.id)}" title="Restore this lesson" aria-label="Restore lesson">&#8634;</button>
      </div>`;
  }).join('');
}

// ---- Notes box (standalone /today only): one free-text notepad, kept as
// the single 'main' row of its own synced TodayNotes table (Code.gs; until
// that's redeployed, js/sync.js holds the writes in the outbox and they go
// up after the next bootstrap that lists the table). Typing goes into notesDraft
// right away and is written to the store after a short pause (or on blur),
// so each keystroke isn't its own outbox op. rebuild() can fire mid-typing
// (task fetch resolving, a row action), so it renders from notesDraft and
// puts focus/caret back where it was. ----
const NOTES_ID = 'main';
const NOTES_SAVE_DELAY_MS = 800;
let notesDraft = null; // null = not loaded yet this mount
let notesSaveTimer = null;

function loadNotes() {
  return store.table('TodayNotes').find((r) => r.id === NOTES_ID)?.text ?? '';
}

function flushNotes() {
  clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  if (notesDraft === null || notesDraft === loadNotes()) return;
  store.upsert('TodayNotes', { id: NOTES_ID, text: notesDraft });
}

function scheduleNotesSave() {
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(flushNotes, NOTES_SAVE_DELAY_MS);
}

// ---- bullet-list editing for the notes textarea. Bullets are plain text
// ("• ", indented 2 spaces per level), so they save/sync as-is. ----
const BULLET = '• ';
const INDENT = '  ';
const BULLET_LINE_RE = /^(\s*)• /;

function notesReplace(el, start, end, text, caret = start + text.length) {
  el.setRangeText(text, start, end);
  el.setSelectionRange(caret, caret);
  notesDraft = el.value;
  scheduleNotesSave();
}

function lineBounds(value, pos) {
  const start = value.lastIndexOf('\n', pos - 1) + 1;
  const nl = value.indexOf('\n', pos);
  return { start, end: nl === -1 ? value.length : nl };
}

function onNotesFocus(e) {
  const el = e.target;
  if (el.value === '') notesReplace(el, 0, 0, BULLET);
}

function onNotesKeydown(e) {
  const el = e.target;
  const { selectionStart: s, selectionEnd: t, value } = el;
  const line = lineBounds(value, s);
  const lineText = value.slice(line.start, line.end);
  const m = lineText.match(BULLET_LINE_RE);

  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    if (!m) return; // a plain line: normal newline
    e.preventDefault();
    if (lineText.trim() === '•' && s === t) {
      // Empty bullet: outdent it, or if it's already top level, drop the bullet.
      if (m[1].length >= INDENT.length) notesReplace(el, line.start, line.start + INDENT.length, '', s - INDENT.length);
      else notesReplace(el, line.start, line.end, '');
      return;
    }
    notesReplace(el, s, t, `\n${m[1]}${BULLET}`);
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      if (!lineText.startsWith(INDENT)) return;
      notesReplace(el, line.start, line.start + INDENT.length, '', Math.max(line.start, s - INDENT.length));
    } else {
      notesReplace(el, line.start, line.start, INDENT, s + INDENT.length);
    }
    return;
  }

  // Backspace right after a bullet marker removes the marker, not just the space.
  if (e.key === 'Backspace' && m && s === t && s === line.start + m[0].length) {
    e.preventDefault();
    notesReplace(el, line.start + m[1].length, s, '');
  }
}

let container = null;
let allTasks = [];
let loadError = null;
let saveError = null;

// Set from render(rootEl, {embedded}) — true for Home's embedded panel
// (js/views/home.js), false for the standalone /today subchannel route. The
// stopwatch box and row-click-to-select are a /today-only feature; Home
// stays a compact glance-only list.
let embedded = false;
let activeStopwatchTaskId = null;
let stopwatchError = null;
let tickIntervalId = null;

// Set by requestJumpFlash() (called from js/views/home.js's T keybind,
// before it sets location.hash) — read once in rebuild() to add a brief
// baby-blue border flash to the header card on the standalone page's next
// mount, so jumping here via keybind gets a visible "you're here now" cue
// the same way clicking through the menu doesn't need (you watched the
// click land). Cleared on a timer rather than after the first rebuild(),
// since render() generally fires a cached-path rebuild() immediately and a
// second one once the async task fetch resolves — the flag needs to
// survive both so the flash doesn't get cut short mid-animation.
let flashOnMount = false;
let flashTimeoutId = null;

export function requestJumpFlash() {
  flashOnMount = true;
}

export function render(rootEl, opts = {}) {
  container = rootEl;
  embedded = Boolean(opts.embedded);

  // Standalone page only — Home already manages #app's width itself (for
  // its own week-grid) around the embedded panel, so this would just be
  // redundant (and risk fighting Home's own add/remove timing) there. Six
  // (seven, with the current-timer arrow column) columns of cells need the
  // same wider layout Calendar/Roadmap/Canvas/Home already opt into rather
  // than being squeezed into the default #app width.
  if (!embedded) container.closest('#app')?.classList.add('app-wide');

  if (!embedded && flashOnMount) {
    clearTimeout(flashTimeoutId);
    flashTimeoutId = setTimeout(() => { flashOnMount = false; }, 1600);
  } else if (embedded) {
    flashOnMount = false; // the flash is standalone-page-only; never let a stray flag bleed into Home's embedded panel
  }

  stopwatchError = null;
  if (!embedded) notesDraft = loadNotes();

  const cached = getCachedNotionTasks();
  if (cached.length) {
    allTasks = cached;
    loadError = null;
    refreshActiveStopwatchTask(); // needs allTasks loaded first, to resolve a stale run's category
    rebuild();
  } else {
    container.innerHTML = `
      <section class="card"><h1 class="mono">Today</h1></section>
      <section class="card"><p class="muted">Loading…</p></section>
    `;
  }
  load();

  if (!embedded && !tickIntervalId) {
    tickIntervalId = setInterval(updateStopwatchElapsed, 1000);
  }
  if (!embedded) {
    // Idempotent-safe even if render() is ever called twice without an
    // intervening unmount (same guard reasoning as the ticker above).
    window.removeEventListener('keydown', onSpacePause);
    window.addEventListener('keydown', onSpacePause);
    // Capture phase, so Esc cancels placing before any page-level Esc handler sees it.
    window.removeEventListener('keydown', onPlacingKeydown, true);
    window.addEventListener('keydown', onPlacingKeydown, true);
    window.removeEventListener('phonemodechange', rebuild);
    window.addEventListener('phonemodechange', rebuild); // re-lay out for the other mode
  }
}

export function unmount() {
  if (tickIntervalId) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }
  if (!embedded) container?.closest('#app')?.classList.remove('app-wide');
  if (!embedded) flushNotes(); // don't lose a pending save when navigating away
  notesDraft = null;
  planScrollTop = null;
  placingTaskId = null;
  closeWeekLessons(); // it lives on <body>, so it'd outlive the page otherwise
  window.removeEventListener('keydown', onSpacePause);
  window.removeEventListener('keydown', onPlacingKeydown, true);
  window.removeEventListener('phonemodechange', rebuild);
  activeStopwatchTaskId = null;
  stopwatchError = null;
  container = null;
}

// Space pauses the running stopwatch from anywhere on the page (no keybind
// for Mark complete — that one stays a deliberate click). Guarded against
// typing contexts so it doesn't hijack a space typed into the duration
// input, a dialog, or anywhere else text entry is happening.
function isTypingTarget() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function onSpacePause(e) {
  if (e.code !== 'Space' && e.key !== ' ') return;
  if (isTypingTarget() || document.querySelector('dialog[open]')) return;
  if (!activeStopwatchTaskId) return; // nothing selected - mirrors the disabled Pause/Resume button
  e.preventDefault();
  onStopwatchPauseResumeClick();
}

async function load() {
  const { tasks, error } = await fetchNotionTasks();
  if (!container) return;
  if (error && getCachedNotionTasks().length) return; // keep showing the cached data
  allTasks = tasks;
  loadError = error;
  refreshActiveStopwatchTask();
  rebuild();
}


function todayTasks() {
  const today = isoDay(new Date());
  return allTasks
    .filter((t) => t.category !== 'Lesson' && taskDay(t) === today)
    .sort(compareTasksForDay);
}

// Blank (not a dash) for an all-day task with no start time.
function timeLabel(task) {
  if (!(task.date?.start?.length > 10)) return '';
  return new Date(task.date.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ---- hour-by-hour plan (standalone /today, right-hand box) ----
const PLAN_HOUR_PX = 48;
const PLAN_MIN_BLOCK_MIN = 15; // shortest block drawn, so a 0/blank-duration task is still visible
let planScrollTop = null; // null = first draw this mount: scroll to the current hour

function minutesIntoDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Timed tasks as positioned blocks. Overlapping tasks are split into side-by-side
// lanes: tasks are swept in start order, each cluster of mutually-overlapping
// tasks shares one lane count, and each task takes the first free lane.
function planBlocks(tasks) {
  const items = tasks
    .filter((t) => t.date?.start?.length > 10)
    .map((t) => {
      const start = minutesIntoDay(new Date(t.date.start));
      const end = Math.min(24 * 60, start + Math.max(PLAN_MIN_BLOCK_MIN, t.duration || 0));
      return { task: t, start, end, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  let cluster = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    const lanes = Math.max(1, ...cluster.map((i) => i.lane + 1));
    cluster.forEach((i) => { i.lanes = lanes; });
    cluster = [];
  };
  for (const item of items) {
    if (item.start >= clusterEnd && cluster.length) closeCluster();
    const laneEnds = [];
    cluster.forEach((i) => { laneEnds[i.lane] = Math.max(laneEnds[i.lane] ?? -1, i.end); });
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.length;
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length) closeCluster();
  return items;
}

function hasStartTime(task) {
  return task.date?.start?.length > 10;
}

// Where the + button drops an untimed task: the first gap, from now (rounded
// up to the next 15 min) onward, long enough for the task's duration among
// today's already-timed tasks. Falls back to the rounded-up "now" if the day
// has no such gap left.
function nextFreePlanStart(task, tasks) {
  const need = Math.max(PLAN_MIN_BLOCK_MIN, task.duration || 0);
  const now = minutesIntoDay(new Date());
  const from = Math.ceil(now / 15) * 15;
  const busy = tasks
    .filter((t) => t.id !== task.id && hasStartTime(t))
    .map((t) => {
      const s = minutesIntoDay(new Date(t.date.start));
      return [s, s + Math.max(PLAN_MIN_BLOCK_MIN, t.duration || 0)];
    })
    .sort((a, b) => a[0] - b[0]);
  let start = from;
  for (const [s, e] of busy) {
    if (e <= start) continue;
    if (s >= start + need) break;
    start = Math.ceil(e / 15) * 15;
  }
  return start + need <= 24 * 60 ? start : Math.min(from, 24 * 60 - 15);
}

// ---- placing mode: + puts a ghost block of the task in the plan, which
// follows the cursor (snapped to 15 min) until a click in the plan commits
// it. Esc, or the same + again, cancels. The ghost is moved by direct DOM
// updates on pointermove (no rebuild); a rebuild mid-placing just redraws it
// from placingMins. ----
const PLAN_SNAP_MIN = 15;
let placingTaskId = null;
let placingMins = 0;

function hhmm(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function startPlacing(taskId) {
  if (placingTaskId === taskId) { cancelPlacing(); return; }
  const task = allTasks.find((t) => t.id === taskId);
  if (!task || hasStartTime(task)) return;
  placingTaskId = taskId;
  placingMins = nextFreePlanStart(task, [...todayTasks(), ...todayLessons()]);
  rebuild();
  // Jump to the box, with the ghost an hour below the top of the timeline.
  const card = container.querySelector('.today-plan-card');
  const scroll = container.querySelector('[data-plan-scroll]');
  if (scroll) scroll.scrollTop = Math.max(0, ((placingMins - 60) / 60) * PLAN_HOUR_PX);
  card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelPlacing() {
  if (!placingTaskId) return;
  placingTaskId = null;
  rebuild();
}

// Minutes into the day under the pointer. snap=false gives the raw value
// (dragging snaps after subtracting where on the block it was grabbed).
function planMinsFromEvent(e, snap = true) {
  const grid = container?.querySelector('.plan-grid');
  if (!grid) return placingMins;
  const y = e.clientY - grid.getBoundingClientRect().top;
  if (!snap) return (y / PLAN_HOUR_PX) * 60;
  const mins = Math.round(((y / PLAN_HOUR_PX) * 60) / PLAN_SNAP_MIN) * PLAN_SNAP_MIN;
  return Math.max(0, Math.min(24 * 60 - PLAN_SNAP_MIN, mins));
}

function placingSpan(mins) {
  const task = allTasks.find((t) => t.id === placingTaskId);
  return [mins, mins + Math.max(PLAN_MIN_BLOCK_MIN, task?.duration || 0)];
}

// Marks every plan block the ghost would overlap (red border via
// .is-conflict) and the ghost itself; returns whether there's any overlap.
// Uses the same [start, end) spans the blocks were drawn with (data-plan-*),
// so "overlaps" means exactly "would visibly overlap".
function updatePlacingConflicts() {
  if (!container) return false;
  const [s, e] = placingTaskId ? placingSpan(placingMins) : [0, 0];
  let any = false;
  container.querySelectorAll('.plan-block[data-plan-start]').forEach((block) => {
    const hit = Boolean(placingTaskId)
      && Number(block.dataset.planStart) < e && s < Number(block.dataset.planEnd);
    block.classList.toggle('is-conflict', hit);
    any = any || hit;
  });
  container.querySelector('[data-plan-ghost]')?.classList.toggle('is-conflict', any);
  return any;
}

function onPlanPointerMove(e) {
  if (!placingTaskId) return;
  const mins = planMinsFromEvent(e);
  if (mins === placingMins) return;
  placingMins = mins;
  const ghost = container.querySelector('[data-plan-ghost]');
  if (ghost) {
    ghost.style.top = `${(mins / 60) * PLAN_HOUR_PX}px`;
    const label = ghost.querySelector('[data-plan-ghost-time]');
    if (label) label.textContent = hhmm(mins);
  }
  updatePlacingConflicts();
}

// A click on an overlapping spot doesn't place — placing just carries on
// (ghost still following the cursor) until a free spot is clicked or Esc.
function onPlanClick(e) {
  if (!placingTaskId) return;
  onPlanPointerMove(e); // moves the ghost to the click (touch has no pointermove before a tap)
  if (updatePlacingConflicts()) {
    const ghost = container.querySelector('[data-plan-ghost]');
    ghost?.classList.remove('is-rejected');
    void ghost?.offsetWidth; // restart the shake
    ghost?.classList.add('is-rejected');
    return;
  }
  const taskId = placingTaskId;
  placingTaskId = null;
  addToPlan(taskId, placingMins);
}

function onPlacingKeydown(e) {
  if (e.key === 'Escape' && placingTaskId) {
    e.preventDefault();
    e.stopPropagation(); // Esc here cancels placing, not the page's own Esc → back
    cancelPlacing();
  }
}

function placingGhostHtml() {
  const task = placingTaskId && allTasks.find((t) => t.id === placingTaskId);
  if (!task) return '';
  const color = categoryColorForTask(task);
  const height = Math.max(14, (Math.max(PLAN_MIN_BLOCK_MIN, task.duration || 0) / 60) * PLAN_HOUR_PX - 2);
  return `
    <div class="plan-block plan-ghost" data-plan-ghost
      style="top:${(placingMins / 60) * PLAN_HOUR_PX}px; height:${height}px; left:2px; width:calc(100% - 4px); background:${hexToRgba(color, 0.28)}; border-left-color:${color};">
      <span class="plan-block-name">${escapeHtml(task.name || 'Untitled')}</span>
      <span class="plan-block-meta mono"><span data-plan-ghost-time>${hhmm(placingMins)}</span> · click to place, Esc to cancel</span>
    </div>`;
}

// Sets a task's start time to `mins` into today — placing an untimed task
// (+) and moving a planned block (drag) both end up here.
async function addToPlan(taskId, mins) {
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) return;
  const day = isoDay(new Date());
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  const newStart = new Date(`${day}T${hh}:${mm}:00`).toISOString(); // same format Agenda writes (calendar.js's combineDateTime)
  const prevDate = task.date;
  task.date = { start: newStart, end: task.date?.end || null };
  patchCachedNotionTask(taskId, { date: task.date });
  saveError = null;
  rebuild();

  const result = await updateTask(taskId, { date: newStart });
  if (!result.ok) {
    task.date = prevDate;
    patchCachedNotionTask(taskId, { date: prevDate });
    saveError = result.error || 'Failed to save the plan time';
    rebuild();
  }
}

// ---- moving a planned block: drag it up/down (task blocks only; lessons
// are fixed). Snaps to 15 min, keeping the grab point under the cursor.
// Anything it would overlap is marked red (same .is-conflict as placing);
// dropping there snaps it back with a shake. A drop on a free spot saves
// the new start time. Moves the block's own element directly while
// dragging, no rebuild until the drop. ----
let planDrag = null; // { el, taskId, origMins, mins, span, grabOffset, startY, moved }

function overlappingBlocks(s, e, exceptEl) {
  return [...container.querySelectorAll('.plan-block[data-plan-start]')].filter((b) => b !== exceptEl
    && Number(b.dataset.planStart) < e && s < Number(b.dataset.planEnd));
}

function markConflicts(blocks, selfEl) {
  container.querySelectorAll('.plan-block.is-conflict').forEach((b) => b.classList.remove('is-conflict'));
  blocks.forEach((b) => b.classList.add('is-conflict'));
  selfEl?.classList.toggle('is-drag-conflict', blocks.length > 0);
}

function onBlockPointerDown(e) {
  if (placingTaskId || e.button !== 0 || e.target.closest('button')) return;
  const el = e.currentTarget;
  const start = Number(el.dataset.planStart);
  planDrag = {
    el,
    taskId: el.dataset.taskId,
    origMins: start,
    mins: start,
    span: Number(el.dataset.planEnd) - start,
    grabOffset: planMinsFromEvent(e, false) - start,
    startY: e.clientY,
    moved: false,
  };
  el.setPointerCapture(e.pointerId);
}

function onBlockPointerMove(e) {
  if (!planDrag || planDrag.el !== e.currentTarget) return;
  if (!planDrag.moved && Math.abs(e.clientY - planDrag.startY) < 4) return; // a click, not a drag
  planDrag.moved = true;
  planDrag.el.classList.add('is-dragging');
  const raw = planMinsFromEvent(e, false) - planDrag.grabOffset;
  const mins = Math.max(0, Math.min(24 * 60 - PLAN_SNAP_MIN, Math.round(raw / PLAN_SNAP_MIN) * PLAN_SNAP_MIN));
  if (mins === planDrag.mins) return;
  planDrag.mins = mins;
  planDrag.el.style.top = `${(mins / 60) * PLAN_HOUR_PX}px`;
  const time = planDrag.el.querySelector('[data-block-time]');
  if (time) time.textContent = hhmm(mins);
  markConflicts(overlappingBlocks(mins, mins + planDrag.span, planDrag.el), planDrag.el);
}

function onBlockPointerUp(e) {
  if (!planDrag || planDrag.el !== e.currentTarget) return;
  const d = planDrag;
  planDrag = null;
  if (!d.moved) return;
  const conflicts = overlappingBlocks(d.mins, d.mins + d.span, d.el);
  if (conflicts.length || d.mins === d.origMins) {
    d.el.style.top = `${(d.origMins / 60) * PLAN_HOUR_PX}px`;
    const time = d.el.querySelector('[data-block-time]');
    if (time) time.textContent = hhmm(d.origMins);
    d.el.classList.remove('is-dragging');
    if (conflicts.length) {
      d.el.classList.remove('is-rejected');
      void d.el.offsetWidth;
      d.el.classList.add('is-rejected');
      setTimeout(() => markConflicts([], d.el), 600); // leave the red up briefly so it's clear why
    }
    return;
  }
  addToPlan(d.taskId, d.mins); // rebuilds with the block at its new time
}

// The block's ✕: takes the task back out of the plan by clearing its start
// time — it keeps its day (date-only, same as Agenda's all-day tasks), so it
// stays on Today, untimed, with its + button back.
async function removeFromPlan(taskId) {
  const task = allTasks.find((t) => t.id === taskId);
  if (!task || !hasStartTime(task)) return;
  const day = taskDay(task);
  const prevDate = task.date;
  task.date = { start: day, end: null };
  patchCachedNotionTask(taskId, { date: task.date });
  saveError = null;
  rebuild();

  const result = await updateTask(taskId, { date: day });
  if (!result.ok) {
    task.date = prevDate;
    patchCachedNotionTask(taskId, { date: prevDate });
    saveError = result.error || 'Failed to remove from plan';
    rebuild();
  }
}

function planBoxHtml(tasks) {
  const hours = Array.from({ length: 25 }, (_, h) => `
    <div class="plan-hour" style="top:${h * PLAN_HOUR_PX}px;">
      <span class="plan-hour-label mono">${String(h % 24).padStart(2, '0')}:00</span>
    </div>`).join('');
  const blocks = planBlocks([...tasks, ...todayLessons()]).map(({ task, start, end, lane, lanes }) => {
    const isLesson = task.category === 'Lesson';
    const color = categoryColorForTask(task); // lessons too: Notion's Lesson category color
    const top = (start / 60) * PLAN_HOUR_PX;
    const height = Math.max(14, ((end - start) / 60) * PLAN_HOUR_PX - 2);
    const sub = isLesson ? (task.course ? { value: task.course } : null) : subValueForTask(task);
    // Everything the old Lessons page showed: course, time, name, duration, location · room.
    const where = isLesson ? [task.location, task.room].filter(Boolean).join(' · ') : '';
    return `
      <div class="plan-block ${isLesson ? 'is-lesson' : ''} ${task.mark && !isLesson ? 'is-done' : ''} ${activeStopwatchTaskId === task.id ? 'is-current-timer' : ''}"
        data-plan-start="${start}" data-plan-end="${end}" ${isLesson ? '' : `data-movable data-task-id="${escapeHtml(task.id)}"`}
        style="top:${top}px; height:${height}px; left:calc(${(lane / lanes) * 100}% + 2px); width:calc(${100 / lanes}% - 4px); background:${hexToRgba(color, 0.18)}; border-left-color:${color};"
        title="${escapeHtml(`${timeLabel(task)} ${isLesson ? `Lesson${task.course ? ` ${task.course}` : ''}: ` : ''}${task.name || 'Untitled'}${task.duration ? ` (${task.duration} min)` : ''}${where ? `\n${where}` : ''}`)}">
        ${isLesson ? `
        <span class="plan-block-name">${escapeHtml(task.name || 'Untitled')}${where ? `<span class="plan-block-inline">${escapeHtml(where)}</span>` : ''}</span>
        <span class="plan-block-meta mono">${escapeHtml(timeLabel(task))}${task.course ? ` · ${escapeHtml(task.course)}` : ''}${task.duration ? ` · ${task.duration}min` : ''}</span>` : `
        <span class="plan-block-name">${escapeHtml(task.name || 'Untitled')}</span>
        <span class="plan-block-meta mono"><span data-block-time>${escapeHtml(timeLabel(task))}</span>${sub ? ` · ${escapeHtml(sub.value)}` : ''}</span>`}
        ${isLesson ? `<button type="button" class="plan-block-remove" data-action="skip-lesson" data-task-id="${escapeHtml(task.id)}" title="Hide this lesson today (class cancelled)" aria-label="Hide lesson today">&#10006;</button>` : `<button type="button" class="plan-block-remove" data-action="unplan" data-task-id="${escapeHtml(task.id)}" title="Remove from plan (clears the start time)" aria-label="Remove from plan">&#10006;</button>`}
      </div>`;
  }).join('');
  return `
    <section class="card today-side-card today-plan-card ${placingTaskId ? 'is-placing' : ''}">
      <div class="plan-inner">
        <div class="plan-scroll" data-plan-scroll>
          <div class="plan-grid" style="height:${24 * PLAN_HOUR_PX}px;">
            ${hours}
            <div class="plan-blocks">${skippedLessonsHtml()}${blocks}${placingGhostHtml()}</div>
            <div class="plan-now" data-plan-now style="top:${(minutesIntoDay(new Date()) / 60) * PLAN_HOUR_PX}px;"></div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function updatePlanNowLine() {
  const line = container?.querySelector('[data-plan-now]');
  if (line) line.style.top = `${(minutesIntoDay(new Date()) / 60) * PLAN_HOUR_PX}px`;
}

function totalDurationMinutes(tasks) {
  return tasks.reduce((sum, t) => sum + (t.duration || 0), 0);
}

// The shape/sub/name cells — shared verbatim between a table row and the
// stopwatch box's "active task" display (js/views/today.js's
// stopwatchBoxHtml), same classes and same background-by-category styling
// in both places, so the stopwatch reads as "this exact row, zoomed in."
function catCellsHtml(task) {
  const catColor = categoryColorForTask(task);
  const sub = subValueForTask(task);
  const bg = hexToRgba(catColor, 0.12);
  return `
    <span class="today-cell today-cell-shape" style="background:${bg}; --cell-color:${catColor};">${shapeEmblemHtml(task, catColor)}</span>
    <span class="today-cell today-cell-sub" style="background:${bg};">${sub ? `<span class="cal-chip-sub-badge" style="border-color:${hexToRgba(sub.color, 0.6)}; background:${hexToRgba(sub.color, 0.18)}; color:${sub.color};">${escapeHtml(sub.value)}</span>` : ''}</span>
    <span class="today-cell today-cell-name mono" style="background:${bg};">${escapeHtml(task.name || 'Untitled')}</span>
  `;
}

// Inline so it takes currentColor (accent when the button is .active), same
// as the ✓/!/✖ glyphs, rather than an emoji that renders in its own colors.
const CLOCK_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.6"/></svg>';

// Six flat grid cells (shape/sub/name from catCellsHtml, plus time,
// duration, actions; the standalone page adds timer + arrow) — .today-row is display:contents (see styles.css) so
// these become direct children of the .today-list grid, which is what
// makes each column line up across every row (same approach as Courses'
// .course-table).
function taskRowHtml(task) {
  // A completed task is done — re-selecting it to start the stopwatch back
  // up doesn't make sense once it's already been marked off, so it drops
  // out of the clickable set the same way a non-resolvable-category row
  // always has been.
  const timerable = !embedded && !task.mark && resolvableCategory(task);
  const isCurrentTimer = !embedded && activeStopwatchTaskId === task.id;
  const bg = hexToRgba(categoryColorForTask(task), 0.12);
  const rowClasses = ['today-row', task.mark ? 'is-done' : '', isCurrentTimer ? 'is-current-timer' : ''].filter(Boolean).join(' ');
  return `
    <li class="${rowClasses}" data-task-id="${escapeHtml(task.id)}" style="--cell-color:${categoryColorForTask(task)};">
      ${catCellsHtml(task)}
      <span class="today-row-line2" style="background:${bg};">
      <span class="today-cell today-cell-time mono" style="background:${bg};">${escapeHtml(timeLabel(task))}</span>
      <span class="today-cell today-cell-duration" style="background:${bg};">
        <input type="number" min="0" step="1" value="${task.duration ?? ''}" placeholder="min" data-duration-input data-task-id="${escapeHtml(task.id)}">
      </span>
      <span class="today-cell today-cell-actions" style="background:${bg};">
        <button data-action="toggle-mark" data-task-id="${escapeHtml(task.id)}" class="${task.mark ? 'active' : ''}" title="Mark completed">&#10003;</button>
        <button data-action="toggle-urgent" data-task-id="${escapeHtml(task.id)}" class="${task.urgent ? 'active is-urgent-active' : ''}" title="Mark urgent">!</button>
        <button data-action="delete" data-task-id="${escapeHtml(task.id)}" class="btn-danger" title="Delete">&#10006;</button>
      </span>
      ${!embedded ? `<span class="today-cell today-cell-timer" style="background:${bg};">${!task.mark && !hasStartTime(task) ? `<button type="button" data-action="add-to-plan" data-task-id="${escapeHtml(task.id)}" class="${placingTaskId === task.id ? 'active' : ''}" title="${placingTaskId === task.id ? 'Cancel placing (Esc)' : "Place in today's plan"}">+</button>` : ''}${timerable ? `<button type="button" data-action="select-stopwatch" data-task-id="${escapeHtml(task.id)}" class="${isCurrentTimer ? 'active' : ''}" title="${isCurrentTimer ? 'Pause / resume timer (Space)' : 'Start timer'}" aria-label="Timer">${CLOCK_ICON}</button>` : ''}</span>` : ''}
      ${!embedded ? '<span class="today-cell today-cell-arrow"></span>' : ''}
      </span>
    </li>
  `;
}

async function toggleField(taskId, field, value) {
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) return;

  const prevValue = task[field];
  task[field] = value;
  patchCachedNotionTask(taskId, { [field]: value });
  saveError = null;
  rebuild();

  const result = await updateTask(taskId, { [field]: value });
  if (!result.ok) {
    task[field] = prevValue;
    patchCachedNotionTask(taskId, { [field]: prevValue });
    saveError = result.error || `Failed to save task`;
    rebuild();
  }
}

async function saveDuration(taskId, duration) {
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) return;

  const prevDuration = task.duration;
  task.duration = duration;
  patchCachedNotionTask(taskId, { duration });
  saveError = null;

  const result = await updateTask(taskId, { duration });
  if (!result.ok) {
    task.duration = prevDuration;
    patchCachedNotionTask(taskId, { duration: prevDuration });
    saveError = result.error || 'Failed to save duration';
    rebuild();
  }
}

async function deleteRow(taskId) {
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) return;
  if (!confirm(`Delete "${task.name || 'this task'}"? It'll be moved to Notion's trash, recoverable there.`)) return;

  allTasks = allTasks.filter((t) => t.id !== taskId);
  removeCachedNotionTask(taskId);
  saveError = null;
  rebuild();

  const result = await deleteTask(taskId);
  if (!result.ok) {
    allTasks = [...allTasks, task];
    addCachedNotionTask(task);
    saveError = result.error || 'Failed to delete task';
    rebuild();
  }
}

// ---- mark-complete, enhanced to log a session for a resolvable task ----
//
// Un-marking (true -> false) and non-resolvable-category tasks (Meeting,
// Date, Application, Lesson, uncategorized) keep the exact original
// one-line toggle, unchanged: no duration requirement, no session logging.
// Marking a resolvable task complete (false -> true): if the stopwatch
// already logged real time for this task today (existingTodayMinutesForTask
// > 0), that session is already the accurate record — just mark complete,
// no duration required, and nothing added on top of it (adding the preset
// duration here too would double count). Only when there's no tracked time
// yet does it fall back to the per-row duration field (flashed red if
// empty), logged into today's per-item Sessions row before marking done.
function onToggleMarkClick(task) {
  if (task.mark) {
    toggleField(task.id, 'mark', false);
    return;
  }
  const outcome = logCompletionTime(task);
  if (outcome === 'unresolved') {
    saveError = `Can't mark complete — "${unresolvedLabelForTask(task)}" doesn't match any existing course/project/lead.`;
    rebuild();
    return;
  }
  if (outcome === 'no-duration') {
    flashDurationInputError(task.id);
    return;
  }
  toggleField(task.id, 'mark', true);
}

function flashDurationInputError(taskId) {
  const input = container?.querySelector(`[data-duration-input][data-task-id="${taskId}"]`);
  if (!input) return;
  input.classList.remove('input-error-flash');
  void input.offsetWidth; // force reflow so re-adding the class restarts the animation
  input.classList.add('input-error-flash');
  setTimeout(() => input.classList.remove('input-error-flash'), 1500);
}

// ---- per-item stopwatch (standalone /today page only — see `embedded`) ----

function stopwatchDisplayMinutes(taskId) {
  const base = existingTodayMinutesForTask(taskId);
  const timer = todayTimerState();
  return base + (timer?.taskId === taskId ? elapsedMinutesSince(timer.startedAt) : 0);
}

// Closes out a stopwatch run left going past midnight (tab never revisited,
// or just never paused before bed) — see closeStaleTodayTimer's own comment
// for why this needs to live here rather than in todaySessions.js: it's the
// only place with allTasks loaded to resolve the stale run's task/category.
// Deliberately called only at mount time (render()/load(), via
// refreshActiveStopwatchTask below) and never from the per-tick ticker —
// a tick fires every second on a page that's actively open, so reconciling
// there would auto-close (and cut off) a run the user is still watching
// the moment it happens to cross midnight. Mount only fires on a fresh
// look at the page, which is the right moment to ask "was this left
// running since before." A no-op whenever nothing's actually stale (the
// normal case, including a same-day run still legitimately in progress).
function reconcileStaleStopwatch() {
  const timer = todayTimerState();
  if (!timer) return;
  if (formatDateISO(new Date(timer.startedAt)) === formatDateISO(new Date())) return;
  closeStaleTodayTimer(allTasks.find((t) => t.id === timer.taskId));
}

// Reconciles, then (re)reads whatever's left running into
// activeStopwatchTaskId — called after allTasks loads/changes (render's
// cached-path and load()'s fresh-fetch path) and isn't called at all in
// embedded mode (Home never shows a selected/running stopwatch).
function refreshActiveStopwatchTask() {
  if (embedded) {
    activeStopwatchTaskId = null;
    return;
  }
  reconcileStaleStopwatch();
  activeStopwatchTaskId = todayTimerState()?.taskId ?? null;
}

// Pauses+saves whatever is currently running, if anything — used by the
// explicit Pause button and as the first half of auto-switching to a
// different item. Clears the running timer either way. Attributed to the
// day the run STARTED, not the day it's being paused on — working past
// midnight (e.g. starting Friday night, pausing Saturday before sunrise)
// stays entirely on Friday's total, no matter how long the run went.
function pauseActiveStopwatch() {
  const current = stopTodayTimer();
  if (!current) return;
  const task = allTasks.find((t) => t.id === current.taskId);
  const cat = task && resolveCategoryForTask(task);
  if (!task || !cat) return; // shouldn't happen — only resolvable rows are clickable
  addMinutesToTodaySession(task.id, cat.id, task.name, elapsedMinutesSince(current.startedAt), formatDateISO(new Date(current.startedAt)));
}

function selectStopwatchTask(taskId) {
  const task = allTasks.find((t) => t.id === taskId);
  if (!task || task.mark || !resolvableCategory(task)) return;
  const cat = resolveCategoryForTask(task);
  if (!cat) {
    stopwatchError = `Can't start — "${unresolvedLabelForTask(task)}" doesn't match any existing course/project/lead.`;
    rebuild();
    return;
  }
  const timer = todayTimerState();
  if (timer?.taskId === taskId) return; // already the active, running item
  if (timer) pauseActiveStopwatch(); // auto-switch: save the previous item's partial time first
  startTodayTimer(taskId);
  activeStopwatchTaskId = taskId;
  stopwatchError = null;
  rebuild();
}

// Toggles between pausing the running stopwatch and resuming the paused
// one — same button either way (its label switches with isRunning in
// stopwatchBoxHtml), and the same spacebar keybind (onSpacePause below)
// mirrors whichever action it's currently showing.
function onStopwatchPauseResumeClick() {
  if (!activeStopwatchTaskId) return;
  const timer = todayTimerState();
  if (timer?.taskId === activeStopwatchTaskId) {
    pauseActiveStopwatch();
  } else {
    startTodayTimer(activeStopwatchTaskId);
  }
  rebuild();
}

// Reset is only offered while the selected task's total (saved + running)
// is under a minute — it's for undoing a mis-started timer, not for
// discarding real logged time.
function canResetStopwatch(taskId) {
  return Boolean(taskId) && stopwatchDisplayMinutes(taskId) < 1;
}

function onStopwatchResetClick() {
  if (!canResetStopwatch(activeStopwatchTaskId)) return;
  resetTodayTaskTime(activeStopwatchTaskId); // stays selected, paused at 0
  rebuild();
}

function onStopwatchCompleteClick() {
  if (!activeStopwatchTaskId) return;
  const taskId = activeStopwatchTaskId;
  const timer = todayTimerState();
  if (timer?.taskId === taskId) pauseActiveStopwatch(); // final save of any still-running time
  activeStopwatchTaskId = null;
  toggleField(taskId, 'mark', true); // same field the row's own ✓ button sets; calls rebuild()
}

function updateStopwatchElapsed() {
  if (!container || embedded) return;
  updatePlanNowLine();
  // Deliberately no stale-run reconcile here — see reconcileStaleStopwatch's
  // comment for why that's mount-only. This tick just keeps the live
  // elapsed display moving, including straight through midnight; the run
  // keeps counting under its start day until the user pauses/completes it
  // or navigates away and back.
  const timer = todayTimerState();
  if (!timer) return;
  const el = container.querySelector('[data-stopwatch-elapsed]');
  if (el) el.textContent = formatHMS(stopwatchDisplayMinutes(timer.taskId) * 60);
  const resetBtn = container.querySelector('[data-action="stopwatch-reset"]');
  if (resetBtn) resetBtn.disabled = !canResetStopwatch(activeStopwatchTaskId);
}

function stopwatchBoxHtml() {
  const task = activeStopwatchTaskId ? allTasks.find((t) => t.id === activeStopwatchTaskId) : null;
  const timer = todayTimerState();
  const isRunning = Boolean(task && timer?.taskId === task.id);
  const minutes = task ? stopwatchDisplayMinutes(task.id) : 0;
  // Same classes a real today-cell-name gets (see catCellsHtml) — matching
  // font/weight to the table "for free," with .is-placeholder (styles.css)
  // just stripping the padding/background that only make sense for a real
  // category-colored cell.
  const taskCells = task ? catCellsHtml(task) : `<span class="today-cell-name mono is-placeholder">No item selected</span>`;
  return `
    <section class="card stopwatch-card ${isRunning ? 'is-running' : ''}">
      <div class="stopwatch-head">
        <h2 class="mono" style="margin:0;">Stopwatch</h2>
        <div class="stopwatch-actions">
          <button type="button" data-action="stopwatch-reset" ${task && canResetStopwatch(task.id) ? '' : 'disabled'} title="Reset to 0 (only under 1 minute)">Reset</button>
          <button type="button" data-action="stopwatch-pause" ${task ? '' : 'disabled'}>${task && !isRunning ? 'Resume' : 'Pause'}</button>
          <button type="button" class="btn-primary" data-action="stopwatch-complete" ${task ? '' : 'disabled'}>Mark complete</button>
        </div>
      </div>
      ${stopwatchError ? `<p class="muted" style="color:var(--red); margin:8px 0 0;">${escapeHtml(stopwatchError)}</p>` : ''}
      <div class="stopwatch-display">
        <div class="stopwatch-task-cells">${taskCells}</div>
        <span class="stopwatch-elapsed" data-stopwatch-elapsed>${formatHMS(minutes * 60)}</span>
      </div>
    </section>
  `;
}

function rebuild() {
  if (!container) return;

  if (loadError) {
    container.innerHTML = `
      <section class="card"><h1 class="mono">Today</h1></section>
      <section class="card"><p class="muted">Couldn't load: ${escapeHtml(loadError)}</p></section>
    `;
    return;
  }

  const tasks = todayTasks();
  const totalMinutes = totalDurationMinutes(tasks);

  // Remember the notes box's focus/caret so a rebuild mid-typing doesn't kick you out.
  const planScrollEl = container.querySelector('[data-plan-scroll]');
  if (planScrollEl) planScrollTop = planScrollEl.scrollTop;

  const notesEl = container.querySelector('[data-today-notes]');
  const notesFocus = notesEl && document.activeElement === notesEl
    ? { start: notesEl.selectionStart, end: notesEl.selectionEnd, scroll: notesEl.scrollTop }
    : null;

  // .today-page / .today-head / .today-tasks-card: hooks for phone mode's
  // reordering (styles.css: header, hour plan, then the rest).
  container.innerHTML = `
    <div class="today-page">
    <section class="card today-head${!embedded && flashOnMount ? ' today-jump-flash' : ''}">
      <div class="row-between" style="margin-bottom:0;">
        <div class="today-head-title" style="display:flex; align-items:baseline; gap:10px;">
          <h1 class="mono" style="margin:0;">Today</h1>
          <span class="muted">${formatDisplayDate()}</span>
          ${embedded ? `<a href="#/today" class="today-jump-link mono" title="Open the Today page (T)">Open →</a>` : ''}
        </div>
        <div class="today-head-right">
          <p class="muted" style="margin:0;">Total duration: <span class="mono">${formatDuration(totalMinutes)}</span></p>
          ${!embedded ? `<button type="button" data-action="toggle-break-day" class="${isBreakDay() ? 'active' : ''}" title="${isBreakDay() ? 'Break day: lessons are hidden from the plan. Click to undo.' : 'Mark today as a break day (holiday): hides lessons from the plan'}">${isBreakDay() ? 'Break day ✓' : 'Break day'}</button>` : ''}
          ${!embedded ? '<button type="button" data-action="open-week-lessons" title="All lessons this week">Lessons</button>' : ''}
        </div>
      </div>
    </section>

    <section class="card today-tasks-card">
      ${saveError ? `<p class="muted" style="color:var(--red); margin-bottom:8px;">Couldn't save: ${escapeHtml(saveError)}</p>` : ''}
      <ul class="today-list ${!embedded ? 'has-timer-arrow' : ''}">${tasks.map(taskRowHtml).join('') || '<p class="muted" style="grid-column: 1 / -1;">No tasks today.</p>'}</ul>
    </section>

    ${!embedded ? `
      <div class="today-bottom-row">
        ${stopwatchBoxHtml()}
        <section class="card today-notes-card">
          <h2 class="mono" style="margin:0;">Notes</h2>
          <textarea class="today-notes" data-today-notes placeholder="• Notes…" spellcheck="true">${escapeHtml(notesDraft ?? '')}</textarea>
        </section>
        ${planBoxHtml(tasks)}
      </div>
    ` : ''}
    </div>
  `;

  const planScroll = container.querySelector('[data-plan-scroll]');
  if (planScroll) {
    // First draw: put the current hour near the top (one hour of context above it).
    planScroll.scrollTop = planScrollTop ?? Math.max(0, (new Date().getHours() - 1) * PLAN_HOUR_PX);
  }

  if (notesFocus) {
    const el = container.querySelector('[data-today-notes]');
    if (el) {
      el.focus();
      el.setSelectionRange(notesFocus.start, notesFocus.end);
      el.scrollTop = notesFocus.scroll;
    }
  }

  attachEvents();
  syncStopwatchColumnWidths();
  if (placingTaskId) updatePlacingConflicts(); // a rebuild mid-placing redraws the blocks without their red marks
}

// .stopwatch-task-cells' CSS grid-template-columns (styles.css) uses the
// same minmax(...,max-content) tracks as .today-list's own, but each grid
// computes max-content independently from whatever content IT actually
// contains — the table sizes its shape/sub columns off the widest badge
// across every row, while the stopwatch only ever shows the one currently
// selected task's badge, which is narrower more often than not. Matching
// column classes alone only lines things up when the selected task happens
// to have the widest badge; copying the table's actual rendered pixel
// widths across (after it's laid out) is what makes them match every time,
// regardless of which task is selected.
function syncStopwatchColumnWidths() {
  if (embedded || !container) return;
  const list = container.querySelector('.today-list');
  const cells = container.querySelector('.stopwatch-task-cells');
  if (!list || !cells) return;
  // Phone mode: the list is per-row cards, not one shared grid, so there
  // are no table columns to match (styles.css sets the stopwatch's own).
  if (document.documentElement.classList.contains('phone-mode')) {
    cells.style.gridTemplateColumns = '';
    return;
  }
  const tracks = getComputedStyle(list).gridTemplateColumns.split(' ');
  if (tracks.length < 2) return;
  cells.style.gridTemplateColumns = `${tracks[0]} ${tracks[1]} 1fr`;
}

function attachEvents() {
  container.querySelectorAll('[data-duration-input]').forEach((input) => {
    input.addEventListener('change', () => {
      const duration = input.value ? Number(input.value) : null;
      saveDuration(input.dataset.taskId, duration);
    });
  });

  container.querySelectorAll('[data-action="toggle-mark"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const task = allTasks.find((t) => t.id === btn.dataset.taskId);
      if (task) onToggleMarkClick(task);
    });
  });

  if (!embedded) {
    // Clock button: starts this task's timer (auto-switching from any other),
    // or pauses/resumes it if it's already the selected one.
    container.querySelectorAll('[data-action="select-stopwatch"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.taskId === activeStopwatchTaskId) onStopwatchPauseResumeClick();
        else selectStopwatchTask(btn.dataset.taskId);
      });
    });
    container.querySelector('[data-action="toggle-break-day"]')?.addEventListener('click', toggleBreakDay);
    container.querySelector('[data-action="open-week-lessons"]')?.addEventListener('click', openWeekLessons);
    container.querySelectorAll('[data-action="add-to-plan"]').forEach((btn) => {
      btn.addEventListener('click', () => startPlacing(btn.dataset.taskId));
    });
    const planGrid = container.querySelector('.plan-grid');
    planGrid?.addEventListener('pointermove', onPlanPointerMove);
    planGrid?.addEventListener('click', onPlanClick);
    container.querySelectorAll('.plan-block[data-movable]').forEach((block) => {
      block.addEventListener('pointerdown', onBlockPointerDown);
      block.addEventListener('pointermove', onBlockPointerMove);
      block.addEventListener('pointerup', onBlockPointerUp);
      block.addEventListener('pointercancel', (e) => {
        if (planDrag) planDrag.mins = planDrag.origMins; // interrupted: put it back, save nothing
        onBlockPointerUp(e);
      });
    });
    container.querySelectorAll('[data-action="skip-lesson"], [data-action="unskip-lesson"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // not a placing click on the grid underneath
        setLessonSkipped(btn.dataset.taskId, btn.dataset.action === 'skip-lesson');
      });
    });
    container.querySelectorAll('[data-action="unplan"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // not a placing click on the grid underneath
        removeFromPlan(btn.dataset.taskId);
      });
    });
    const notes = container.querySelector('[data-today-notes]');
    notes?.addEventListener('input', () => {
      notesDraft = notes.value;
      scheduleNotesSave();
    });
    notes?.addEventListener('keydown', onNotesKeydown);
    notes?.addEventListener('focus', onNotesFocus);
    notes?.addEventListener('blur', () => {
      if (notes.value.trim() === '•') notesDraft = notes.value = ''; // focus added a bullet, nothing typed
      flushNotes();
    });
    container.querySelector('[data-action="stopwatch-reset"]')?.addEventListener('click', onStopwatchResetClick);
    container.querySelector('[data-action="stopwatch-pause"]')?.addEventListener('click', onStopwatchPauseResumeClick);
    container.querySelector('[data-action="stopwatch-complete"]')?.addEventListener('click', onStopwatchCompleteClick);
  }

  container.querySelectorAll('[data-action="toggle-urgent"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const task = allTasks.find((t) => t.id === btn.dataset.taskId);
      if (task) toggleField(task.id, 'urgent', !task.urgent);
    });
  });

  container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => deleteRow(btn.dataset.taskId));
  });
}
