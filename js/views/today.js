import { fetchNotionTasks, getCachedNotionTasks, updateTask, deleteTask, patchCachedNotionTask, removeCachedNotionTask, addCachedNotionTask } from '../notion.js?v=63';
import { escapeHtml, hexToRgba, formatDisplayDate, formatDuration, formatHMS } from '../format.js?v=63';
import { categoryRank, categoryColorForTask, shapeEmblemHtml, subValueForTask, isoDay, taskDay } from '../taskDisplay.js?v=63';
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
} from '../todaySessions.js?v=63';

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

export function render(rootEl, opts = {}) {
  container = rootEl;
  embedded = Boolean(opts.embedded);

  // Restore an in-progress stopwatch run across reloads (standalone page only).
  activeStopwatchTaskId = embedded ? null : todayTimerState()?.taskId ?? null;
  stopwatchError = null;

  const cached = getCachedNotionTasks();
  if (cached.length) {
    allTasks = cached;
    loadError = null;
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
  }
}

export function unmount() {
  if (tickIntervalId) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }
  window.removeEventListener('keydown', onSpacePause);
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
  rebuild();
}

// Secondary sort key: the task's own course/project/lead value (empty
// string, and so sorting first, for categories with no sub-value config or
// no value set) — groups same-subject/project/lead tasks together within a
// category before falling back to start-time order.
function subSortKey(task) {
  return subValueForTask(task)?.value || '';
}

function todayTasks() {
  const today = isoDay(new Date());
  return allTasks
    .filter((t) => t.category !== 'Lesson' && taskDay(t) === today)
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category)
      || subSortKey(a).localeCompare(subSortKey(b))
      || (a.date.start || '').localeCompare(b.date.start || ''));
}

function timeLabel(task) {
  if (!(task.date?.start?.length > 10)) return '—';
  return new Date(task.date.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
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

// Six flat grid cells (shape/sub/name from catCellsHtml, plus time,
// duration, actions) — .today-row is display:contents (see styles.css) so
// these become direct children of the .today-list grid, which is what
// makes each column line up across every row, same approach as the Classes
// page's .class-list.
function taskRowHtml(task) {
  const clickable = !embedded && resolvableCategory(task);
  const isCurrentTimer = !embedded && activeStopwatchTaskId === task.id;
  const bg = hexToRgba(categoryColorForTask(task), 0.12);
  const rowClasses = ['today-row', task.mark ? 'is-done' : '', isCurrentTimer ? 'is-current-timer' : '', clickable ? 'today-row-clickable' : ''].filter(Boolean).join(' ');
  return `
    <li class="${rowClasses}" data-task-id="${escapeHtml(task.id)}" ${clickable ? 'data-action="select-stopwatch"' : ''}>
      ${catCellsHtml(task)}
      <span class="today-cell today-cell-time mono" style="background:${bg};">${escapeHtml(timeLabel(task))}</span>
      <span class="today-cell today-cell-duration" style="background:${bg};">
        <input type="number" min="0" step="1" value="${task.duration ?? ''}" placeholder="min" data-duration-input data-task-id="${escapeHtml(task.id)}">
      </span>
      <span class="today-cell today-cell-actions" style="background:${bg};">
        <button data-action="toggle-mark" data-task-id="${escapeHtml(task.id)}" class="${task.mark ? 'active' : ''}" title="Mark completed">&#10003;</button>
        <button data-action="toggle-urgent" data-task-id="${escapeHtml(task.id)}" class="${task.urgent ? 'active is-urgent-active' : ''}" title="Mark urgent">!</button>
        <button data-action="delete" data-task-id="${escapeHtml(task.id)}" class="btn-danger" title="Delete">&#10006;</button>
      </span>
      ${!embedded ? '<span class="today-cell today-cell-arrow"></span>' : ''}
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
// Marking a resolvable task complete (false -> true) now requires its
// per-row duration to be filled in first (flashed red if empty) and, once
// filled, logs that duration into today's per-item Sessions row (the same
// row the stopwatch box below pauses/resumes into) before marking it done.
function onToggleMarkClick(task) {
  if (task.mark) {
    toggleField(task.id, 'mark', false);
    return;
  }
  if (!resolvableCategory(task)) {
    toggleField(task.id, 'mark', true);
    return;
  }
  const cat = resolveCategoryForTask(task);
  if (!cat) {
    saveError = `Can't mark complete — "${unresolvedLabelForTask(task)}" doesn't match any existing course/project/lead.`;
    rebuild();
    return;
  }
  if (!task.duration) {
    flashDurationInputError(task.id);
    return;
  }
  addMinutesToTodaySession(task.id, cat.id, task.name, task.duration);
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

// Pauses+saves whatever is currently running, if anything — used by the
// explicit Pause button and as the first half of auto-switching to a
// different item. Clears the running timer either way.
function pauseActiveStopwatch() {
  const current = stopTodayTimer();
  if (!current) return;
  const task = allTasks.find((t) => t.id === current.taskId);
  const cat = task && resolveCategoryForTask(task);
  if (!task || !cat) return; // shouldn't happen — only resolvable rows are clickable
  addMinutesToTodaySession(task.id, cat.id, task.name, elapsedMinutesSince(current.startedAt));
}

function selectStopwatchTask(taskId) {
  const task = allTasks.find((t) => t.id === taskId);
  if (!task || !resolvableCategory(task)) return;
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
  const timer = todayTimerState();
  if (!timer) return;
  const el = container.querySelector('[data-stopwatch-elapsed]');
  if (el) el.textContent = formatHMS(stopwatchDisplayMinutes(timer.taskId) * 60);
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

  container.innerHTML = `
    <section class="card">
      <div class="row-between" style="margin-bottom:0;">
        <div style="display:flex; align-items:baseline; gap:10px;">
          <h1 class="mono" style="margin:0;">Today</h1>
          <span class="muted">${formatDisplayDate()}</span>
        </div>
        <p class="muted" style="margin:0;">Total duration: <span class="mono">${formatDuration(totalMinutes)}</span></p>
      </div>
    </section>

    <section class="card">
      ${saveError ? `<p class="muted" style="color:var(--red); margin-bottom:8px;">Couldn't save: ${escapeHtml(saveError)}</p>` : ''}
      <ul class="today-list ${!embedded ? 'has-timer-arrow' : ''}">${tasks.map(taskRowHtml).join('') || '<p class="muted" style="grid-column: 1 / -1;">No tasks today.</p>'}</ul>
    </section>

    ${!embedded ? stopwatchBoxHtml() : ''}
  `;

  attachEvents();
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
    container.querySelectorAll('[data-action="select-stopwatch"]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button, input')) return; // don't hijack the row's own ✓/!/✖/duration controls
        selectStopwatchTask(row.dataset.taskId);
      });
    });
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
