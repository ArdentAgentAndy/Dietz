import { store } from '../store.js';
import { timerState, startTimer, stopTimer } from '../timer.js';
import {
  GRAPH_SERIES,
  liveCategoriesByGroup,
  totalMinutesForCategory,
  totalMinutesForDay,
  recentSessions,
  datesForRange,
  minutesByGroupForDates,
} from '../sessions.js';
import {
  formatDateISO,
  formatDisplayDate,
  formatShortDate,
  formatDuration,
  formatHMS,
  parseDurationToMinutes,
  escapeHtml,
  hexToRgba,
} from '../format.js';
import { computeGrade } from '../grading.js';
import { computeSemesterGPA, computeCumulativeGPA } from '../gpa.js';
import { getCourseState } from '../courseState.js';
import { archiveCourseById, deleteCourseById } from './courses.js';

let container = null;
let tickIntervalId = null;
let chart = null;
let range = '7';

const RANGES = [
  { key: '7', label: '7d' },
  { key: '30', label: '30d' },
  { key: 'semester', label: 'Semester' },
  { key: 'all', label: 'All' },
];

export function render(rootEl) {
  container = rootEl;
  rebuild();
  tickIntervalId = setInterval(updateLiveDisplays, 1000);
}

export function unmount() {
  if (tickIntervalId) clearInterval(tickIntervalId);
  tickIntervalId = null;
  if (chart) chart.destroy();
  chart = null;
  container = null;
}

function categoryLabel(cat) {
  if (cat.group === 'homework') return 'Homework';
  if (cat.group === 'piano') return 'Piano';
  if (cat.group === 'project') return `[P] ${cat.name}`;
  if (cat.group === 'research') return `[R] ${cat.name}`;
  return cat.name; // revision cards show the course code
}

function allLiveCategories() {
  return GRAPH_SERIES.flatMap((s) => liveCategoriesByGroup(s.group));
}

function timerCardHtml(cat, timer, todayISO) {
  const isRunning = timer?.categoryId === cat.id;
  const todayMinutes = totalMinutesForCategory(cat.id, todayISO);
  return `
    <div class="timer-card${isRunning ? ' is-running' : ''}">
      <div class="timer-card-head">
        <span class="timer-card-title">
          <span class="mono timer-card-name">${escapeHtml(categoryLabel(cat))}</span>
          <button class="card-edit-btn" data-action="manage-category" data-category-id="${cat.id}" title="Manage">&#9998;</button>
        </span>
        <span class="mono timer-elapsed" data-elapsed="${cat.id}"></span>
      </div>
      <div class="timer-card-foot">
        <span class="muted" data-card-total="${cat.id}">Today: ${formatHMS(todayMinutes * 60)}</span>
        <button data-action="toggle-timer" data-category-id="${cat.id}">${isRunning ? 'Stop' : 'Start'}</button>
      </div>
    </div>
  `;
}

function sessionItemHtml(session) {
  const cat = store.table('Categories').find((c) => c.id === session.categoryId);
  const label = cat ? categoryLabel(cat) : 'Unknown';
  const note = session.note ? ` &middot; ${escapeHtml(session.note)}` : '';
  return `
    <li class="session-item" data-session-id="${session.id}">
      <div>
        <span class="mono">${escapeHtml(label)}</span>
        <span class="muted">${session.date} &middot; ${formatHMS(session.minutes * 60)}${note}</span>
      </div>
      <div class="session-actions">
        <button data-action="edit-session" data-session-id="${session.id}">Edit</button>
        <button data-action="delete-session" data-session-id="${session.id}">Delete</button>
      </div>
    </li>
  `;
}

