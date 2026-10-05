import { store } from '../store.js?v=47';
import { escapeHtml, hexToRgba } from '../format.js?v=47';
import { COURSES, CATEGORIES, FREE_NOTES, PROGRAM_LABELS } from '../roadmapCourses.js?v=47';

const SEMESTERS = [
  { id: 'Y1F', label: 'Y1 Fall' }, { id: 'Y1S', label: 'Y1 Spring' },
  { id: 'Y2F', label: 'Y2 Fall' }, { id: 'Y2S', label: 'Y2 Spring' },
  { id: 'Y3F', label: 'Y3 Fall' }, { id: 'Y3S', label: 'Y3 Spring' },
  { id: 'Y4F', label: 'Y4 Fall' }, { id: 'Y4S', label: 'Y4 Spring' },
];
const PROGRAM_ORDER = ['AE', 'ECE', 'MATH', 'CS'];

let container = null;
let view = 'semesters'; // 'semesters' | 'track' | 'possible'
let markMode = null; // null | 'completed' | 'taking'
let activeSubjects = new Set();
let searchQuery = '';
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

// Matches subject+number (e.g. "ae311" or "AE 311") or the course name.
function matchesSearch(entry) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  const code = `${entry.subject}${entry.number}`.toLowerCase();
  const codeSpaced = `${entry.subject} ${entry.number}`.toLowerCase();
  return code.includes(q) || codeSpaced.includes(q) || entry.name.toLowerCase().includes(q);
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

function semestersViewHtml(entries, filterBar) {
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
    ${filterBar}
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
      progressText: `${completedCredits}/${def.requiredCredits}cr${taking.length ? `, ${taking.length} taking` : ''}`,
    };
  }
  return {
    tagged,
    met: completed.length >= def.required,
    progressText: `${completed.length}/${def.required}${taking.length ? `, ${taking.length} taking` : ''}`,
  };
}

// Category keys carry a "(choose N)" suffix internally (it has to match the
// exact string js/roadmapCourses.js tags each course with), but that's
// redundant once the box also shows "1/N" progress right next to it — strip
// it for display only.
function categoryDisplayName(category) {
  return category
    .replace(/\s*\(choose \d+\)\s*$/i, '')
    .replace(/^Intro Computing$/, 'Intro CS')
    .replace(/ — AE$/, ' (AE)')
    .replace(/ — Open$/, ' (Open)');
}

// One category box with an explicit (not auto-fit) grid of `cols` x `rows`
// card slots — unlike the generic shrink-to-content boxes below, these
// slots are reserved whether or not they're actually filled, which is what
// lets AE Major's layout stay in the same fixed arrangement on Track even
// when nothing's marked yet. Sized per category to how many you'd actually
// ever need there (e.g. Orientation 2, the two Technical Electives groups
// ~2 each since each only needs 6cr worth) — Possible can still show more
// than that for an elective category with many real options (e.g. all ~20
// Technical Electives — AE choices); the box just grows past its preset
// instead of clipping or needing its own internal scroll.
function aeCategoryBoxHtml(categoryKey, cols, rows, full, visibleIds, statusFilter) {
  const { tagged, met, progressText } = categoryFulfillment('AE', categoryKey, full);
  let shown = tagged.filter((e) => visibleIds.has(e.id));
  if (statusFilter) shown = shown.filter((e) => statusFilter.includes(e.status));

  return `
    <div class="rm-category${met ? ' is-met' : ''}">
      <div class="rm-category-head"><span class="mono">${escapeHtml(categoryDisplayName(categoryKey))}</span><span class="muted mono">${escapeHtml(progressText)}</span></div>
      <div class="rm-card-grid" style="grid-template-columns:repeat(${cols},var(--rm-card-w)); grid-template-rows:repeat(${rows},minmax(72px,auto));">${sortEntries(shown).map(cardHtml).join('')}</div>
    </div>
  `;
}

// AE Major's own fixed layout for Track only (Possible reverts to the
// generic flex-wrap rendering below, same as ECE/Math/CS) — Technical Core
// on the right; on the left, Orientation/Intro CS/Propulsion stacked in a
// column next to Foundational Math and Science (now 3x3 since Calculus I
// merged into it), bottom-aligned with that stack via align-items:flex-end
// on .rm-ae-subgrid, then Technical Electives (AE)/(Open) in a row below.
function aeMajorHtml(full, visibleIds, statusFilter) {
  const box = (key, cols, rows) => aeCategoryBoxHtml(key, cols, rows, full, visibleIds, statusFilter);

  return `
    <section class="card">
      <h2 class="mono">${escapeHtml(PROGRAM_LABELS.AE)}</h2>
      <div class="rm-ae-grid">
        <div class="rm-ae-left">
          ${box('Foundational Math and Science', 4, 2)}
          <div class="rm-ae-row">
            ${box('Orientation', 2, 1)}
          </div>
          <div class="rm-ae-row">
            ${box('Calculus I (choose 1)', 1, 1)}
            ${box('Intro Computing (choose 1)', 1, 1)}
          </div>
          <div class="rm-ae-row">
            ${box('Propulsion (choose 1)', 1, 1)}
            ${box('Technical Electives — AE', 2, 1)}
            ${box('Technical Electives — Open', 2, 1)}
          </div>
        </div>
        <div class="rm-ae-right">
          ${box('AE Technical Core', 5, 4)}
        </div>
      </div>
    </section>
  `;
}

