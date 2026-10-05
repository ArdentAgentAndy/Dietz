import { store } from '../store.js?v=48';
import { computeGrade, itemStatus } from '../grading.js?v=48';
import { getCourseState, setCourseState } from '../courseState.js?v=48';
import { escapeHtml } from '../format.js?v=48';

let container = null;
let courseId = null;

export function render(rootEl, params) {
  container = rootEl;
  courseId = params.id;
  rebuild();
}

export function unmount() {
  container = null;
  courseId = null;
}

function ruleTagsHtml(component) {
  const tags = [];
  if (component.dropLowest) tags.push(`drop lowest ${component.dropLowest}`);
  if (component.cap != null) tags.push(`cap ${component.cap}`);
  if (component.excusable) tags.push('excusable');
  return tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
}

function componentSummaryHtml(component, result, config) {
  if (config.type === 'weighted') {
    const nominal = `${component.weight}%`;
    if (!result.graded) return `<span class="muted">Weight ${nominal} · no graded items yet</span>`;
    const contribution = ((component.weight * result.percent) / 100).toFixed(2);
    return `<span class="muted">Weight ${nominal} · current ${result.percent.toFixed(1)}% · contributes ${contribution} of ${nominal}</span>`;
  }
  const nominal = `${component.possible} pts`;
  if (!result.graded) return `<span class="muted">Possible ${nominal} · no graded items yet</span>`;
  return `<span class="muted">${result.earned}/${result.possible} pts graded (of ${nominal} max)</span>`;
}

function itemRowHtml(item, status) {
  const muted = status === 'dropped' || status === 'excused';
  const tag =
    status === 'dropped'
      ? '<span class="tag tag-dropped">dropped</span>'
      : status === 'excused'
        ? '<span class="tag tag-excused">excused</span>'
        : '';
  const percentText =
    status === 'ungraded'
      ? '—'
      : status === 'excused'
        ? 'excused'
        : item.possible
          ? `${Math.round((item.earned / item.possible) * 1000) / 10}%`
          : '—';
  const scoreText = status === 'ungraded' ? '—' : `${item.earned}/${item.possible}`;

  return `
    <tr class="${muted ? 'item-row-muted' : ''}">
      <td>${escapeHtml(item.name)} ${tag}</td>
      <td>${scoreText}</td>
      <td>${percentText}</td>
      <td>${item.dueDate ? escapeHtml(item.dueDate) : ''}</td>
      <td class="item-actions">
        <button data-action="edit-item" data-item-id="${item.id}">Edit</button>
        <button data-action="delete-item" data-item-id="${item.id}">Delete</button>
      </td>
    </tr>
  `;
}

