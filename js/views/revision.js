// Revision subchannel (Academics > Revision) — one horizontal bar per active
// course, total hours ever logged against it. Deliberately its own page,
// never combined with Logging's existing daily hours line-graph (separate
// purposes: that one shows a daily trend across all study types, this one
// shows a lifetime total per course).
//
// A course's total = js/courseState.js's running `totalRevisionMinutes`
// (minutes already folded in by js/compaction.js when it compacted and
// deleted old sessions, discarding their courseId) + a live sum of
// whatever revision Sessions rows for that course still exist uncompacted
// (today/yesterday, or anything not yet compacted). Each minute is counted
// in exactly one of those two places, never both: compaction.js adds to
// CourseState in the same step it deletes the raw rows, so a session is
// either still live and counted here directly, or already folded into
// CourseState and gone — summing both, rather than just CourseState alone,
// is what keeps the chart accurate without waiting a day for new time
// logged just now to show up.
import { store } from '../store.js?v=65';
import { getCourseState } from '../courseState.js?v=65';
import { hexForCourse } from '../notionColors.js?v=65';

let container = null;
let chart = null;

export function render(rootEl) {
  container = rootEl;
  container.innerHTML = `
    <section class="card">
      <h1 class="mono">Revision</h1>
      <p class="muted">All-time study hours per active course.</p>
    </section>
    <section class="card">
      <div class="chart-wrap"><canvas id="revision-chart" height="320"></canvas></div>
    </section>
  `;
  drawChart();
}

export function unmount() {
  if (chart) chart.destroy();
  chart = null;
  container = null;
}

function liveRevisionMinutesForCourse(courseId) {
  const cat = store.table('Categories').find((c) => c.group === 'revision' && c.courseId === courseId);
  if (!cat) return 0;
  return store.table('Sessions')
    .filter((s) => s.categoryId === cat.id)
    .reduce((sum, s) => sum + s.minutes, 0);
}

function totalRevisionMinutesForCourse(courseId) {
  return (getCourseState(courseId).totalRevisionMinutes || 0) + liveRevisionMinutesForCourse(courseId);
}

function revisionChartConfig() {
  const courses = store.table('Courses')
    .filter((c) => c.status === 'active')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const labels = courses.map((c) => c.code);
  const hours = courses.map((c) => Math.round((totalRevisionMinutesForCourse(c.id) / 60) * 100) / 100);
  const colors = courses.map((c) => hexForCourse(c));
  const mutedInk = 'rgba(240, 239, 244, 0.65)';
  const gridColor = 'rgba(255, 255, 255, 0.08)';

  return {
    type: 'bar', // Chart.js v4 (see index.html) — v3+ syntax, not v2's 'horizontalBar'
    data: { labels, datasets: [{ label: 'Hours', data: hours, backgroundColor: colors, borderRadius: 4 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e1e24',
          titleColor: '#f0eff4',
          bodyColor: '#f0eff4',
          borderColor: 'rgba(255,255,255,0.15)',
          borderWidth: 1,
          callbacks: { label: (ctx) => `${ctx.parsed.x}h` },
        },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: mutedInk }, title: { display: true, text: 'Hours', color: mutedInk } },
        y: { grid: { display: false }, ticks: { color: mutedInk } },
      },
    },
  };
}

function drawChart() {
  const canvas = container?.querySelector('#revision-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (chart) chart.destroy();
  chart = new Chart(canvas.getContext('2d'), revisionChartConfig());
}