function rebuild() {
  const timer = timerState.current;
  const todayISO = formatDateISO(new Date());
  const revisionCards = liveCategoriesByGroup('revision').map((c) => timerCardHtml(c, timer, todayISO)).join('');
  const otherCards = [
    ...liveCategoriesByGroup('homework'),
    ...liveCategoriesByGroup('piano'),
    ...liveCategoriesByGroup('project'),
    ...liveCategoriesByGroup('research'),
  ]
    .map((c) => timerCardHtml(c, timer, todayISO))
    .join('');
  const sessions = recentSessions(10).map(sessionItemHtml).join('');
  const headerMinutes = totalMinutesForDay(todayISO);

  container.innerHTML = `
    <section class="card">
      <h1 class="mono">${formatDisplayDate()}</h1>
      <p class="muted">Today total: <span class="mono" data-header-total>${formatHMS(headerMinutes * 60)}</span></p>
    </section>

    <section class="card">
      <h2 class="mono">Revision</h2>
      <div class="timer-grid">${revisionCards || '<p class="muted">No active courses.</p>'}</div>
    </section>

    <section class="card">
      <h2 class="mono">Other</h2>
      <div class="timer-grid">${otherCards || '<p class="muted">No cards yet — add one below.</p>'}</div>
      <div class="add-row">
        ${liveCategoriesByGroup('homework').length === 0 ? '<button data-action="add-default-category" data-group="homework">+ Add homework</button>' : ''}
        ${liveCategoriesByGroup('piano').length === 0 ? '<button data-action="add-default-category" data-group="piano">+ Add piano</button>' : ''}
        <button data-action="add-category" data-group="project">+ Add project</button>
        <button data-action="add-category" data-group="research">+ Add research</button>
      </div>
    </section>

    <section class="card">
      <div class="row-between">
        <h2 class="mono">Recent sessions</h2>
        <button data-action="manual-entry">+ Manual entry</button>
      </div>
      <ul class="session-list">${sessions || '<p class="muted">No sessions logged yet.</p>'}</ul>
    </section>

    <section class="card">
      <div class="row-between">
        <h2 class="mono">Hours</h2>
        <div class="range-toggle">
          ${RANGES.map((r) => `<button data-range="${r.key}" class="${r.key === range ? 'active' : ''}">${r.label}</button>`).join('')}
        </div>
      </div>
      <div class="chart-wrap"><canvas id="hours-chart" height="240"></canvas></div>
    </section>

    ${coursesAndGpaHtml()}

    <dialog id="modal-dialog"></dialog>
  `;

  attachEvents();
  drawChart();
}

function courseGradeCardHtml(course, grade) {
  const gradeText = course.finalLetter
    ? `${course.finalLetter} (final)`
    : grade.hasGradedWork
      ? `${grade.percent.toFixed(1)}% (${grade.letter})`
      : 'No grade yet';
  return `
    <a class="course-grade-card" href="#/course/${course.id}">
      <span class="mono">${escapeHtml(course.code)}</span>
      <span class="muted">${gradeText}</span>
      <span class="muted">${course.credits} cr</span>
    </a>
  `;
}

