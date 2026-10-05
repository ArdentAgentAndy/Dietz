import { store } from './store.js?v=44';
import { compactOldSessions } from './compaction.js?v=44';

const TABLE_NAMES = ['Courses', 'Items', 'CourseState', 'Categories', 'Sessions', 'PastTerms', 'Settings', 'CanvasFlags', 'RoadmapStatus', 'RoadmapCustom'];
const INITIAL_PUSH_KEY = 'dietz:syncInitialized';
const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 60000;
const PERIODIC_MS = 3 * 60 * 1000;
const DEBOUNCE_MS = 1000;

let statusEl = null;
let buttonEl = null;
let retryDelay = RETRY_BASE_MS;
let retryTimer = null;
let debounceTimer = null;
let syncing = false;

function getConfig() {
  const settings = store.table('Settings');
  const url = settings.find((s) => s.key === 'appsScriptUrl')?.value;
  const token = settings.find((s) => s.key === 'appsScriptToken')?.value;
  return url && token ? { url, token } : null;
}

const STATUS_LABELS = {
  unconfigured: '',
  offline: 'Offline',
  syncing: 'Syncing…',
  synced: 'Synced',
  error: 'Sync error',
};

function setStatus(status, pending = 0) {
  buttonEl?.classList.toggle('is-syncing', status === 'syncing');
  if (!statusEl) return;
  statusEl.dataset.status = status;
  let text = STATUS_LABELS[status] ?? '';
  if (pending > 0 && status !== 'syncing') text += ` (${pending} pending)`;
  statusEl.textContent = text;
}

// The very first time this browser connects to a (possibly empty) sheet,
// pulling bootstrap first would overwrite all local data with nothing.
// Push everything currently in the local store once before the normal
// outbox-based flow takes over.
function needsInitialPush() {
  return localStorage.getItem(INITIAL_PUSH_KEY) !== 'true';
}

async function postOps(config, ops) {
  for (let i = 0; i < ops.length; i += 200) {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ token: config.token, ops: ops.slice(i, i + 200) }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'sync failed');
  }
}

async function pushAllLocalData(config) {
  const ops = [];
  for (const table of TABLE_NAMES) {
    for (const row of store.table(table)) ops.push({ op: 'upsert', table, row });
  }
  await postOps(config, ops);
  localStorage.setItem(INITIAL_PUSH_KEY, 'true');
}

async function pullBootstrap(config) {
  const res = await fetch(`${config.url}?action=bootstrap&token=${encodeURIComponent(config.token)}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);

  // A backend hiccup, a misconfigured URL, or a sheet with renamed/missing
  // tabs can all come back as "everything's empty" — that must never be
  // taken at face value and used to wipe out real local data.
  const incomingTotal = TABLE_NAMES.reduce((sum, t) => sum + (data[t]?.length || 0), 0);
  const localTotal = TABLE_NAMES.reduce((sum, t) => sum + store.table(t).length, 0);
  if (incomingTotal === 0 && localTotal > 0) {
    throw new Error('bootstrap returned no data while local store is non-empty; refusing to overwrite');
  }

  for (const table of TABLE_NAMES) {
    store.data[table] = data[table] || [];
  }
  store.persist();
  // Freshly-pulled data can include old sessions this device hasn't seen
  // yet (e.g. entered from elsewhere) — sweep them into daily totals too.
  compactOldSessions();
}

async function flushOutbox() {
  const config = getConfig();
  if (!config) {
    setStatus('unconfigured');
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus('offline', store.data.outbox.length);
    return;
  }
  if (syncing) return;

  syncing = true;
  setStatus('syncing');
  clearTimeout(retryTimer);

  try {
    if (needsInitialPush()) {
      await pushAllLocalData(config);
      store.data.outbox = [];
      store.persist();
    } else {
      const batch = store.data.outbox.slice(0, 200);
      if (batch.length) {
        await postOps(config, batch);
        store.data.outbox = store.data.outbox.slice(batch.length);
        store.persist();
      }
    }

    await pullBootstrap(config);
    retryDelay = RETRY_BASE_MS;
    setStatus('synced');
  } catch (err) {
    console.error('Dietz sync failed', err);
    setStatus('error', store.data.outbox.length);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    retryTimer = setTimeout(flushOutbox, retryDelay);
  } finally {
    syncing = false;
  }
}

function scheduleSync() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushOutbox, DEBOUNCE_MS);
}

export function requestSync() {
  clearTimeout(debounceTimer);
  flushOutbox();
}

export function initSync(el, syncButtonEl) {
  statusEl = el;
  buttonEl = syncButtonEl;
  setStatus(getConfig() ? 'syncing' : 'unconfigured', store.data.outbox.length);

  buttonEl?.addEventListener('click', requestSync);
  flushOutbox();

  window.addEventListener('dietz:store-changed', scheduleSync);
  window.addEventListener('online', flushOutbox);
  window.addEventListener('offline', () => setStatus('offline', store.data.outbox.length));
  window.addEventListener('focus', flushOutbox);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) flushOutbox();
  });

  setInterval(flushOutbox, PERIODIC_MS);
}
