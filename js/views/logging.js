import { store } from '../store.js?v=63';
import { timerState, startTimer, stopTimer } from '../timer.js?v=63';
import {
  GRAPH_SERIES,
  GROUP_ALIASES,
  liveCategoriesByGroup,
  totalMinutesForCategory,
  totalMinutesForDay,
  recentSessions,
  compactedSessions,
  datesForRange,
  minutesByGroupForDates,
} from '../sessions.js?v=63';
import {
  formatDateISO,
  formatDisplayDate,
  formatShortDate,
  formatDuration,
  formatHMS,
  parseDurationToMinutes,
  escapeHtml,
  hexToRgba,
} from '../format.js?v=63';
import { archiveCourseById, deleteCourseById } from './courses.js?v=63';
import { hexForCourse, hexForLabel, hexForNotionColor } from '../notionColors.js?v=63';
import { fetchNotionSchema, getCachedNotionSchema } from '../notion.js?v=63';

let container = null;
let tickIntervalId = null;
let chart = null;
let range = '7';
let archiveRange = '7';
let archivedOpen = false;

const RANGES = [
  { key: '7', label: '7d' },
  { key: '30', label: '30d' },
  { key: 'semester', label: 'Semester' },
  { key: 'all', label: 'All' },
];

const ARCHIVE_RANGES = [
  { key: '7', label: '7d' },
  { key: '30', label: '1M' },
  { key: 'semester', label: 'Semester' },
  { key: 'all', label: 'All' },
];

