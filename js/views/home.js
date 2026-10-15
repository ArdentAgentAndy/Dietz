// Temporary dashboard hub — see HOME in js/channels.js for how to remove it
// later. Every section here is a read-only mirror: the weekly calendar grid
// and the Roadmap Track view are pulled in with zero interactivity wired up
// (no click handlers attached, no drag/drop), and the Hours chart/Courses
// grades sections reuse the exact same rendering the real pages use.
// The Today panel is the one exception: it's today.js's real `render`/
// `unmount`, mounted into its own sub-container, so mark/urgent/delete/
// duration all work here exactly as they do on the Today page itself
// (both write through to the same Notion cache either way).
import { fetchNotionTasks, getCachedNotionTasks } from '../notion.js?v=61';
import { escapeHtml, hexToRgba } from '../format.js?v=61';
import { categoryColorForTask, categoryRank, shapeEmblemHtml, subValueForTask, startOfDay, isoDay, taskDay } from '../taskDisplay.js?v=61';
import { hoursChartConfig } from './logging.js?v=61';
import { coursesAndGpaHtml } from './courses.js?v=61';
import { trackViewHtml } from './roadmap.js?v=61';
import { render as renderTodayPanel, unmount as unmountTodayPanel } from './today.js?v=61';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RANGES = [
  { key: '7', label: '7d' },
  { key: '30', label: '30d' },
  { key: 'semester', label: 'Semester' },
  { key: 'all', label: 'All' },
];

let container = null;
let allTasks = [];
let loadError = null;
let chart = null;
let range = '7';

function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function render(rootEl) {
  container = rootEl;
  // Track's AE grid is wide (same reason roadmap.js itself goes wide).
  container.closest('#app')?.classList.add('app-wide');

  const cached = getCachedNotionTasks();
  if (cached.length) {
    allTasks = cached.filter((t) => t.category !== 'Lesson');
    loadError = null;
  }
  rebuild();
  load();
}

