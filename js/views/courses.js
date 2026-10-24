import { store } from '../store.js?v=64';
import { STANDARD_CUTOFFS, TERM } from '../seed.js?v=64';
import { clearCourseState, getCourseState } from '../courseState.js?v=64';
import { escapeHtml, hexToRgba } from '../format.js?v=64';
import { computeGrade } from '../grading.js?v=64';
import { computeSemesterGPA, computeCumulativeGPA } from '../gpa.js?v=64';
import { hexForCourse, COLOR_PALETTE } from '../notionColors.js?v=64';

let container = null;
let draftComponents = [{ name: '', value: '', dropLowest: '', cap: '', excusable: false }];

export function render(rootEl) {
  container = rootEl;
  rebuild();
}

export function unmount() {
  container = null;
}

// Same column-grid technique css/styles.css's .class-list already uses for
// Lessons (grid on the list, each row display:contents so its cells become
// direct grid items and line up across rows) — Reorder/Color/Course/Name/
// Credits/Archive/Delete, with the course's own color (hexForCourse — a
// custom course.color if set via the swatch button, else the fixed
// Notion-matching default) as a left-border accent on the code cell.
function courseRowHtml(course, isFirst, isLast) {
  const color = hexForCourse(course);
  const bg = hexToRgba(color, 0.08);
  return `
    <div class="course-row${course.status === 'archived' ? ' is-archived' : ''}">
      <span class="course-cell course-cell-reorder" style="background:${bg};">
        <button data-action="move-up" data-id="${course.id}" ${isFirst ? 'disabled' : ''} title="Move up">&uarr;</button>
        <button data-action="move-down" data-id="${course.id}" ${isLast ? 'disabled' : ''} title="Move down">&darr;</button>
      </span>
      <button type="button" class="course-cell course-cell-color" data-action="pick-color" data-id="${course.id}" style="background:${bg};" title="Change color">
        <span class="course-color-swatch" style="background:${color};"></span>
      </button>
      <a class="course-cell course-cell-code mono" href="#/course/${course.id}" style="background:${bg}; color:${color}; --cell-color:${color};">${escapeHtml(course.code)}</a>
      <span class="course-cell course-cell-name" style="background:${bg};">${escapeHtml(course.name)}</span>
      <span class="course-cell course-cell-credits muted mono" style="background:${bg};">${course.credits} cr</span>
      <span class="course-cell course-cell-archive" style="background:${bg};">
        ${course.status === 'active'
          ? `<button data-action="archive" data-id="${course.id}">Archive</button>`
          : `<button data-action="unarchive" data-id="${course.id}">Unarchive</button>`}
      </span>
      <span class="course-cell course-cell-delete" style="background:${bg};">
        <button data-action="delete" data-id="${course.id}">Delete</button>
      </span>
    </div>
  `;
}

function courseTableHeadHtml() {
  return `
    <div class="course-row course-row-head">
      <span class="course-cell course-cell-reorder"></span>
      <span class="course-cell course-cell-color"></span>
      <span class="course-cell course-cell-code muted mono">Course</span>
      <span class="course-cell course-cell-name muted mono">Name</span>
      <span class="course-cell course-cell-credits muted mono">Credits</span>
      <span class="course-cell course-cell-archive"></span>
      <span class="course-cell course-cell-delete"></span>
    </div>
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
      <div class="course-table">${courseTableHeadHtml()}${active.map((c, i) => courseRowHtml(c, i === 0, i === active.length - 1)).join('')}</div>
      ${archived.length ? `<h2 class="mono" style="margin-top:16px;">Archived</h2><div class="course-table">${courseTableHeadHtml()}${archived.map((c, i) => courseRowHtml(c, i === 0, i === archived.length - 1)).join('')}</div>` : ''}
    </section>

    ${coursesAndGpaHtml()}

    <dialog id="modal-dialog"></dialog>
  `;

  attachEvents();
}

// Swaps sortOrder with the adjacent course within the same active/archived
// group (the two groups are rendered as separate lists, so "adjacent" means
// adjacent within whichever group the button is in).
function moveCourse(courseId, direction) {
  const courses = [...store.table('Courses')].sort((a, b) => a.sortOrder - b.sortOrder);
  const course = courses.find((c) => c.id === courseId);
  if (!course) return;
  const group = courses.filter((c) => c.status === course.status);
  const idx = group.findIndex((c) => c.id === courseId);
  const other = group[idx + direction];
  if (!other) return;
  store.upsert('Courses', { id: course.id, sortOrder: other.sortOrder });
  store.upsert('Courses', { id: other.id, sortOrder: course.sortOrder });
  rebuild();
}