// Shared by both "Track" (filtered to status taking/completed — the
// grow-as-you-go dashboard) and "Possible" (unfiltered — the full
// reference catalog). `statusFilter` is null for Possible, or
// ['taking','completed'] for Track; either way the fulfillment math
// (met/progressText) always runs against the FULL unfiltered data, since a
// category's green/not-green state must never depend on which cards
// happen to be displayed — only which cards get *shown as cards* changes.
function categoryViewHtml(full, visible, statusFilter) {
  const visibleIds = new Set(visible.map((e) => e.id));

  const programsHtml = PROGRAM_ORDER.map((program) => {
    // AE's fixed box layout is Track-only (statusFilter truthy) — Possible
    // uses the same generic flex-wrap rendering as every other program.
    if (program === 'AE' && statusFilter) return aeMajorHtml(full, visibleIds, statusFilter);

    const categoriesHtml = CATEGORIES.filter((c) => c.program === program).map((cat) => {
      const { tagged, met, progressText } = categoryFulfillment(program, cat.category, full);
      let shown = tagged.filter((e) => visibleIds.has(e.id));
      if (statusFilter) shown = shown.filter((e) => statusFilter.includes(e.status));
      if (!shown.length) return ''; // nothing to show — skip the whole category block

      return `
        <div class="rm-category${met ? ' is-met' : ''}">
          <div class="rm-category-head"><span class="mono">${escapeHtml(categoryDisplayName(cat.category))}</span><span class="muted mono">${escapeHtml(progressText)}</span></div>
          <div class="rm-card-grid">${sortEntries(shown).map(cardHtml).join('')}</div>
        </div>
      `;
    }).join('');

    // Free Electives etc. have no cards to filter, so they're only shown
    // on the unfiltered Possible view — Track only ever shows things
    // that actually got marked.
    const notesHtml = statusFilter ? '' : FREE_NOTES.filter((n) => n.program === program)
      .map((n) => `<p class="muted">${escapeHtml(n.label)} — ${n.credits} hrs (any eligible course; not tracked here)</p>`)
      .join('');

    if (!categoriesHtml && !notesHtml) return ''; // whole program has nothing to show

    return `
      <section class="card">
        <h2 class="mono">${escapeHtml(PROGRAM_LABELS[program])}</h2>
        <div class="rm-categories">${categoriesHtml}</div>
        ${notesHtml}
      </section>
    `;
  }).join('');

  if (statusFilter && !programsHtml) {
    return '<section class="card"><p class="muted">Mark a course as taking or completed to see it here — this fills in as you plan out your schedule.</p></section>';
  }
  return programsHtml;
}

function headerHtml() {
  return `
    <section class="card">
      <div class="row-between">
        <h1 class="mono">Roadmap</h1>
        <div class="range-toggle">
          <button data-action="view" data-view="semesters" class="${view === 'semesters' ? 'active' : ''}">Semesters</button>
          <button data-action="view" data-view="track" class="${view === 'track' ? 'active' : ''}">Track</button>
          <button data-action="view" data-view="possible" class="${view === 'possible' ? 'active' : ''}">Possible</button>
        </div>
      </div>
      <div class="range-toggle" style="margin-top:8px;">
        <button data-action="mark" data-mark="completed" class="${markMode === 'completed' ? 'active' : ''}">Mark Complete</button>
        <button data-action="mark" data-mark="taking" class="${markMode === 'taking' ? 'active' : ''}">Mark Taking</button>
      </div>
    </section>
  `;
}

function filterBarHtml() {
  const subjects = allSubjects();
  return `
    <section class="card">
      <div class="row-between">
        <h2 class="mono">Filter</h2>
        <button data-action="add-course">+ Add course</button>
      </div>
      <input type="text" class="cal-search-input mono" data-action="search" placeholder="Search courses…" value="${escapeHtml(searchQuery)}" style="width:100%; margin-top:8px;">
      <div class="range-toggle" style="flex-wrap:wrap; gap:6px; margin-top:8px;">
        <button data-action="subject-filter" data-subject="" class="${activeSubjects.size === 0 ? 'active' : ''}">All</button>
        ${subjects.map((s) => `<button data-action="subject-filter" data-subject="${escapeHtml(s)}" class="${activeSubjects.has(s) ? 'active' : ''}">${escapeHtml(s)}</button>`).join('')}
      </div>
    </section>
    <dialog id="modal-dialog"></dialog>
  `;
}

function rebuild() {
  // rebuild() replaces the whole DOM tree, including the search input
  // itself, on every keystroke — capture focus/cursor beforehand so typing
  // doesn't kick focus out of the box after each character (same pattern
  // as Canvas/Calendar's own search boxes).
  const searchEl = container.querySelector('[data-action="search"]');
  const searchWasFocused = document.activeElement === searchEl;
  const searchSelection = searchWasFocused ? [searchEl.selectionStart, searchEl.selectionEnd] : null;

  const full = allEntries();
  const visible = sortEntries(full.filter((e) => (!activeSubjects.size || activeSubjects.has(e.subject)) && matchesSearch(e)));
  const filterBar = filterBarHtml();

  const bodyHtml = view === 'semesters'
    ? semestersViewHtml(visible, filterBar)
    : filterBar + (view === 'track'
      ? categoryViewHtml(full, visible, ['taking', 'completed'])
      : categoryViewHtml(full, visible, null));

  container.innerHTML = `
    ${headerHtml()}
    ${bodyHtml}
  `;

  attachEvents(full);

  if (searchWasFocused) {
    const newSearchEl = container.querySelector('[data-action="search"]');
    if (newSearchEl) {
      newSearchEl.focus();
      newSearchEl.setSelectionRange(...searchSelection);
    }
  }
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

  container.querySelector('[data-action="search"]')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    rebuild();
  });

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