export function unmount() {
  unmountTodayPanel();
  container?.closest('#app')?.classList.remove('app-wide');
  if (chart) chart.destroy();
  chart = null;
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

// Mirrors Calendar's chipStyle() for the default (no filter, no highlight
// mode) case — the only case that applies here, since this view has no
// filter/highlight UI of its own. Deliberately re-derived rather than
// imported from calendar.js: that module's own styling helpers close over
// its mutable UI state (active filter, highlight mode, ...), which would
// leak whatever the user last left Calendar in in rather than always
// showing a plain, neutral mirror.
function homeChipStyle(task) {
  const catColor = categoryColorForTask(task);
  const sub = subValueForTask(task);
  const borderAlpha = sub ? 0.6 : 0.3;

  if (task.mark) {
    const grayStripes = `repeating-linear-gradient(45deg, ${hexToRgba('#9b9a97', 0.1)} 0 8px, transparent 8px 16px)`;
    return `border: 2px solid ${hexToRgba(catColor, borderAlpha)}; background-color: ${hexToRgba(catColor, 0.1)}; background-image: ${grayStripes};`;
  }
  if (task.urgent) {
    const whiteStripes = `repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.28) 0 8px, transparent 8px 16px)`;
    return `border: 2px solid ${hexToRgba(catColor, borderAlpha)}; outline: 2px solid rgba(255, 255, 255, 0.85); outline-offset: 2px; background-color: ${hexToRgba(catColor, 0.12)}; background-image: ${whiteStripes};`;
  }
  return `border: 2px solid ${hexToRgba(catColor, borderAlpha)}; background-color: ${hexToRgba(catColor, 0.18)}; --chip-line-color: ${hexToRgba((sub && sub.color) || catColor, 0.7)};`;
}

function homeChipHtml(task) {
  const catColor = categoryColorForTask(task);
  const sub = subValueForTask(task);
  const time = task.date?.start?.length > 10
    ? new Date(task.date.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const meta = [time, task.duration ? `${task.duration}m` : ''].filter(Boolean).join(' · ');
  const done = Boolean(task.mark);
  const urgent = Boolean(task.urgent);
  const classes = ['cal-chip', done ? 'is-done' : '', !done && !urgent ? 'has-line' : ''].filter(Boolean).join(' ');

  return `
    <div class="${classes}" style="${homeChipStyle(task)}" title="${escapeHtml(task.name)}">
      <span class="cal-chip-name">${escapeHtml(task.name || 'Untitled')}</span>
      <div class="cal-chip-bottom-stack">
        <div class="cal-chip-bottom-row">
          ${shapeEmblemHtml(task, catColor)}
          ${sub ? `<span class="cal-chip-sub-badge" style="border-color:${hexToRgba(sub.color, 0.6)}; background:${hexToRgba(sub.color, 0.18)}; color:${sub.color};">${escapeHtml(sub.value)}</span>` : ''}
          <span class="cal-chip-meta mono">${escapeHtml(meta)}</span>
        </div>
      </div>
    </div>
  `;
}

// 0 = no color; under 5h = yellow; 5-10h = orange; over 10h = red.
function dayLevelClass(minutes) {
  const hours = minutes / 60;
  if (hours === 0) return '';
  if (hours < 5) return 'level-yellow';
  if (hours <= 10) return 'level-orange';
  return 'level-red';
}

function weekMirrorHtml() {
  if (loadError) {
    return `
      <section class="card">
        <h2 class="mono">This week</h2>
        <p class="muted">Couldn't load: ${escapeHtml(loadError)}</p>
      </section>
    `;
  }

  const today = startOfDay(new Date());
  const start = addDays(today, -today.getDay()); // Sunday-based, same as Calendar
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const byDay = {};
  for (const t of allTasks) {
    const day = taskDay(t);
    if (!day) continue;
    (byDay[day] = byDay[day] || []).push(t);
  }
  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || (a.date.start || '').localeCompare(b.date.start || ''));
  }

  const totalsHtml = days.map((d) => {
    const items = byDay[isoDay(d)] || [];
    const minutes = items.reduce((sum, t) => sum + (t.duration || 0), 0);
    const label = minutes > 0 ? `${(minutes / 60).toFixed(1)}h` : '—';
    return `<div class="home-day-total ${dayLevelClass(minutes)}"><span class="mono">${label}</span></div>`;
  }).join('');

  const columnsHtml = days.map((d, i) => {
    const items = byDay[isoDay(d)] || [];
    const isToday = isoDay(d) === isoDay(new Date());
    return `
      <div class="cal-day-col${isToday ? ' is-today' : ''}">
        <div class="cal-day-head mono"><span>${WEEKDAY_NAMES[i]} <span class="muted">${d.getMonth() + 1}/${d.getDate()}</span></span></div>
        <div class="cal-day-items">${items.map(homeChipHtml).join('') || '<p class="muted cal-empty">—</p>'}</div>
      </div>
    `;
  }).join('');

  return `
    <section class="card cal-grid-card">
      <h2 class="mono" style="margin-bottom:12px;">This week</h2>
      <div class="home-day-totals">${totalsHtml}</div>
      <div class="cal-week-grid">${columnsHtml}</div>
    </section>
  `;
}

function hoursSectionHtml() {
  return `
    <section class="card">
      <div class="row-between">
        <h2 class="mono">Hours</h2>
        <div class="range-toggle">
          ${RANGES.map((r) => `<button data-range="${r.key}" class="${r.key === range ? 'active' : ''}">${r.label}</button>`).join('')}
        </div>
      </div>
      <div class="chart-wrap"><canvas id="home-hours-chart" height="240"></canvas></div>
    </section>
  `;
}

function drawHoursChart() {
  const canvas = container.querySelector('#home-hours-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (chart) chart.destroy();
  chart = new Chart(canvas.getContext('2d'), hoursChartConfig(range));
}

function rebuild() {
  if (!container) return;

  container.innerHTML = `
    <div id="home-today"></div>

    ${weekMirrorHtml()}

    ${hoursSectionHtml()}

    ${coursesAndGpaHtml()}

    ${trackViewHtml()}
  `;

  attachEvents();
  drawHoursChart();
  renderTodayPanel(container.querySelector('#home-today'));
}

function attachEvents() {
  container.querySelectorAll('[data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      range = btn.dataset.range;
      container.querySelectorAll('[data-range]').forEach((b) => b.classList.toggle('active', b === btn));
      drawHoursChart();
    });
  });
}
