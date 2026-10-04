import { store } from '../store.js?v=32';
import { escapeHtml, hexToRgba } from '../format.js?v=32';
import { COURSES, CATEGORIES, FREE_NOTES, PROGRAM_LABELS } from '../roadmapCourses.js?v=32';

const SEMESTERS = [
  { id: 'Y1F', label: 'Y1 Fall' }, { id: 'Y1S', label: 'Y1 Spring' },
  { id: 'Y2F', label: 'Y2 Fall' }, { id: 'Y2S', label: 'Y2 Spring' },
  { id: 'Y3F', label: 'Y3 Fall' }, { id: 'Y3S', label: 'Y3 Spring' },
  { id: 'Y4F', label: 'Y4 Fall' }, { id: 'Y4S', label: 'Y4 Spring' },
];
const PROGRAM_ORDER = ['AE', 'ECE', 'MATH', 'CS'];

let container = null;
let view = 'semesters'; // 'semesters' | 'track'
let markMode = null; // null | 'completed' | 'taking'
let activeSubjects = new Set();
let draggingId = null;

export function render(rootEl) {
  container = rootEl;
  container.closest('#app')?.classList.add('app-wide');
  rebuild();
}

export function unmount() {
  container?.closest('#app')?.classList.remove('app-wide');
  container = null;
}

// Catalog courses (js/roadmapCourses.js) are fixed reference data — only
// their per-user status/semester lives in the synced RoadmapStatus table,
// keyed by the catalog id. A manually-added (Gen Ed) course is
// self-contained in RoadmapCustom instead, carrying its own name/credits.
// Both normalize to the same shape here so the rest of this file (sorting,
// filtering, card rendering, marking) doesn't need to know which is which
// except where `custom` matters (which table to write back to).
function catalogEntries() {
  const byId = new Map(store.table('RoadmapStatus').map((r) => [r.id, r]));
  return COURSES.map((c) => {
    const row = byId.get(c.id);
    return { ...c, status: row?.status || '', semester: row?.semester || '', custom: false };
  });
}

function customEntries() {
  return store.table('RoadmapCustom').map((r) => ({
    id: r.id,
    subject: r.subject,
    number: Number(r.number),
    name: r.name,
    credits: Number(r.credits) || 0,
    programs: [],
    status: r.status || '',
    semester: r.semester || '',
    custom: true,
  }));
}

function allEntries() {
  return [...catalogEntries(), ...customEntries()];
}

function sortEntries(list) {
  return [...list].sort((a, b) => (a.subject === b.subject ? a.number - b.number : a.subject.localeCompare(b.subject)));
}

function allSubjects() {
  return [...new Set(allEntries().map((e) => e.subject))].sort();
}

// Diagonal-stripe overlay for a marked card — same inline
// repeating-linear-gradient technique as the gray "done" stripe on
// Calendar/Canvas chips (see taskChipHtml/eventChipHtml there), just a
// tighter period to match this card's much smaller size, and a purple
// sibling (reusing the purple already used elsewhere in this app, e.g.
// canvas.js's UNLINK_COLOR) for "taking".
function stripeStyle(status) {
  if (status === 'completed') {
    return `background-image: repeating-linear-gradient(45deg, ${hexToRgba('#9b9a97', 0.18)} 0 6px, transparent 6px 12px);`;
  }
  if (status === 'taking') {
    return `background-image: repeating-linear-gradient(45deg, ${hexToRgba('#9b59b6', 0.2)} 0 6px, transparent 6px 12px);`;
  }
  return '';
}

function cardHtml(entry) {
  const numStr = String(entry.number);
  const level = numStr.slice(0, 1);
  const rest = numStr.slice(1);
  const programs = [...new Set(entry.programs.map((p) => p.program))];

  return `
    <div class="rm-card${entry.status ? ` is-${entry.status}` : ''}" style="${stripeStyle(entry.status)}" draggable="true" data-id="${escapeHtml(entry.id)}" title="${escapeHtml(entry.name)}">
      <div class="rm-card-top">
        <span class="rm-subject">${escapeHtml(entry.subject)}</span><span class="rm-level">${escapeHtml(level)}</span><span class="rm-num">${escapeHtml(rest)}</span>
        <span class="rm-credits mono">${entry.credits}cr</span>
      </div>
      <div class="rm-card-name">${escapeHtml(entry.name)}</div>
      ${programs.length ? `<div class="rm-badges">${programs.map((p) => `<span class="rm-badge">${escapeHtml(p)}</span>`).join('')}</div>` : ''}
    </div>
  `;
}

