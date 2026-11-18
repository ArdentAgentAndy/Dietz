import { store } from './store.js?v=70';
import { escapeHtml } from './format.js?v=70';

const CACHE_KEY = 'dietz:notionCache';
const SCHEMA_CACHE_KEY = 'dietz:notionSchemaCache';

function getConfig() {
  const settings = store.table('Settings');
  const url = settings.find((s) => s.key === 'appsScriptUrl')?.value;
  const token = settings.find((s) => s.key === 'appsScriptToken')?.value;
  return url && token ? { url, token } : null;
}

// Last-fetched tasks, read synchronously so a page mount can render
// immediately instead of showing "Loading…" on every tab switch/reload —
// fetchNotionTasks() below then refreshes it in the background.
export function getCachedNotionTasks() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function setCachedNotionTasks(tasks) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(tasks));
  } catch (e) {
    // ignore (private mode, quota, etc.) — cache is a convenience only
  }
}

// Patch the cache in place right after a successful write, instead of
// waiting on the next page's fresh fetch to pick up the change — that
// second round-trip (on top of the one that already happened) is exactly
// the extra delay users notice when a mutation is immediately followed by
// a navigation to a page that reads from this same cache (e.g. Canvas).
export function patchCachedNotionTask(id, patch) {
  const tasks = getCachedNotionTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;
  tasks[idx] = { ...tasks[idx], ...patch };
  setCachedNotionTasks(tasks);
}

export function removeCachedNotionTask(id) {
  setCachedNotionTasks(getCachedNotionTasks().filter((t) => t.id !== id));
}

export function addCachedNotionTask(task) {
  setCachedNotionTasks([...getCachedNotionTasks(), task]);
}

export async function fetchNotionTasks() {
  const config = getConfig();
  if (!config) return { tasks: [], error: 'Apps Script not configured (see Settings)' };

  const res = await fetch(`${config.url}?action=notion-tasks&token=${encodeURIComponent(config.token)}`);
  const data = await res.json();
  if (data.error) return { tasks: [], error: data.error };
  setCachedNotionTasks(data.tasks || []);
  setNotionTasksTruncated(Boolean(data.truncated));
  setNotionTasksCutoff(data.cutoff || '');
  return { tasks: data.tasks || [], error: null, truncated: Boolean(data.truncated) };
}

// yyyy-MM-dd: the backend's lookback cutoff (notionTasksCutoff_ in Code.gs).
// Completed tasks dated before it aren't loaded, so the Agenda stripes those
// days. '' when unknown (no fetch yet, or an older backend).
const CUTOFF_KEY = 'dietz:notionCutoff';

export function getNotionTasksCutoff() {
  try {
    return localStorage.getItem(CUTOFF_KEY) || '';
  } catch (e) {
    return '';
  }
}

function setNotionTasksCutoff(cutoff) {
  try {
    if (cutoff) localStorage.setItem(CUTOFF_KEY, cutoff);
    else localStorage.removeItem(CUTOFF_KEY);
  } catch (e) {
    // ignore
  }
}

// Every new task needs a duration: whole minutes, > 0. Mirrors
// isValidTaskDuration_ in Code.gs, which enforces it server-side too.
export function isValidTaskDuration(value) {
  if (value === '' || value == null) return false;
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

// For the create paths with no form of their own (scheduling a Canvas item,
// a project step's "+ day"): asks for the duration in the view's own
// #modal-dialog. Resolves to the minutes, or null if cancelled. An in-page
// dialog rather than window.prompt, which Chrome can suppress silently
// (resolving as a cancel, so nothing would ever be created).
export function askTaskDuration(dialog, name) {
  return new Promise((resolve) => {
    if (!dialog) { resolve(null); return; }
    dialog.innerHTML = `
      <form method="dialog" class="modal-form">
        <h2 class="mono">Duration</h2>
        <p class="muted">${escapeHtml(name)}</p>
        <label>Minutes
          <input type="number" name="duration" min="1" step="1" required>
        </label>
        <div class="modal-actions">
          <button type="button" data-action="cancel">Cancel</button>
          <button type="submit" class="btn-primary">Add</button>
        </div>
      </form>
    `;
    let result = null;
    const form = dialog.querySelector('form');
    const input = form.querySelector('[name="duration"]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!isValidTaskDuration(input.value)) {
        input.setCustomValidity('A whole number of minutes above 0');
        form.reportValidity();
        return;
      }
      result = Number(input.value);
      dialog.close();
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => resolve(result), { once: true });
    dialog.showModal();
    input.focus();
  });
}