function coursesAndGpaHtml() {
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
      <h2 class="mono">Courses</h2>
      <div class="course-grade-grid">${cards || '<p class="muted">No active courses.</p>'}</div>
      <div class="gpa-row">
        <span class="muted">Semester GPA <span class="mono">${semester.gpa != null ? semester.gpa.toFixed(2) : '—'}</span></span>
        <span class="muted">Cumulative GPA <span class="mono">${cumulative != null ? cumulative.toFixed(2) : '—'}</span></span>
      </div>
    </section>
  `;
}

function attachEvents() {
  container.querySelectorAll('[data-action="toggle-timer"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const catId = btn.dataset.categoryId;
      const timer = timerState.current;
      if (timer?.categoryId === catId) stopTimer();
      else startTimer(catId);
      rebuild();
    });
  });

  container.querySelectorAll('[data-action="add-category"]').forEach((btn) => {
    btn.addEventListener('click', () => openAddCategoryDialog(btn.dataset.group));
  });

  container.querySelectorAll('[data-action="add-default-category"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      store.upsert('Categories', {
        group,
        name: group === 'homework' ? 'Homework' : 'Piano',
        courseId: '',
        archived: false,
      });
      rebuild();
    });
  });

  container.querySelectorAll('[data-action="manage-category"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cat = store.table('Categories').find((c) => c.id === btn.dataset.categoryId);
      if (cat) openManageCategoryDialog(cat);
    });
  });

  container.querySelector('[data-action="manual-entry"]')?.addEventListener('click', () => openSessionDialog());

  container.querySelectorAll('[data-action="edit-session"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const session = store.table('Sessions').find((s) => s.id === btn.dataset.sessionId);
      if (session) openSessionDialog(session);
    });
  });

  container.querySelectorAll('[data-action="delete-session"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (confirm('Delete this session?')) {
        store.remove('Sessions', btn.dataset.sessionId);
        rebuild();
      }
    });
  });

  container.querySelectorAll('[data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      range = btn.dataset.range;
      container.querySelectorAll('[data-range]').forEach((b) => b.classList.toggle('active', b === btn));
      drawChart();
    });
  });
}

function updateLiveDisplays() {
  if (!container) return;
  const timer = timerState.current;
  const todayISO = formatDateISO(new Date());
  const liveSeconds = timer ? (Date.now() - timer.startedAt) / 1000 : 0;

  const headerEl = container.querySelector('[data-header-total]');
  if (headerEl) headerEl.textContent = formatHMS(totalMinutesForDay(todayISO) * 60 + liveSeconds);

  container.querySelectorAll('[data-elapsed]').forEach((el) => {
    const catId = el.dataset.elapsed;
    if (timer && timer.categoryId === catId) {
      el.textContent = formatHMS((Date.now() - timer.startedAt) / 1000);
    } else {
      el.textContent = '';
    }
  });

  container.querySelectorAll('[data-card-total]').forEach((el) => {
    const catId = el.dataset.cardTotal;
    let seconds = totalMinutesForCategory(catId, todayISO) * 60;
    if (timer && timer.categoryId === catId) seconds += liveSeconds;
    el.textContent = `Today: ${formatHMS(seconds)}`;
  });
}

function drawChart() {
  const canvas = container.querySelector('#hours-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (chart) chart.destroy();

  const dates = datesForRange(range);
  const totals = minutesByGroupForDates(dates);
  const labels = dates.map(formatShortDate);
  const mutedInk = 'rgba(240, 239, 244, 0.65)';
  const gridColor = 'rgba(255, 255, 255, 0.08)';

  const seriesDatasets = GRAPH_SERIES.map((series) => ({
    label: series.label,
    data: dates.map((d) => Math.round((totals[d][series.key] / 60) * 100) / 100),
    borderColor: series.color,
    backgroundColor: series.color,
    borderWidth: 2,
    pointRadius: 2,
    pointHoverRadius: 4,
    pointBackgroundColor: series.color,
    tension: 0.15,
  }));

  const goalDatasets = GRAPH_SERIES.filter((s) => s.goalHours).map((series) => ({
    label: `${series.label} goal`,
    data: dates.map(() => series.goalHours),
    borderColor: hexToRgba(series.color, 0.45),
    borderWidth: 1,
    borderDash: [5, 4],
    pointRadius: 0,
    pointHitRadius: 0,
    fill: false,
    isGoalLine: true,
  }));

  chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [...seriesDatasets, ...goalDatasets],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: mutedInk,
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            filter: (item, data) => !data.datasets[item.datasetIndex].isGoalLine,
          },
        },
        tooltip: {
          backgroundColor: '#1e1e24',
          titleColor: '#f0eff4',
          bodyColor: '#f0eff4',
          borderColor: 'rgba(255,255,255,0.15)',
          borderWidth: 1,
          filter: (item) => !item.dataset.isGoalLine,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}h`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: mutedInk },
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { color: mutedInk },
          title: { display: true, text: 'Hours', color: mutedInk },
        },
      },
    },
  });
}

function categoryOptionsHtml(selectedId) {
  const groups = [
    ['revision', 'Revision'],
    ['homework', 'Homework'],
    ['piano', 'Piano'],
    ['project', 'Project work'],
    ['research', 'Research'],
  ];
  return groups
    .map(([group, groupLabel]) => {
      const cats = liveCategoriesByGroup(group);
      if (!cats.length) return '';
      const options = cats
        .map(
          (c) =>
            `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(categoryLabel(c))}</option>`
        )
        .join('');
      return `<optgroup label="${groupLabel}">${options}</optgroup>`;
    })
    .join('');
}