function toggleStatus(entry) {
  if (!entry || !markMode) return;
  const next = entry.status === markMode ? '' : markMode;
  if (entry.custom) store.upsert('RoadmapCustom', { id: entry.id, status: next });
  else store.upsert('RoadmapStatus', { id: entry.id, status: next });
  rebuild();
}

function assignSemester(id, semester) {
  const entry = allEntries().find((e) => e.id === id);
  if (!entry) return;
  if (entry.custom) store.upsert('RoadmapCustom', { id, semester });
  else store.upsert('RoadmapStatus', { id, semester });
  rebuild();
}

function semestersViewHtml(entries) {
  const bySemester = {};
  SEMESTERS.forEach((s) => (bySemester[s.id] = []));
  const unassigned = [];
  entries.forEach((e) => {
    if (e.semester && bySemester[e.semester]) bySemester[e.semester].push(e);
    else unassigned.push(e);
  });

  const columns = SEMESTERS.map((s) => {
    const list = sortEntries(bySemester[s.id]);
    const credits = list.reduce((sum, e) => sum + (e.credits || 0), 0);
    return `
      <div class="rm-semester-col" data-semester="${s.id}">
        <div class="rm-semester-head"><span class="mono">${s.label}</span><span class="muted mono">${credits}cr</span></div>
        <div class="rm-card-grid">${list.map(cardHtml).join('')}</div>
      </div>
    `;
  }).join('');

  return `
    <section class="card">
      <div class="rm-semesters-grid">${columns}</div>
    </section>
    <section class="card rm-pool" data-semester="">
      <h2 class="mono">Unassigned</h2>
      <div class="rm-card-grid">${sortEntries(unassigned).map(cardHtml).join('')}</div>
    </section>
  `;
}

// `full` (every entry, ignoring the subject filter) drives the fulfillment
// math — a category's green/not-green state must never change just
// because the subject filter happens to be hiding some of its courses.
function categoryFulfillment(program, category, full) {
  const def = CATEGORIES.find((c) => c.program === program && c.category === category);
  const tagged = full.filter((e) => e.programs.some((p) => p.program === program && p.category === category));
  const completed = tagged.filter((e) => e.status === 'completed');
  const taking = tagged.filter((e) => e.status === 'taking');

  if (def.requiredCredits != null) {
    const completedCredits = completed.reduce((sum, e) => sum + (e.credits || 0), 0);
    return {
      tagged,
      met: completedCredits >= def.requiredCredits,
      progressText: `${completedCredits}/${def.requiredCredits}cr completed${taking.length ? `, ${taking.length} taking` : ''}`,
    };
  }
  return {
    tagged,
    met: completed.length >= def.required,
    progressText: `${completed.length}/${def.required} completed${taking.length ? `, ${taking.length} taking` : ''}`,
  };
}

function trackViewHtml(full, visible) {
  const visibleIds = new Set(visible.map((e) => e.id));

  return PROGRAM_ORDER.map((program) => {
    const categoriesHtml = CATEGORIES.filter((c) => c.program === program).map((cat) => {
      const { tagged, met, progressText } = categoryFulfillment(program, cat.category, full);
      const visibleTagged = sortEntries(tagged.filter((e) => visibleIds.has(e.id)));
      if (!visibleTagged.length) return ''; // subject filter hid every course in this category

      return `
        <div class="rm-category${met ? ' is-met' : ''}">
          <div class="rm-category-head"><span class="mono">${escapeHtml(cat.category)}</span><span class="muted mono">${escapeHtml(progressText)}</span></div>
          <div class="rm-card-grid">${visibleTagged.map(cardHtml).join('')}</div>
        </div>
      `;
    }).join('');

    const notesHtml = FREE_NOTES.filter((n) => n.program === program)
      .map((n) => `<p class="muted">${escapeHtml(n.label)} — ${n.credits} hrs (any eligible course; not tracked here)</p>`)
      .join('');

    return `
      <section class="card">
        <h2 class="mono">${escapeHtml(PROGRAM_LABELS[program])}</h2>
        ${categoriesHtml}
        ${notesHtml}
      </section>
    `;
  }).join('');
}

