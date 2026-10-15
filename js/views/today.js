import { fetchNotionTasks, getCachedNotionTasks, updateTask, deleteTask, patchCachedNotionTask, removeCachedNotionTask, addCachedNotionTask } from '../notion.js?v=61';
import { escapeHtml, hexToRgba, formatDisplayDate, formatDuration } from '../format.js?v=61';
import { categoryRank, categoryColorForTask, shapeEmblemHtml, subValueForTask, isoDay, taskDay } from '../taskDisplay.js?v=61';

let container = null;
let allTasks = [];
let loadError = null;
let saveError = null;

export function render(rootEl) {
  container = rootEl;

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
}

export function unmount() {
  container = null;
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

// Six flat grid cells (shape, sub-value, name, time, duration, actions) —
// .today-row is display:contents (see styles.css) so these become direct
// children of the .today-list grid, which is what makes each column line up
// across every row, same approach as the Classes page's .class-list.
function taskRowHtml(task) {
  const catColor = categoryColorForTask(task);
  const sub = subValueForTask(task);
  const bg = hexToRgba(catColor, 0.12);
  return `
    <li class="today-row ${task.mark ? 'is-done' : ''}" data-task-id="${escapeHtml(task.id)}">
      <span class="today-cell today-cell-shape" style="background:${bg}; --cell-color:${catColor};">${shapeEmblemHtml(task, catColor)}</span>
      <span class="today-cell today-cell-sub" style="background:${bg};">${sub ? `<span class="cal-chip-sub-badge" style="border-color:${hexToRgba(sub.color, 0.6)}; background:${hexToRgba(sub.color, 0.18)}; color:${sub.color};">${escapeHtml(sub.value)}</span>` : ''}</span>
      <span class="today-cell today-cell-name mono" style="background:${bg};">${escapeHtml(task.name || 'Untitled')}</span>
      <span class="today-cell today-cell-time mono" style="background:${bg};">${escapeHtml(timeLabel(task))}</span>
      <span class="today-cell today-cell-duration" style="background:${bg};">
        <input type="number" min="0" step="1" value="${task.duration ?? ''}" placeholder="min" data-duration-input data-task-id="${escapeHtml(task.id)}">
      </span>
      <span class="today-cell today-cell-actions" style="background:${bg};">
        <button data-action="toggle-mark" data-task-id="${escapeHtml(task.id)}" class="${task.mark ? 'active' : ''}" title="Mark completed">&#10003;</button>
        <button data-action="toggle-urgent" data-task-id="${escapeHtml(task.id)}" class="${task.urgent ? 'active is-urgent-active' : ''}" title="Mark urgent">!</button>
        <button data-action="delete" data-task-id="${escapeHtml(task.id)}" class="btn-danger" title="Delete">&#10006;</button>
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
      <ul class="today-list">${tasks.map(taskRowHtml).join('') || '<p class="muted" style="grid-column: 1 / -1;">No tasks today.</p>'}</ul>
    </section>
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
      if (task) toggleField(task.id, 'mark', !task.mark);
    });
  });

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