// Whether the last successful fetch hit the backend's row ceiling (see
// notionQueryTasks_ in Code.gs), meaning some tasks were left out. Cached
// alongside the tasks so a cache-first render can warn too.
const TRUNCATED_KEY = 'dietz:notionTruncated';

export function isNotionTasksTruncated() {
  try {
    return localStorage.getItem(TRUNCATED_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function setNotionTasksTruncated(truncated) {
  try {
    if (truncated) localStorage.setItem(TRUNCATED_KEY, '1');
    else localStorage.removeItem(TRUNCATED_KEY);
  } catch (e) {
    // ignore — same as the task cache itself
  }
}

// The real Course/Project/Lead select-option lists, straight from Notion's
// schema — js/views/calendar.js uses this to reject a typo or brand-new
// value before it's ever submitted (posting an unrecognized name to a
// `select` property doesn't error, it silently creates a new option).
// Read synchronously (like getCachedNotionTasks) so validation can run
// without waiting on a fetch; undefined/null until the first successful
// fetchNotionSchema() call, in which case validation is skipped rather than
// blocking on a cache miss.
export function getCachedNotionSchema() {
  try {
    const raw = localStorage.getItem(SCHEMA_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setCachedNotionSchema(schema) {
  try {
    localStorage.setItem(SCHEMA_CACHE_KEY, JSON.stringify(schema));
  } catch (e) {
    // ignore (private mode, quota, etc.) — cache is a convenience only
  }
}

export async function fetchNotionSchema() {
  const config = getConfig();
  if (!config) return { schema: null, error: 'Apps Script not configured (see Settings)' };

  const res = await fetch(`${config.url}?action=notion-schema&token=${encodeURIComponent(config.token)}`);
  const data = await res.json();
  if (data.error) return { schema: null, error: data.error };
  setCachedNotionSchema(data);
  return { schema: data, error: null };
}

// property: 'Urgent' | '?' (whitelisted server-side too — see Code.gs).
// updates: [{ pageId, value: bool }, ...]
export async function pushCheckboxUpdates(property, updates) {
  const config = getConfig();
  if (!config) return { ok: false, error: 'Apps Script not configured (see Settings)' };

  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ token: config.token, action: 'notion-update-checkbox', property, updates }),
  });
  return res.json();
}

// fields: flat field names matching a task's own shape (name, category,
// course/project/lead, date, duration, mark, urgent) — only included fields
// are written; see notionFieldsToProperties_ in Code.gs.
export async function createTask(fields) {
  const config = getConfig();
  if (!config) return { ok: false, error: 'Apps Script not configured (see Settings)' };
  if (!isValidTaskDuration(fields?.duration)) return { ok: false, error: 'A duration (minutes) is required for a new task' };

  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ token: config.token, action: 'notion-create-task', fields }),
  });
  return res.json();
}

export async function updateTask(pageId, fields) {
  const config = getConfig();
  if (!config) return { ok: false, error: 'Apps Script not configured (see Settings)' };

  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ token: config.token, action: 'notion-update-task', pageId, fields }),
  });
  return res.json();
}

// Add or remove one option of Notion's Project or Lead select (see
// notionSelectOption_ in Code.gs). Removing one clears it from every task
// that used it, and Notion has no undo for that. color: a Notion color name,
// only used when adding. Refreshes the cached schema on success.
export async function editNotionSelectOption(property, op, name, color) {
  const config = getConfig();
  if (!config) return { ok: false, error: 'Apps Script not configured (see Settings)' };

  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ token: config.token, action: 'notion-select-option', property, op, name, color }),
  });
  const data = await res.json();
  if (data.ok) await fetchNotionSchema().catch(() => {});
  return data;
}

// "Delete" archives the page in Notion (its own trash, recoverable there).
export async function deleteTask(pageId) {
  const config = getConfig();
  if (!config) return { ok: false, error: 'Apps Script not configured (see Settings)' };

  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ token: config.token, action: 'notion-delete-task', pageId }),
  });
  return res.json();
}