function componentSectionHtml(component, config, allItems, grade) {
  const result = grade.components.find((c) => c.id === component.id);
  const items = allItems.filter((i) => i.componentId === component.id);
  const statusMap = itemStatus(component, items);
  const sortedItems = [...items].sort(
    (a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || a.name.localeCompare(b.name, undefined, { numeric: true })
  );

  return `
    <div class="component-section" data-component-id="${component.id}">
      <div class="row-between">
        <h3 class="mono">${escapeHtml(component.name)}</h3>
        <div class="component-actions">
          <button data-action="add-item" data-component-id="${component.id}">+ Add item</button>
          <button data-action="bulk-add" data-component-id="${component.id}">+ Bulk add</button>
        </div>
      </div>
      <div class="rule-tags">${ruleTagsHtml(component)}</div>
      <p>${componentSummaryHtml(component, result, config)}</p>
      ${
        items.length
          ? `<table class="item-table">
              <thead><tr><th>Name</th><th>Score</th><th>%</th><th>Due</th><th></th></tr></thead>
              <tbody>${sortedItems.map((i) => itemRowHtml(i, statusMap.get(i.id))).join('')}</tbody>
            </table>`
          : '<p class="muted">No items yet.</p>'
      }
    </div>
  `;
}

function extrasFieldHtml(kind, extra, courseState) {
  if (!extra) return '';
  const value = courseState[extra.stateKey] ?? '';
  const hints = [];
  if (extra.cap != null) hints.push(`capped at ${extra.cap}`);
  if (extra.max != null) hints.push(`capped at ${extra.max}`);
  if (extra.freeUnits != null) hints.push(`first ${extra.freeUnits} free`);
  if (extra.amountPerUnit != null) hints.push(`${extra.amountPerUnit} pt${extra.amountPerUnit === 1 ? '' : 's'} per unit`);
  const label = extra.counter ? `${extra.label} (count)` : extra.label || kind;

  return `
    <label class="extras-field">
      ${escapeHtml(label)}${hints.length ? ` <span class="muted">(${hints.join(', ')})</span>` : ''}
      <input type="number" step="any" data-state-key="${extra.stateKey}" value="${value}">
    </label>
  `;
}

function rebuild() {
  const course = store.table('Courses').find((c) => c.id === courseId);

  if (!course) {
    container.innerHTML = `<p class="muted">Course not found. <a href="#/courses">Back to courses</a></p>`;
    return;
  }

  const config = JSON.parse(course.configJson);
  const items = store.table('Items').filter((i) => i.courseId === courseId);
  const courseState = getCourseState(courseId);
  const grade = computeGrade(config, items, courseState);

  const gradeText = course.finalLetter
    ? `${course.finalLetter} (final)`
    : grade.hasGradedWork
      ? `${grade.percent.toFixed(1)}% (${grade.letter})`
      : 'No grade yet';

  const letterOptions = [...config.cutoffs.map(([l]) => l), 'F'];

  const extrasHtml = [
    extrasFieldHtml('bonus', config.bonus, courseState),
    extrasFieldHtml('extra credit', config.extraCredit, courseState),
    extrasFieldHtml('penalty', config.penalty, courseState),
  ]
    .filter(Boolean)
    .join('');

  container.innerHTML = `
    <section class="card">
      <h1 class="mono">${escapeHtml(course.code)}${course.status === 'archived' ? ' <span class="tag">archived</span>' : ''}</h1>
      <p class="muted">${escapeHtml(course.name)} — ${course.credits} cr, ${escapeHtml(course.term)}</p>
      <p class="mono" style="font-size:20px;">${gradeText}</p>
      <label class="final-letter-field muted">Final letter override (once the course is done)
        <select data-action="final-letter">
          <option value="">Use computed grade</option>
          ${letterOptions.map((l) => `<option value="${l}" ${course.finalLetter === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
    </section>

    ${config.components.map((c) => `<section class="card">${componentSectionHtml(c, config, items, grade)}</section>`).join('')}

    ${
      extrasHtml
        ? `<section class="card">
            <h2 class="mono">Extras</h2>
            <div class="extras-grid">${extrasHtml}</div>
          </section>`
        : ''
    }

    ${
      config.notes
        ? `<section class="card">
            <details>
              <summary class="mono">Syllabus notes</summary>
              <p class="muted">${escapeHtml(config.notes)}</p>
            </details>
          </section>`
        : ''
    }

    <dialog id="modal-dialog"></dialog>
  `;

  attachEvents(course, config);
}

function attachEvents(course, config) {
  container.querySelector('[data-action="final-letter"]')?.addEventListener('change', (e) => {
    store.upsert('Courses', { id: courseId, finalLetter: e.target.value });
    rebuild();
  });

  container.querySelectorAll('[data-action="add-item"]').forEach((btn) => {
    btn.addEventListener('click', () => openItemDialog(config, btn.dataset.componentId));
  });

  container.querySelectorAll('[data-action="bulk-add"]').forEach((btn) => {
    btn.addEventListener('click', () => openBulkAddDialog(btn.dataset.componentId));
  });

  container.querySelectorAll('[data-action="edit-item"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = store.table('Items').find((i) => i.id === btn.dataset.itemId);
      if (item) openItemDialog(config, item.componentId, item);
    });
  });

  container.querySelectorAll('[data-action="delete-item"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (confirm('Delete this item?')) {
        store.remove('Items', btn.dataset.itemId);
        rebuild();
      }
    });
  });

  container.querySelectorAll('[data-state-key]').forEach((input) => {
    input.addEventListener('change', () => {
      setCourseState(courseId, input.dataset.stateKey, input.value === '' ? 0 : Number(input.value));
      rebuild();
    });
  });
}

function openItemDialog(config, componentId, existing = null) {
  const component = config.components.find((c) => c.id === componentId);
  const dialog = container.querySelector('#modal-dialog');

  dialog.innerHTML = `
    <form method="dialog" class="modal-form">
      <h2 class="mono">${existing ? 'Edit item' : 'Add item'} — ${escapeHtml(component.name)}</h2>
      <label>Name <input type="text" name="name" value="${existing ? escapeHtml(existing.name) : ''}" required></label>
      <div class="field-row">
        <label>Earned <input type="number" step="any" name="earned" value="${existing?.earned ?? ''}" placeholder="blank = ungraded"></label>
        <label>Possible <input type="number" step="any" name="possible" value="${existing?.possible ?? (component.itemPoints ?? '')}" required></label>
      </div>
      <label>Due date (optional) <input type="date" name="dueDate" value="${existing?.dueDate || ''}"></label>
      ${component.excusable ? `<label class="checkbox-label"><input type="checkbox" name="excused" ${existing?.excused ? 'checked' : ''}> Excused</label>` : ''}
      <div class="modal-actions">
        <button type="button" data-action="cancel">Cancel</button>
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>
  `;

  const form = dialog.querySelector('form');
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', () => {
    const data = new FormData(form);
    store.upsert('Items', {
      id: existing?.id,
      courseId,
      componentId,
      name: data.get('name'),
      earned: data.get('earned') === '' ? '' : Number(data.get('earned')),
      possible: Number(data.get('possible')),
      excused: component.excusable ? data.get('excused') === 'on' : false,
      dueDate: data.get('dueDate') || '',
      note: existing?.note || '',
    });
    rebuild();
  });

  dialog.showModal();
}

function openBulkAddDialog(componentId) {
  const dialog = container.querySelector('#modal-dialog');

  dialog.innerHTML = `
    <form method="dialog" class="modal-form">
      <h2 class="mono">Bulk add items</h2>
      <label>Name prefix <input type="text" name="prefix" placeholder="Quiz" required></label>
      <div class="field-row">
        <label>Count <input type="number" name="count" min="1" step="1" value="1" required></label>
        <label>Start at # <input type="number" name="start" min="1" step="1" value="1" required></label>
      </div>
      <label>Possible (each) <input type="number" step="any" name="possible" required></label>
      <p class="muted">Creates ungraded items named "Prefix N" through "Prefix N+count-1".</p>
      <div class="modal-actions">
        <button type="button" data-action="cancel">Cancel</button>
        <button type="submit" class="btn-primary">Add</button>
      </div>
    </form>
  `;

  const form = dialog.querySelector('form');
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', () => {
    const data = new FormData(form);
    const count = Number(data.get('count'));
    const start = Number(data.get('start'));
    const possible = Number(data.get('possible'));
    const prefix = data.get('prefix');

    for (let n = start; n < start + count; n++) {
      store.upsert('Items', {
        courseId,
        componentId,
        name: `${prefix} ${n}`,
        earned: '',
        possible,
        excused: false,
        dueDate: '',
        note: '',
      });
    }
    rebuild();
  });

  dialog.showModal();
}