export function render(rootEl) {
  container = rootEl;
  rebuild();
  tickIntervalId = setInterval(updateLiveDisplays, 1000);
  // Background-only, non-blocking — getCachedNotionSchema() just reads
  // whatever's already cached (or null) until this resolves, so a project/
  // research category's color (see notionSubColor) falls back to its old
  // hashed one until the fetch lands, same as js/views/calendar.js's own
  // call. Calendar already triggers this same fetch on its own mount, but
  // Logging needs its own copy warm regardless of whether Calendar's been
  // visited yet this session — then rebuilds once so a color that was
  // still hashed on first paint updates without waiting for the next
  // unrelated re-render. container-null-checked since the fetch can
  // outlive this page if the user's already navigated elsewhere by the
  // time it resolves.
  fetchNotionSchema().then(() => { if (container) rebuild(); });
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

function groupColor(group) {
  return GRAPH_SERIES.find((s) => s.group === group)?.color || '#888888';
}

const GROUP_SORT_ORDER = GRAPH_SERIES.map((s) => s.group);

function groupDisplayLabel(group) {
  return group ? group.charAt(0).toUpperCase() + group.slice(1) : 'Unknown';
}

function archivedChipHtml(group, minutes) {
  const color = groupColor(group);
  const bg = hexToRgba(color, 0.1);
  return `
    <span class="archived-chip" style="background:${bg}; --cell-color:${color};">
      <span class="mono">${escapeHtml(groupDisplayLabel(group))}</span>
      <span class="muted">${formatHMS(minutes * 60)}</span>
    </span>
  `;
}

// Sums minutes per group so duplicate underlying session rows for the same
// (date, group) — e.g. left over from a sync merge — collapse into a single
// chip instead of showing twice. GROUP_ALIASES folds any old homework-group
// rows into the Revision chip too, same as the graph does, rather than
// showing a separate "Homework" chip for history predating that merge.
function archivedDayBlockHtml(date, sessions) {
  const categories = store.table('Categories');
  const groupOf = (s) => categories.find((c) => c.id === s.categoryId)?.group;
  const minutesByGroup = new Map();
  for (const s of sessions) {
    const rawGroup = groupOf(s);
    const group = GROUP_ALIASES[rawGroup] || rawGroup;
    minutesByGroup.set(group, (minutesByGroup.get(group) || 0) + s.minutes);
  }
  const chips = [...minutesByGroup.entries()]
    .sort((a, b) => GROUP_SORT_ORDER.indexOf(a[0]) - GROUP_SORT_ORDER.indexOf(b[0]))
    .map(([group, minutes]) => archivedChipHtml(group, minutes))
    .join('');
  return `
    <div class="archived-day-row">
      <span class="archived-day-date mono">${formatShortDate(date)}</span>
      ${chips}
    </div>
  `;
}

function groupArchivedByDate(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (!map.has(s.date)) map.set(s.date, []);
    map.get(s.date).push(s);
  }
  return map;
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

// Same shape vocabulary as the Today/Calendar chip emblem (taskDisplay.js's
// SHAPE_BY_CATEGORY) — Revision=square, Homework=diamond, Project=triangle,
// Research=x — so a category reads the same way everywhere in the app.
// Piano has no Notion-task equivalent there; circle (the shared default)
// is unused by any other Sessions group, so it's free to reuse here.
const GROUP_SHAPE = {
  revision: 'square',
  homework: 'diamond',
  project: 'triangle',
  research: 'x',
  piano: 'circle',
};

// The group's own chart color (groupColor — same as the Hours chart legend
// and the Archived chips) — always the group's color, never a more
// specific course/project color, so the category itself (symbol +
// background) never depends on a hash that can coincidentally collide with
// another group's color (e.g. CS 124/CS 101's course purple vs Research's
// series purple, PHYS 211's course blue vs Project's series blue).
function sessionGroupColor(cat) {
  return groupColor(GROUP_ALIASES[cat?.group] || cat?.group);
}

// A project/research category's color pulled straight from Notion's own
// schema (js/notion.js's fetchNotionSchema/getCachedNotionSchema — refreshed
// in the background on this page's own mount, see render() below) rather
// than hashed locally: Code.gs's notionSchema_ now returns a name->color map
// (projectColors/leadColors) alongside the plain option-name lists calendar.js
// already validates task entry against, so a category's own `name` (which
// must already exactly match a real Project/Lead option for todaySessions.js
// to ever resolve a task to it at all — see resolveCategoryForTask) is a
// reliable key into that same map. null on a cache miss (never fetched yet,
// or no color set on that Notion option) — caller falls back to the old
// hashed color in that case.
function notionSubColor(cat) {
  if (cat?.group !== 'project' && cat?.group !== 'research') return null;
  const schema = getCachedNotionSchema();
  const colors = cat.group === 'project' ? schema?.projectColors : schema?.leadColors;
  const notionColor = colors?.[cat.name];
  return notionColor ? hexForNotionColor(notionColor) : null;
}

// Real Project/Lead option names straight from Notion's schema (same cache
// notionSubColor and js/views/calendar.js's own task-entry validation read),
// offered as native <datalist> suggestions on a project/research category's
// Name field (both openAddCategoryDialog and openManageCategoryDialog) —
// picking one guarantees the category matches a real Notion option (so its
// color pulls through, see notionSubColor, and todaySessions.js's
// resolveCategoryForTask can actually find it), while still leaving the
// field free-text for a deliberately local-only name with no Notion
// counterpart. Empty (no suggestions, never blocks) on a cache miss.
function notionOptionsDatalistHtml(group) {
  const schema = getCachedNotionSchema();
  const names = (group === 'project' ? schema?.project : schema?.lead) || [];
  return `<datalist id="category-name-options">${names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('')}</datalist>`;
}

// The finer "project/course/lead" sub-identity — only exists for groups
// that actually have one: a revision session's specific course
// (hexForCourse, same as Courses/Grades/Calendar/Lessons), or a Project/
// Research category's real Notion-assigned color when known (notionSubColor
// above), falling back to a locally-hashed one (hexForLabel) only when that
// isn't cached yet — so the same project/lead reads as the exact same color
// here as it does on Calendar/Today's own chips (js/views/calendar.js's
// hexForNotionColor(task[config.colorProp])), not a coincidentally-different
// one. Homework/Piano have no sub-identity.
function sessionSubColor(cat) {
  if (!cat) return null;
  if (cat.group === 'revision' && cat.courseId) {
    const course = store.table('Courses').find((c) => c.id === cat.courseId);
    if (course) return hexForCourse(course);
  }
  if (cat.group === 'project' || cat.group === 'research') {
    return notionSubColor(cat) || hexForLabel(cat.name);
  }
  return null;
}

// The sub-identity's own text — the course code, or the project/research
// category's name with its categoryLabel() [P]/[R] prefix dropped (the
// shape column already says which group it is, so the prefix would be
// redundant here).
function sessionSubText(cat) {
  if (!cat) return '';
  if (cat.group === 'revision' || cat.group === 'project' || cat.group === 'research') return cat.name;
  return '';
}

function sessionShapeHtml(group, color) {
  const shape = GROUP_SHAPE[group] || 'circle';
  if (shape === 'x') return `<span class="cal-chip-shape shape-x" style="color:${color};">&#10005;</span>`;
  return `<span class="cal-chip-shape shape-${shape}" style="background:${color};"></span>`;
}

// Same column-grid technique as .course-table/.class-list — Shape/Session/
// Date/Duration/Note/Actions. The shape column is a left-border-accented
// cell on its own, colored by the group (always one of the few fixed group
// colors, so it's never ambiguous). The Session column then shows the
// finer course/project/lead identity as a translucent pill — same
// .cal-chip-sub-badge style as Calendar/Today's own sub-value badge — in
// its own, more specific color; Homework/Piano (no sub-identity) fall back
// to their plain category name instead.
function sessionRowHtml(session) {
  const cat = store.table('Categories').find((c) => c.id === session.categoryId);
  const color = sessionGroupColor(cat);
  const subColor = sessionSubColor(cat);
  const subText = sessionSubText(cat);
  const bg = hexToRgba(color, 0.08);
  const labelContent = subColor && subText
    ? `<span class="cal-chip-sub-badge" style="border-color:${hexToRgba(subColor, 0.6)}; background:${hexToRgba(subColor, 0.18)}; color:${subColor};">${escapeHtml(subText)}</span>`
    : escapeHtml(cat ? categoryLabel(cat) : 'Unknown');
  return `
    <div class="session-row" data-session-id="${session.id}">
      <span class="session-cell session-cell-shape" style="background:${bg}; --cell-color:${color};">${sessionShapeHtml(cat?.group, color)}</span>
      <span class="session-cell session-cell-label mono" style="background:${bg};">${labelContent}</span>
      <span class="session-cell session-cell-date muted mono" style="background:${bg};">${session.date}</span>
      <span class="session-cell session-cell-duration muted mono" style="background:${bg};">${formatHMS(session.minutes * 60)}</span>
      <span class="session-cell session-cell-note muted" style="background:${bg};">${escapeHtml(session.note || '')}</span>
      <span class="session-cell session-cell-actions" style="background:${bg};">
        <button data-action="edit-session" data-session-id="${session.id}">Edit</button>
        <button data-action="delete-session" data-session-id="${session.id}">Delete</button>
      </span>
    </div>
  `;
}

function rebuild() {
  const timer = timerState.current;
  const todayISO = formatDateISO(new Date());
  const revisionCards = liveCategoriesByGroup('revision').map((c) => timerCardHtml(c, timer, todayISO)).join('');
  const otherCards = [
    ...liveCategoriesByGroup('piano'),
    ...liveCategoriesByGroup('project'),
    ...liveCategoriesByGroup('research'),
  ]
    .map((c) => timerCardHtml(c, timer, todayISO))
    .join('');
  const sessions = recentSessions(10).map(sessionRowHtml).join('');
  const headerMinutes = totalMinutesForDay(todayISO);
  const archived = compactedSessions();
  const archiveDateSet = new Set(datesForRange(archiveRange));
  const archivedFiltered = archived.filter((s) => archiveDateSet.has(s.date));
  const archivedByDate = groupArchivedByDate(archivedFiltered);
  const archivedDaysHtml = [...archivedByDate.entries()].map(([date, sess]) => archivedDayBlockHtml(date, sess)).join('');
  const archivedEmptyMessage = archived.length ? 'Nothing archived in this range.' : 'Nothing archived yet.';

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
      ${sessions ? `
        <div class="session-table">
          <div class="session-row session-row-head">
            <span class="session-cell"></span>
            <span class="session-cell muted mono">Session</span>
            <span class="session-cell muted mono">Date</span>
            <span class="session-cell muted mono">Duration</span>
            <span class="session-cell muted mono">Note</span>
            <span class="session-cell"></span>
          </div>
          ${sessions}
        </div>
      ` : '<p class="muted">No sessions logged yet.</p>'}
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

    <section class="card">
      <details class="archived-details" ${archivedOpen ? 'open' : ''}>
        <summary>
          <div class="row-between">
            <h2 class="mono">Archived${archivedByDate.size ? ` (${archivedByDate.size})` : ''}</h2>
            <div class="range-toggle">
              ${ARCHIVE_RANGES.map((r) => `<button data-archive-range="${r.key}" class="${r.key === archiveRange ? 'active' : ''}">${r.label}</button>`).join('')}
            </div>
          </div>
        </summary>
        ${archivedDaysHtml ? `<div class="archived-list">${archivedDaysHtml}</div>` : `<p class="muted">${archivedEmptyMessage}</p>`}
      </details>
    </section>

    <dialog id="modal-dialog"></dialog>
  `;

  attachEvents();
  drawChart();
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
        name: 'Piano',
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

  container.querySelector('.archived-details')?.addEventListener('toggle', (e) => {
    archivedOpen = e.target.open;
  });

  container.querySelectorAll('[data-archive-range]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      archiveRange = btn.dataset.archiveRange;
      rebuild();
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

// Exported for the Home dashboard's read-only mirror of this chart — pure
// function of `range`, no DOM/module-state access, so it's safe to call
// from anywhere; the caller owns its own Chart instance/canvas/lifecycle.
export function hoursChartConfig(range) {
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

  return {
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
  };
}

function drawChart() {
  const canvas = container.querySelector('#hours-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (chart) chart.destroy();
  chart = new Chart(canvas.getContext('2d'), hoursChartConfig(range));
}

function categoryOptionsHtml(selectedId) {
  const groups = [
    ['revision', 'Revision'],
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
        ${isNamed ? `
          <label>Name
            <input type="text" name="name" value="${escapeHtml(cat.name)}" list="category-name-options" required>
          </label>
          ${notionOptionsDatalistHtml(cat.group)}
          <p class="muted" style="font-size:12px;">
            Pick a suggestion to match this to a real Notion ${cat.group === 'project' ? 'Project' : 'Lead'} value — its color then carries over here and across Sessions automatically.
          </p>
        ` : ''}
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
    return `Archiving "${escapeHtml(categoryLabel(cat))}" hides this card from the Logging page. All logged time is kept.`;
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
        <input type="text" name="name" placeholder="e.g. ${group === 'project' ? 'Robotics club' : 'Lab writeup'}" list="category-name-options" required>
      </label>
      ${notionOptionsDatalistHtml(group)}
      <p class="muted" style="font-size:12px;">
        Pick a suggestion to match a real Notion ${group === 'project' ? 'Project' : 'Lead'} value — its color then carries over here and across Sessions automatically.
      </p>
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
