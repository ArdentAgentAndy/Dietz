import { store } from '../store.js?v=19';
import { STANDARD_CUTOFFS, TERM } from '../seed.js?v=19';
import { clearCourseState } from '../courseState.js?v=19';
import { escapeHtml } from '../format.js?v=19';

let container = null;
let draftComponents = [{ name: '', value: '', dropLowest: '', bestOf: '', cap: '', excusable: false }];

export function render(rootEl) {
  container = rootEl;
  rebuild();
}

export function unmount() {
  container = null;
}

function courseRowHtml(course) {
  return `
    <li class="course-list-item${course.status === 'archived' ? ' is-archived' : ''}">
      <a href="#/course/${course.id}">${escapeHtml(course.code)}</a> — ${escapeHtml(course.name)}
      <span class="muted">(${course.credits} cr, ${escapeHtml(course.term)}${course.status === 'archived' ? ', archived' : ''})</span>
      <span class="course-row-actions">
        ${course.status === 'active'
          ? `<button data-action="archive" data-id="${course.id}">Archive</button>`
          : `<button data-action="unarchive" data-id="${course.id}">Unarchive</button>`}
        <button data-action="delete" data-id="${course.id}">Delete</button>
      </span>
    </li>
  `;
}

function rebuild() {
  const courses = [...store.table('Courses')].sort((a, b) => a.sortOrder - b.sortOrder);
  const active = courses.filter((c) => c.status === 'active');
  const archived = courses.filter((c) => c.status === 'archived');

  container.innerHTML = `
    <section class="card">
      <div class="row-between">
        <h1 class="mono">Courses</h1>
        <button data-action="add-course">+ Add course</button>
      </div>
      <ul class="course-list">${active.map(courseRowHtml).join('')}</ul>
      ${archived.length ? `<h2 class="mono" style="margin-top:16px;">Archived</h2><ul class="course-list">${archived.map(courseRowHtml).join('')}</ul>` : ''}
    </section>

    <dialog id="modal-dialog"></dialog>
  `;

  attachEvents();
}

function attachEvents() {
  container.querySelector('[data-action="add-course"]')?.addEventListener('click', openAddCourseDialog);

  container.querySelectorAll('[data-action="archive"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.upsert('Courses', { id: btn.dataset.id, status: 'archived' });
      rebuild();
    });
  });

  container.querySelectorAll('[data-action="unarchive"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.upsert('Courses', { id: btn.dataset.id, status: 'active' });
      rebuild();
    });
  });

  container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => deleteCourse(btn.dataset.id));
  });
}

function deleteCourse(courseId) {
  const course = store.table('Courses').find((c) => c.id === courseId);
  if (!course) return;
  if (!confirm(`Delete ${course.code}? This removes all its graded items. Session history is kept.`)) return;
  deleteCourseById(courseId);
  rebuild();
}

// Shared with the home page's per-card manage dialog — keeps the "what
// actually happens on delete" logic in one place.
export function archiveCourseById(courseId) {
  store.upsert('Courses', { id: courseId, status: 'archived' });
}

export function unarchiveCourseById(courseId) {
  store.upsert('Courses', { id: courseId, status: 'active' });
}

export function deleteCourseById(courseId) {
  for (const item of store.table('Items').filter((i) => i.courseId === courseId)) {
    store.remove('Items', item.id);
  }
  clearCourseState(courseId);

  const revisionCategory = store.table('Categories').find((c) => c.group === 'revision' && c.courseId === courseId);
  if (revisionCategory) store.upsert('Categories', { id: revisionCategory.id, archived: true });

  store.remove('Courses', courseId);
}

function componentRowsHtml(type) {
  const valueLabel = type === 'weighted' ? 'Weight %' : 'Possible pts';
  return draftComponents
    .map(
      (c, i) => `
    <div class="component-row" data-index="${i}">
      <div class="component-row-main">
        <input type="text" placeholder="Component name" data-field="name" data-index="${i}" value="${escapeHtml(c.name)}">
        <input type="number" placeholder="${valueLabel}" data-field="value" data-index="${i}" value="${c.value}" min="0" step="any">
        <button type="button" data-action="remove-component" data-index="${i}">&times;</button>
      </div>
      <div class="component-row-rules">
        <label>Drop lowest <input type="number" min="0" data-field="dropLowest" data-index="${i}" value="${c.dropLowest}"></label>
        <label>Best of <input type="number" min="0" data-field="bestOf" data-index="${i}" value="${c.bestOf}"></label>
        ${type === 'points' ? `<label>Cap <input type="number" min="0" data-field="cap" data-index="${i}" value="${c.cap}"></label>` : ''}
        ${type === 'weighted' ? `<label class="checkbox-label"><input type="checkbox" data-field="excusable" data-index="${i}" ${c.excusable ? 'checked' : ''}> Excusable</label>` : ''}
      </div>
    </div>
  `
    )
    .join('');
}

