import { store } from './store.js?v=70';
import { compactOldSessions, dedupeCompactedSessions } from './compaction.js?v=70';

const TABLE_NAMES = ['Courses', 'Items', 'CourseState', 'Categories', 'Sessions', 'PastTerms', 'Settings', 'CanvasFlags', 'RoadmapStatus', 'RoadmapCustom', 'Contacts', 'Projects', 'ProjectMilestones', 'ProjectLog', 'BoardItems', 'ReportNomenclature', 'ReportBlocks'];
const INITIAL_PUSH_KEY = 'dietz:syncInitialized';
// Which tables the deployed backend actually has, from the last bootstrap.
// A table added on the frontend before Code.gs is redeployed makes the old
// backend throw "Unknown table" for the whole batch — which used to block
// every other change from syncing too. Ops for a table not in this list are
// held in the outbox until a bootstrap shows the backend knows it.
const SERVER_TABLES_KEY = 'dietz:serverTables';
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

// Whether this device has its own Apps Script URL + token entered — see
// js/router.js, which redirects every route except /settings and /public to
// /public until this is true (a stranger's device never will be).
export function isConfigured() {
  return !!getConfig();
}

const STATUS_LABELS = {
  unconfigured: '',
  offline: 'Offline',
  syncing: 'Syncing…',
  synced: 'Synced',
};

function setStatus(status, pending = 0) {
  buttonEl?.classList.toggle('is-syncing', status === 'syncing');
  if (!statusEl) return;
  statusEl.dataset.status = status;
  if (status === 'error') {
    statusEl.textContent = `ERROR (${pending})`;
    return;
  }
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

// null until the first bootstrap on this device (then nothing is held back).
function serverTables() {
  try {
    const list = JSON.parse(localStorage.getItem(SERVER_TABLES_KEY) || 'null');
    return Array.isArray(list) ? new Set(list) : null;
  } catch (e) {
    return null;
  }
}

function heldOps() {
  const known = serverTables();
  return known ? store.data.outbox.filter((op) => !known.has(op.table)) : [];
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
  const known = serverTables();
  for (const table of TABLE_NAMES) {
    if (known && !known.has(table)) continue;
    for (const row of store.table(table)) ops.push({ op: 'upsert', table, row });
  }
  await postOps(config, ops);
  localStorage.setItem(INITIAL_PUSH_KEY, 'true');
}

async function pullBootstrap(config) {
  const res = await fetch(`${config.url}?action=bootstrap&token=${encodeURIComponent(config.token)}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  localStorage.setItem(SERVER_TABLES_KEY, JSON.stringify(TABLE_NAMES.filter((t) => Array.isArray(data[t]))));

  // A backend hiccup, a misconfigured URL, or a sheet with renamed/missing
  // tabs can all come back as "everything's empty" — that must never be
  // taken at face value and used to wipe out real local data.
  const incomingTotal = TABLE_NAMES.reduce((sum, t) => sum + (data[t]?.length || 0), 0);
  const localTotal = TABLE_NAMES.reduce((sum, t) => sum + store.table(t).length, 0);
  if (incomingTotal === 0 && localTotal > 0) {
    throw new Error('bootstrap returned no data while local store is non-empty; refusing to overwrite');
  }

  for (const table of TABLE_NAMES) {
    // A table the backend doesn't return at all (a newly added table before
    // Code.gs is redeployed) keeps its local rows instead of being emptied.
    if (Array.isArray(data[table])) store.data[table] = data[table];
  }

  // Re-apply anything still queued in the outbox on top of what the server
  // just returned — a change made while this pull was in flight (or one
  // the server hasn't caught up to serving back yet) is still correct and
  // still pending; the wholesale overwrite above must not silently drop it
  // (it would otherwise persist in its reverted state below, and a refresh
  // before the next sync cycle re-pushes it would make the change look lost).
  for (const op of store.data.outbox) {
    const rows = store.data[op.table];
    if (!rows) continue;
    if (op.op === 'upsert') {
      const idx = rows.findIndex((r) => r.id === op.row.id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...op.row };
      else rows.push(op.row);
    } else if (op.op === 'delete') {
      store.data[op.table] = rows.filter((r) => r.id !== op.id);
    }
  }

  // Enforce every still-held tombstone (see store.js's remove()) against
  // what the server just sent back — catches a row resurrected by a stale/
  // racy server-side copy (the delete that originally queued this
  // tombstone may have already flushed and left the outbox long ago, so
  // the re-apply loop above has nothing left to re-suppress it with).
  // Self-pruning: once a pull confirms the row is actually gone, there's
  // nothing left to guard against, so the tombstone is dropped instead of
  // sitting around forever.
  const remainingTombstones = [];
  for (const t of store.data.tombstones || []) {
    const rows = store.data[t.table];
    if (rows && rows.some((r) => r.id === t.id)) {
      store.data[t.table] = rows.filter((r) => r.id !== t.id);
      store.data.outbox.push({ op: 'delete', table: t.table, id: t.id });
      remainingTombstones.push(t);
    }
  }
  store.data.tombstones = remainingTombstones;

  store.persist();
  // A pull can merge in another device's compacted rows for a day this one
  // also already compacted independently (see dedupeCompactedSessions'
  // comment) — clean those up before compacting anything new, same as on
  // startup (js/app.js).
  dedupeCompactedSessions();
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
      // No table list yet (first sync since this check was added): learn it
      // from a pull first, or one unknown-table op would fail the push below
      // before the pull ever gets to run. The pull re-applies the outbox on
      // top of what it receives, so nothing queued is lost.
      if (!serverTables()) await pullBootstrap(config);
      const held = new Set(heldOps());
      const batch = store.data.outbox.filter((op) => !held.has(op)).slice(0, 200);
      if (batch.length) {
        await postOps(config, batch);
        const sent = new Set(batch);
        store.data.outbox = store.data.outbox.filter((op) => !sent.has(op));
        store.persist();
      }
    }

    await pullBootstrap(config);
    retryDelay = RETRY_BASE_MS;
    const held = heldOps();
    if (held.length) {
      const tables = [...new Set(held.map((op) => op.table))].join(', ');
      console.warn(`Dietz sync: holding ${held.length} change(s) for ${tables} — the deployed Code.gs doesn't have that table yet; redeploy it.`);
    }
    setStatus('synced', held.length);
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
