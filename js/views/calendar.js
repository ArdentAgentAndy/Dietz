import { fetchNotionTasks, getCachedNotionTasks, pushCheckboxUpdates, createTask, updateTask } from '../notion.js';
import { hexForNotionColor } from '../notionColors.js';
import { escapeHtml, hexToRgba } from '../format.js';

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
let saving = false;
let saveError = null;

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

export function render(rootEl) {
  container = rootEl;
  container.closest('#app')?.classList.add('app-wide');

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
  container?.closest('#app')?.classList.remove('app-wide');
  container = null;
}

async function load() {
  const { tasks, error } = await fetchNotionTasks();
  if (!container) return;
  if (error && getCachedNotionTasks().length) return; // keep showing the cached data
  allTasks = tasks.filter((t) => t.category !== 'Lesson');
  loadError = error;
  rebuild();
}

async function saveHighlight(kind) {
  const cfg = HIGHLIGHT_KINDS[kind];
  const changed = allTasks.filter((t) => Boolean(t[cfg.field]) !== pending.has(t.id));

  if (!changed.length) {
    activeHighlight = null;
    pending = new Set();
    rebuild();
    return;
  }

  saving = true;
  rebuild();

  const updates = changed.map((t) => ({ pageId: t.id, value: pending.has(t.id) }));
  const result = await pushCheckboxUpdates(cfg.property, updates);

  if (result.ok) {
    for (const t of changed) t[cfg.field] = pending.has(t.id);
    saveError = null;
  } else {
    saveError = result.error || `Failed to save ${cfg.label} flags to Notion`;
  }

  activeHighlight = null;
  saving = false;
  pending = new Set();
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
  const catColor = hexForNotionColor(task.categoryColor);
  const hasSub = Boolean(config && task[config.prop]);
  const subColor = hasSub ? hexForNotionColor(task[config.colorProp]) : null;
  const borderAlpha = hasSub ? 0.6 : 0.3;

  if (isFieldActive(task, 'completed')) {
    const grayStripes = `repeating-linear-gradient(45deg, ${hexToRgba('#9b9a97', 0.1)} 0 8px, transparent 8px 16px)`;
    return `border: 2px solid ${hexToRgba(catColor, borderAlpha)}; background-color: ${hexToRgba(catColor, 0.1)}; background-image: ${grayStripes};`;
  }

  if (isFieldActive(task, 'urgent')) {
    const redStripes = `repeating-linear-gradient(45deg, ${hexToRgba('#ff6b6b', 0.22)} 0 8px, transparent 8px 16px)`;
    return `border: 2px solid ${hexToRgba(catColor, borderAlpha)}; background-color: ${hexToRgba(catColor, 0.12)}; background-image: ${redStripes};`;
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

function taskChipHtml(task) {
  const config = SUB_FILTER_BY_CATEGORY[task.category];
  const subValue = config ? task[config.prop] : '';
  const subColor = subValue ? hexForNotionColor(task[config.colorProp]) : null;
  const catColor = hexForNotionColor(task.categoryColor);
  const time = task.date?.start?.length > 10
    ? new Date(task.date.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const meta = [time, task.duration ? `${task.duration}m` : ''].filter(Boolean).join(' · ');
  const done = isFieldActive(task, 'completed');
  const urgent = isFieldActive(task, 'urgent');
  const showDecoration = !done && !urgent && !categoryFilter;
  const classes = [
    'cal-chip',
    done ? 'is-done' : '',
    activeHighlight ? 'is-highlightable' : 'is-editable',
    urgent && !done ? 'is-urgent' : '',
    showDecoration ? 'has-line' : '',
  ].filter(Boolean).join(' ');

  // The meta span is always rendered, even empty — it reserves its line's
  // height so a duration-less task's title can't grow into that space.
  return `
    <div class="${classes}" style="${chipStyle(task)}" title="${escapeHtml(task.name)}" data-task-id="${escapeHtml(task.id)}">
      <span class="cal-chip-name">${escapeHtml(task.name || 'Untitled')}</span>
      <div class="cal-chip-bottom-row">
        ${showDecoration ? shapeEmblemHtml(task, catColor) : ''}
        ${subValue ? `<span class="cal-chip-sub-badge" style="border-color:${hexToRgba(subColor, 0.6)}; background:${hexToRgba(subColor, 0.18)}; color:${subColor};">${escapeHtml(subValue)}</span>` : ''}
        <span class="cal-chip-meta mono">${escapeHtml(meta)}</span>
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
          <div class="cal-day-col">
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
          <div class="cal-month-cell${inMonth ? '' : ' is-outside'}">
            <div class="cal-month-daynum mono">${d.getDate()}</div>
            ${shown.map(taskChipHtml).join('')}
            ${extra > 0 ? `<p class="muted cal-more">+${extra} more</p>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function highlightButtonHtml(kind, idleLabel) {
  const isActive = activeHighlight === kind;
  const isOtherActive = activeHighlight && activeHighlight !== kind;
  const label = isActive ? (saving ? 'Saving…' : `Save ${HIGHLIGHT_KINDS[kind].label}`) : idleLabel;
  return `<button data-highlight="${kind}" class="${isActive ? 'active' : ''}" ${saving || isOtherActive ? 'disabled' : ''}>${label}</button>`;
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
        <button type="button" data-action="cancel">Cancel</button>
        <button type="submit" class="btn-primary">${existing ? 'Save' : 'Add'}</button>
      </div>
    </form>
  `;

  renderSubField(initialCategory);

  const form = dialog.querySelector('form');
  form.querySelector('[name="category"]').addEventListener('change', (e) => renderSubField(e.target.value));
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());

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
          <button data-action="add-task">+ Add task</button>
          <button data-action="hide-completed" class="${hideCompleted ? 'active' : ''}">${hideCompleted ? 'Showing active only' : 'Hide completed'}</button>
          ${highlightButtonHtml('completed', 'Mark completed')}
          ${highlightButtonHtml('urgent', 'Highlight urgent')}
        </div>
      </div>
      ${saveError ? `<p class="muted" style="color:var(--red); margin-top:8px;">Couldn't save: ${escapeHtml(saveError)}</p>` : ''}

      <div class="row-between" style="margin-top:12px;">
        <div class="range-toggle">
          <button data-view="week" class="${viewMode === 'week' ? 'active' : ''}">Week</button>
          <button data-view="month" class="${viewMode === 'month' ? 'active' : ''}">Month</button>
        </div>
        <div class="cal-nav">
          <button data-action="prev">‹</button>
          <span class="mono cal-range-label">${rangeLabel()}</span>
          <button data-action="today">Today</button>
          <button data-action="next">›</button>
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

    <section class="card">
      ${viewMode === 'week' ? weekViewHtml(tasks) : monthViewHtml(tasks)}
    </section>

    <dialog id="modal-dialog"></dialog>
  `;

  attachEvents();
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
    btn.addEventListener('click', () => {
      const kind = btn.dataset.highlight;
      if (activeHighlight !== kind) {
        activeHighlight = kind;
        const field = HIGHLIGHT_KINDS[kind].field;
        pending = new Set(allTasks.filter((t) => t[field]).map((t) => t.id));
        rebuild();
      } else {
        saveHighlight(kind);
      }
    });
  });

  if (activeHighlight) {
    container.querySelectorAll('.cal-chip.is-highlightable').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.taskId;
        if (pending.has(id)) pending.delete(id);
        else pending.add(id);
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
