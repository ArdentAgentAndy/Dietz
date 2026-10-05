import { store } from './store.js?v=50';

const CACHE_KEY = 'dietz:notionCache';

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
  return { tasks: data.tasks || [], error: null };
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
