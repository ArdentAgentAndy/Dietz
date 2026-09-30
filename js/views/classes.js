import { fetchNotionTasks, getCachedNotionTasks } from '../notion.js?v=14';
import { hexForNotionColor } from '../notionColors.js?v=14';
import { escapeHtml, hexToRgba } from '../format.js?v=14';

let container = null;

export function render(rootEl) {
  container = rootEl;
  container.innerHTML = `
    <section class="card">
      <h1 class="mono">Classes</h1>
      <p class="muted">Pulled from Notion (Category: Lesson).</p>
    </section>
    <section class="card"></section>
  `;

  // Cache-first: render whatever we already have instantly (no "Loading…"
  // flash on every tab switch), then silently refresh from the network.
  const cached = getCachedNotionTasks();
  if (cached.length) renderLessons(cached);
  else container.querySelector('.card + .card').innerHTML = '<p class="muted">Loading…</p>';

  load();
}

export function unmount() {
  container = null;
}

function dayLabel(dateStr) {
  if (!dateStr) return 'No date';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}

function timeLabel(dateStr, isDatetime) {
  if (!dateStr || !isDatetime) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function classRowHtml(task) {
  const color = hexForNotionColor(task.courseColor);
  const time = timeLabel(task.date?.start, true);
  const details = [task.location, task.room].filter(Boolean).join(' · ');
  const bg = hexToRgba(color, 0.1);
  return `
    <div class="class-row">
      <span class="class-cell class-cell-course mono" style="background:${bg}; color:${color}; --cell-color:${color};">${escapeHtml(task.course || '—')}</span>
      <span class="class-cell class-cell-time mono" style="background:${bg}; color:var(--red);">${escapeHtml(time)}</span>
      <span class="class-cell class-cell-name" style="background:${bg};">${escapeHtml(task.name || 'Untitled')}</span>
      <span class="class-cell class-cell-duration muted" style="background:${bg};">${task.duration ? `${task.duration}min` : ''}</span>
      <span class="class-cell class-cell-details muted" style="background:${bg};">${escapeHtml(details)}</span>
    </div>
  `;
}

function renderLessons(tasks) {
  const lessons = tasks.filter((t) => t.category === 'Lesson');

  const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const byDay = {};
  for (const task of lessons) {
    const day = dayLabel(task.date?.start);
    (byDay[day] = byDay[day] || []).push(task);
  }
  for (const day of Object.keys(byDay)) {
    byDay[day].sort((a, b) => (a.date?.start || '').localeCompare(b.date?.start || ''));
  }

  const days = Object.keys(byDay).sort((a, b) => {
    const ai = WEEKDAY_ORDER.indexOf(a);
    const bi = WEEKDAY_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // One grid for the whole page (not one per day) — that's what makes every
  // property line up across the entire list, not just within a day's group.
  // Day headers are grid items too, spanning every column.
  const html = days.length
    ? `
      <section class="card">
        <div class="class-list">
          ${days.map((day) => `
            <div class="class-day-heading"><h2 class="mono">${escapeHtml(day)}</h2></div>
            ${byDay[day].map(classRowHtml).join('')}
          `).join('')}
        </div>
      </section>
    `
    : '<section class="card"><p class="muted">No classes found.</p></section>';

  container.querySelector('.card + .card').outerHTML = html;
}

async function load() {
  const { tasks, error } = await fetchNotionTasks();
  if (!container) return;

  if (error) {
    if (!getCachedNotionTasks().length) {
      container.querySelector('.card + .card').innerHTML = `<p class="muted">Couldn't load: ${escapeHtml(error)}</p>`;
    }
    return;
  }

  renderLessons(tasks);
}
