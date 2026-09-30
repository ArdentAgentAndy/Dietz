import { fetchCanvasEvents, getCachedCanvasEvents, setPendingSchedule, takePendingHighlight } from '../canvas.js?v=2';
import { hexForCourse } from '../notionColors.js?v=2';
import { escapeHtml, hexToRgba } from '../format.js?v=2';

let container = null;
let allEvents = [];
let loadError = null;

export function render(rootEl) {
  container = rootEl;
  container.innerHTML = `
    <section class="card"><h1 class="mono">Canvas</h1></section>
    <section class="card"></section>
  `;

  const cached = getCachedCanvasEvents();
  if (cached.length) {
    allEvents = cached;
    renderEvents();
  } else {
    container.querySelector('.card + .card').innerHTML = '<p class="muted">Loading…</p>';
  }
  load();
}

export function unmount() {
  container = null;
}

async function load() {
  const { events, error } = await fetchCanvasEvents();
  if (!container) return;
  if (error && getCachedCanvasEvents().length) return; // keep showing cached data
  allEvents = events;
  loadError = error;
  renderEvents();
}

function deadlineLabel(deadline) {
  if (!deadline) return '';
  const d = deadline.length > 10 ? new Date(deadline) : new Date(deadline + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function eventCardHtml(event) {
  const color = hexForCourse(event.course);
  return `
    <div class="canvas-card" style="border-color:${hexToRgba(color, 0.6)}; background:${hexToRgba(color, 0.14)};" data-name="${escapeHtml(event.name)}" data-course="${escapeHtml(event.course)}" data-deadline="${escapeHtml(event.deadline || '')}">
      <span class="canvas-card-name">${escapeHtml(event.name)}</span>
      <div class="canvas-card-bottom">
        <span class="canvas-card-course mono" style="color:${color};">${escapeHtml(event.course || '—')}</span>
        <span class="canvas-card-date mono">${escapeHtml(deadlineLabel(event.deadline))}</span>
      </div>
    </div>
  `;
}

function renderEvents() {
  if (!container) return;

  if (loadError && !allEvents.length) {
    container.querySelector('.card + .card').innerHTML = `<p class="muted">Couldn't load: ${escapeHtml(loadError)}</p>`;
    return;
  }

  const sorted = [...allEvents].sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''));
  const html = sorted.length
    ? `<div class="canvas-grid">${sorted.map(eventCardHtml).join('')}</div>`
    : '<p class="muted">No Canvas items found.</p>';

  container.querySelector('.card + .card').innerHTML = html;
  attachEvents();
  applyPendingHighlight();
}

function attachEvents() {
  container.querySelectorAll('.canvas-card').forEach((el) => {
    el.addEventListener('click', () => {
      setPendingSchedule({
        name: el.dataset.name,
        course: el.dataset.course,
        deadline: el.dataset.deadline,
      });
      location.hash = '/calendar';
    });
  });
}

// Called both after a normal render and when returning here via the link
// icon on a Calendar card (see calendar.js) — flashes a dashed outline on
// the matching card so it's easy to spot again.
function applyPendingHighlight() {
  const name = takePendingHighlight();
  if (!name || !container) return;
  const match = [...container.querySelectorAll('.canvas-card')].find((el) => el.dataset.name === name);
  if (!match) return;
  match.classList.add('is-highlighted');
  match.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => match.classList.remove('is-highlighted'), 2500);
}