function openColorDialog(courseId) {
  const course = store.table('Courses').find((c) => c.id === courseId);
  if (!course) return;
  const current = course.color || null;
  const dialog = container.querySelector('#modal-dialog');

  dialog.innerHTML = `
    <form method="dialog" class="modal-form">
      <h2 class="mono">${escapeHtml(course.code)} color</h2>
      <div class="color-swatch-grid">
        ${COLOR_PALETTE.map(
          (p) => `<button type="button" class="color-swatch-option${current === p.name ? ' is-selected' : ''}" data-color="${p.name}" style="background:${p.hex};" title="${p.name}"></button>`
        ).join('')}
      </div>
      <div class="modal-actions">
        <button type="button" data-action="reset-color">Use default</button>
        <button type="button" data-action="cancel">Cancel</button>
      </div>
    </form>
  `;

  dialog.querySelectorAll('[data-color]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.upsert('Courses', { id: courseId, color: btn.dataset.color });
      dialog.close();
      rebuild();
    });
  });
  dialog.querySelector('[data-action="reset-color"]').addEventListener('click', () => {
    store.upsert('Courses', { id: courseId, color: '' });
    dialog.close();
    rebuild();
  });
  dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());

  dialog.showModal();
}

function courseGradeCardHtml(course, grade) {
  const gradeText = course.finalLetter
    ? `${course.finalLetter} (final)`
    : grade.hasGradedWork
      ? `${grade.percent.toFixed(1)}% (${grade.letter})`
      : 'No grade yet';
  // Same color every other page already uses for this course (Calendar/
  // Canvas/Lessons, via hexForCourse — see notionColors.js) so a course
  // reads as one consistent color everywhere in the app, not a new one
  // invented just for this card.
  const color = hexForCourse(course);
  return `
    <a class="course-grade-card" href="#/course/${course.id}" style="border-color:${hexToRgba(color, 0.5)}; background:${hexToRgba(color, 0.1)};">
      <span class="mono" style="color:${color};">${escapeHtml(course.code)}</span>
      <span class="muted">${gradeText}</span>
      <span class="muted">${course.credits} cr</span>
    </a>
  `;
}

// Exported for the Home dashboard's read-only mirror of this section — pure
// function of store state, safe to call from anywhere with no side effects.
export function coursesAndGpaHtml() {
  const allCourses = store.table('Courses');
  const allItems = store.table('Items');
  const courseStateByCourseId = {};
  for (const c of allCourses) courseStateByCourseId[c.id] = getCourseState(c.id);

  const activeCourses = allCourses.filter((c) => c.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder);
  const cards = activeCourses
    .map((course) => {
      const config = JSON.parse(course.configJson);
      const items = allItems.filter((i) => i.courseId === course.id);
      const grade = computeGrade(config, items, courseStateByCourseId[course.id]);
      return courseGradeCardHtml(course, grade);
    })
    .join('');

  const semester = computeSemesterGPA(activeCourses, allItems, courseStateByCourseId);
  const finishedCourses = allCourses.filter((c) => c.status === 'archived' && c.finalLetter);
  const cumulative = computeCumulativeGPA(store.table('PastTerms'), finishedCourses, semester);

  return `
    <section class="card">
      <h2 class="mono">Grades</h2>
      <div class="course-grade-grid">${cards || '<p class="muted">No active courses.</p>'}</div>
      <div class="gpa-row">
        <span class="muted">Semester GPA <span class="mono">${semester.gpa != null ? semester.gpa.toFixed(2) : '—'}</span></span>
        <span class="muted">Cumulative GPA <span class="mono">${cumulative != null ? cumulative.toFixed(2) : '—'}</span></span>
      </div>
    </section>
  `;
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

  container.querySelectorAll('[data-action="move-up"]').forEach((btn) => {
    btn.addEventListener('click', () => moveCourse(btn.dataset.id, -1));
  });

  container.querySelectorAll('[data-action="move-down"]').forEach((btn) => {
    btn.addEventListener('click', () => moveCourse(btn.dataset.id, 1));
  });

  container.querySelectorAll('[data-action="pick-color"]').forEach((btn) => {
    btn.addEventListener('click', () => openColorDialog(btn.dataset.id));
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
        <label>Cap <input type="number" min="0" data-field="cap" data-index="${i}" value="${c.cap}"></label>
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
    c.cap = form.querySelector(`[data-field="cap"][data-index="${i}"]`)?.value ?? c.cap;
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
    draftComponents.push({ name: '', value: '', dropLowest: '', cap: '', excusable: false });
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
      if (c.dropLowest) comp.dropLowest = Number(c.dropLowest);
      if (c.cap) comp.cap = Number(c.cap);
      if (type === 'weighted') {
        comp.weight = Number(c.value);
        if (c.excusable) comp.excusable = true;
      } else {
        comp.possible = Number(c.value);
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

  draftComponents = [{ name: '', value: '', dropLowest: '', cap: '', excusable: false }];
  rebuild();
}

function openAddCourseDialog() {
  draftComponents = [{ name: '', value: '', dropLowest: '', cap: '', excusable: false }];
  const dialog = container.querySelector('#modal-dialog');
  renderAddCourseForm(dialog);
  dialog.showModal();
}