function openSessionDialog(existing = null) {
  const dialog = container.querySelector('#modal-dialog');
  const today = formatDateISO(new Date());

  dialog.innerHTML = `
    <form method="dialog" class="modal-form">
      <h2 class="mono">${existing ? 'Edit session' : 'Manual entry'}</h2>
      <label>Date
        <input type="date" name="date" value="${existing?.date || today}" required>
      </label>
      <label>Duration (h:mm)
        <input type="text" name="duration" placeholder="0:30" value="${existing ? formatDuration(existing.minutes) : ''}" required>
      </label>
      <label>Category
        <select name="categoryId" required>${categoryOptionsHtml(existing?.categoryId)}</select>
      </label>
      <label>Note (optional)
        <input type="text" name="note" value="${existing ? escapeHtml(existing.note || '') : ''}">
      </label>
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
    store.upsert('Sessions', {
      id: existing?.id,
      categoryId: data.get('categoryId'),
      date: data.get('date'),
      minutes: parseDurationToMinutes(data.get('duration')),
      note: data.get('note') || '',
      source: existing?.source || 'manual',
      start: existing?.start || '',
      end: existing?.end || '',
    });
    rebuild();
  });

  dialog.showModal();
}

// Archive keeps everything (course grades / logged time) and just hides the
// card. Delete is the harder action: for a course it matches the Courses
// page (grades gone, session history kept); for the plain "Other" cards
// (which have no grades attached) it purges their still-live sessions too —
// anything already rolled into a daily total by compaction.js is a group
// total, not tied to this specific card, so it's untouched either way.
function openManageCategoryDialog(cat) {
  const dialog = container.querySelector('#modal-dialog');
  const isRevision = cat.group === 'revision';
  const isNamed = cat.group === 'project' || cat.group === 'research';
  const course = isRevision ? store.table('Courses').find((c) => c.id === cat.courseId) : null;
  const title = isRevision ? course?.code || cat.name : categoryLabel(cat);

  function renderMain() {
    dialog.innerHTML = `
      <form method="dialog" class="modal-form">
        <h2 class="mono">Manage ${escapeHtml(title)}</h2>
        ${isNamed ? `<label>Name<input type="text" name="name" value="${escapeHtml(cat.name)}" required></label>` : ''}
        <div class="danger-zone">
          <span class="muted">Danger zone</span>
          <div class="modal-actions">
            <button type="button" class="btn-danger" data-action="delete">Delete</button>
            <button type="button" data-action="archive">Archive</button>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" data-action="cancel">Cancel</button>
          ${isNamed ? '<button type="submit" class="btn-primary">Save</button>' : ''}
        </div>
      </form>
    `;
    const form = dialog.querySelector('form');
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
    form.querySelector('[data-action="archive"]').addEventListener('click', () => renderConfirm('archive'));
    form.querySelector('[data-action="delete"]').addEventListener('click', () => renderConfirm('delete'));
    if (isNamed) {
      form.addEventListener('submit', () => {
        const data = new FormData(form);
        store.upsert('Categories', { id: cat.id, name: data.get('name') });
        rebuild();
      });
    }
  }

  function archiveMessage() {
    if (isRevision) {
      return `Archiving ${escapeHtml(title)} hides its timer card and drops it from the Courses/GPA lists. All grades and logged time are kept — unarchive it later from the Courses page.`;
    }
    return `Archiving "${escapeHtml(categoryLabel(cat))}" hides this card from the home page. All logged time is kept.`;
  }

  function deleteMessage() {
    if (isRevision) {
      return `Deleting ${escapeHtml(title)} removes all its graded items and drops it from GPA. Logged study time is kept. This cannot be undone.`;
    }
    return `Deleting "${escapeHtml(categoryLabel(cat))}" permanently removes this card AND any of its logged time that hasn't already rolled into a daily total. This cannot be undone.`;
  }

  function renderConfirm(action) {
    const isDelete = action === 'delete';
    dialog.innerHTML = `
      <div class="modal-form">
        <h2 class="mono">${isDelete ? 'Delete' : 'Archive'} ${escapeHtml(title)}?</h2>
        <p class="confirm-warning${isDelete ? ' is-danger' : ''}">${isDelete ? deleteMessage() : archiveMessage()}</p>
        <div class="modal-actions">
          <button type="button" data-action="back">Go back</button>
          <button type="button" class="${isDelete ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${isDelete ? 'Delete' : 'Archive'}</button>
        </div>
      </div>
    `;
    dialog.querySelector('[data-action="back"]').addEventListener('click', renderMain);
    dialog.querySelector('[data-action="confirm"]').addEventListener('click', () => {
      if (timerState.current?.categoryId === cat.id) stopTimer();
      if (action === 'archive') doArchive();
      else doDelete();
      dialog.close();
      rebuild();
    });
  }

  function doArchive() {
    if (isRevision) archiveCourseById(cat.courseId);
    else store.upsert('Categories', { id: cat.id, archived: true });
  }

  function doDelete() {
    if (isRevision) {
      deleteCourseById(cat.courseId);
      return;
    }
    for (const s of store.table('Sessions').filter((sess) => sess.categoryId === cat.id)) {
      store.remove('Sessions', s.id);
    }
    store.remove('Categories', cat.id);
  }

  renderMain();
  dialog.showModal();
}

function openAddCategoryDialog(group) {
  const dialog = container.querySelector('#modal-dialog');
  const groupLabel = group === 'project' ? 'project' : 'research';

  dialog.innerHTML = `
    <form method="dialog" class="modal-form">
      <h2 class="mono">Add ${groupLabel}</h2>
      <label>Name
        <input type="text" name="name" placeholder="e.g. ${group === 'project' ? 'Robotics club' : 'Lab writeup'}" required>
      </label>
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
    store.upsert('Categories', {
      group,
      name: data.get('name'),
      courseId: '',
      archived: false,
    });
    rebuild();
  });

  dialog.showModal();
}