function readDraftFromForm(form, type) {
  draftComponents.forEach((c, i) => {
    c.name = form.querySelector(`[data-field="name"][data-index="${i}"]`)?.value ?? c.name;
    c.value = form.querySelector(`[data-field="value"][data-index="${i}"]`)?.value ?? c.value;
    c.dropLowest = form.querySelector(`[data-field="dropLowest"][data-index="${i}"]`)?.value ?? c.dropLowest;
    c.bestOf = form.querySelector(`[data-field="bestOf"][data-index="${i}"]`)?.value ?? c.bestOf;
    if (type === 'points') c.cap = form.querySelector(`[data-field="cap"][data-index="${i}"]`)?.value ?? c.cap;
    if (type === 'weighted') c.excusable = form.querySelector(`[data-field="excusable"][data-index="${i}"]`)?.checked ?? c.excusable;
  });
}

function renderAddCourseForm(dialog, values = {}) {
  const type = values.type || 'weighted';
  dialog.innerHTML = `
    <form method="dialog" class="modal-form">
      <h2 class="mono">Add course</h2>
      <div class="field-row">
        <label>Code <input type="text" name="code" placeholder="MATH 999" value="${escapeHtml(values.code || '')}" required></label>
        <label>Credits <input type="number" name="credits" min="0" step="1" value="${values.credits || ''}" required></label>
      </div>
      <label>Name <input type="text" name="name" placeholder="Course name" value="${escapeHtml(values.name || '')}" required></label>
      <div class="field-row">
        <label>Term <input type="text" name="term" value="${escapeHtml(values.term || TERM)}" required></label>
        <label>Type
          <select name="type">
            <option value="weighted" ${type === 'weighted' ? 'selected' : ''}>Weighted</option>
            <option value="points" ${type === 'points' ? 'selected' : ''}>Points</option>
          </select>
        </label>
      </div>

      <div class="components-builder">
        <h3 class="mono">Components</h3>
        <div data-components>${componentRowsHtml(type)}</div>
        <button type="button" data-action="add-component">+ Add component</button>
      </div>

      <div class="modal-actions">
        <button type="button" data-action="cancel">Cancel</button>
        <button type="submit" class="btn-primary">Add course</button>
      </div>
    </form>
  `;

  const form = dialog.querySelector('form');

  form.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());

  form.querySelector('select[name="type"]').addEventListener('change', (e) => {
    readDraftFromForm(form, type);
    renderAddCourseForm(dialog, { ...readBasicFields(form), type: e.target.value });
  });

  form.querySelector('[data-action="add-component"]').addEventListener('click', () => {
    readDraftFromForm(form, type);
    draftComponents.push({ name: '', value: '', dropLowest: '', bestOf: '', cap: '', excusable: false });
    renderAddCourseForm(dialog, readBasicFields(form));
  });

  form.querySelectorAll('[data-action="remove-component"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      readDraftFromForm(form, type);
      const idx = Number(btn.dataset.index);
      if (draftComponents.length > 1) draftComponents.splice(idx, 1);
      renderAddCourseForm(dialog, readBasicFields(form));
    });
  });

  form.addEventListener('submit', () => {
    readDraftFromForm(form, type);
    submitNewCourse(readBasicFields(form), type);
  });
}

function readBasicFields(form) {
  return {
    code: form.querySelector('[name="code"]').value,
    name: form.querySelector('[name="name"]').value,
    credits: form.querySelector('[name="credits"]').value,
    term: form.querySelector('[name="term"]').value,
  };
}

function submitNewCourse(fields, type) {
  const components = draftComponents
    .filter((c) => c.name.trim() && c.value !== '')
    .map((c, i) => {
      const comp = { id: `c${i}`, name: c.name.trim() };
      if (type === 'weighted') {
        comp.weight = Number(c.value);
        if (c.dropLowest) comp.dropLowest = Number(c.dropLowest);
        if (c.bestOf) comp.bestOf = Number(c.bestOf);
        if (c.excusable) comp.excusable = true;
      } else {
        comp.possible = Number(c.value);
        if (c.dropLowest) comp.dropLowest = Number(c.dropLowest);
        if (c.bestOf) comp.bestOf = Number(c.bestOf);
        if (c.cap) comp.cap = Number(c.cap);
      }
      return comp;
    });

  if (!components.length) {
    alert('Add at least one component with a name and a value.');
    return;
  }

  const config = { type, rounding: 'none', cutoffs: STANDARD_CUTOFFS, components };
  const courseId = crypto.randomUUID();
  const maxSort = Math.max(0, ...store.table('Courses').map((c) => c.sortOrder || 0));

  store.upsert('Courses', {
    id: courseId,
    code: fields.code.trim(),
    name: fields.name.trim(),
    credits: Number(fields.credits),
    term: fields.term.trim(),
    status: 'active',
    finalLetter: '',
    sortOrder: maxSort + 1,
    configJson: JSON.stringify(config),
  });

  store.upsert('Categories', {
    id: `revision-${courseId}`,
    group: 'revision',
    name: fields.code.trim(),
    courseId,
    archived: false,
  });

  draftComponents = [{ name: '', value: '', dropLowest: '', bestOf: '', cap: '', excusable: false }];
  rebuild();
}

function openAddCourseDialog() {
  draftComponents = [{ name: '', value: '', dropLowest: '', bestOf: '', cap: '', excusable: false }];
  const dialog = container.querySelector('#modal-dialog');
  renderAddCourseForm(dialog);
  dialog.showModal();
}