function headerHtml() {
  return `
    <section class="card">
      <div class="row-between">
        <h1 class="mono">Roadmap</h1>
        <div class="range-toggle">
          <button data-action="view" data-view="semesters" class="${view === 'semesters' ? 'active' : ''}">Semesters</button>
          <button data-action="view" data-view="track" class="${view === 'track' ? 'active' : ''}">Track</button>
        </div>
      </div>
      <div class="range-toggle" style="margin-top:8px;">
        <button data-action="mark" data-mark="completed" class="${markMode === 'completed' ? 'active' : ''}">Mark Complete</button>
        <button data-action="mark" data-mark="taking" class="${markMode === 'taking' ? 'active' : ''}">Mark Taking</button>
      </div>
    </section>
  `;
}

function footerHtml() {
  const subjects = allSubjects();
  return `
    <section class="card">
      <div class="row-between">
        <h2 class="mono">Filter</h2>
        <button data-action="add-course">+ Add course</button>
      </div>
      <div class="range-toggle" style="flex-wrap:wrap; gap:6px;">
        <button data-action="subject-filter" data-subject="" class="${activeSubjects.size === 0 ? 'active' : ''}">All</button>
        ${subjects.map((s) => `<button data-action="subject-filter" data-subject="${escapeHtml(s)}" class="${activeSubjects.has(s) ? 'active' : ''}">${escapeHtml(s)}</button>`).join('')}
      </div>
    </section>
    <dialog id="modal-dialog"></dialog>
  `;
}

function rebuild() {
  const full = allEntries();
  const visible = sortEntries(full.filter((e) => !activeSubjects.size || activeSubjects.has(e.subject)));

  container.innerHTML = `
    ${headerHtml()}
    ${view === 'semesters' ? semestersViewHtml(visible) : trackViewHtml(full, visible)}
    ${footerHtml()}
  `;

  attachEvents(full);
}

function openAddDialog() {
  const dialog = container.querySelector('#modal-dialog');

  dialog.innerHTML = `
    <form method="dialog" class="modal-form">
      <h2 class="mono">Add course</h2>
      <p class="muted">For anything outside the AE/ECE/Math/CS catalog this page already knows — Gen Eds, free electives, etc.</p>
      <div class="field-row">
        <label>Subject <input type="text" name="subject" placeholder="RHET" required></label>
        <label>Number <input type="number" name="number" placeholder="105" required></label>
      </div>
      <label>Name <input type="text" name="name" placeholder="Composition I" required></label>
      <label>Credits <input type="number" name="credits" step="any" min="0" value="3" required></label>
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
    const subject = String(data.get('subject')).toUpperCase().trim();
    const number = Number(data.get('number'));
    const id = `CUSTOM_${subject}${number}_${Date.now().toString(36)}`;
    store.upsert('RoadmapCustom', {
      id,
      subject,
      number,
      name: data.get('name'),
      credits: Number(data.get('credits')),
      status: '',
      semester: '',
    });
    rebuild();
  });

  dialog.showModal();
}

function attachEvents(full) {
  container.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      view = btn.dataset.view;
      rebuild();
    });
  });

  container.querySelectorAll('[data-action="mark"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      markMode = markMode === btn.dataset.mark ? null : btn.dataset.mark;
      rebuild();
    });
  });

  container.querySelectorAll('[data-action="subject-filter"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const subject = btn.dataset.subject;
      if (!subject) activeSubjects = new Set();
      else if (activeSubjects.has(subject)) activeSubjects.delete(subject);
      else activeSubjects.add(subject);
      rebuild();
    });
  });

  container.querySelector('[data-action="add-course"]')?.addEventListener('click', openAddDialog);

  container.querySelectorAll('.rm-card').forEach((el) => {
    const entry = full.find((e) => e.id === el.dataset.id);
    el.addEventListener('click', () => toggleStatus(entry));
    el.addEventListener('dragstart', (e) => {
      draggingId = el.dataset.id;
      e.dataTransfer.setData('text/plain', el.dataset.id);
    });
  });

  container.querySelectorAll('[data-semester]').forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-drag-over');
      const id = e.dataTransfer.getData('text/plain') || draggingId;
      if (id) assignSemester(id, zone.dataset.semester);
      draggingId = null;
    });
  });
}
