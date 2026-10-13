// Unauthenticated data for #/public — the page a stranger (someone who will
// never have the Settings-stored token) sees. Deliberately separate from
// notion.js's fetchNotionTasks/getConfig flow: that one needs a token read
// from this device's localStorage, which a stranger's device never has.
// This hits a *different*, token-free Apps Script action (see Code.gs's
// doGet 'public' branch and publicPayload_) that only ever returns an
// already-redacted payload, so there's nothing sensitive to gate here.
//
// The URL itself has to be committed (unlike the token, which never is —
// see CLAUDE.md) since a stranger's browser has no Settings entry to read
// it from. Fill in the real deployed web app URL before this works.
const PUBLIC_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyW8YxP4WCHP1t8zFz5Q_rFOlRUDXEMoRpbESs2AUQRNX0UMakOJLmzbj4T0XfRASy9qA/exec';

const CACHE_KEY = 'dietz:publicCache';

// Last-fetched payload, read synchronously so a reload can render instantly
// instead of showing "Loading…" every time — same reasoning/pattern as
// notion.js's getCachedNotionTasks, just its own cache since this is a
// completely separate (unauthenticated) fetch. fetchPublicData below
// refreshes it in the background.
export function getCachedPublicData() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setCachedPublicData(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    // ignore (private mode, quota, etc.) — cache is a convenience only
  }
}

export async function fetchPublicData() {
  if (!PUBLIC_APPS_SCRIPT_URL || PUBLIC_APPS_SCRIPT_URL.startsWith('REPLACE_WITH_')) {
    return { busy: [], items: [], classes: [], error: 'Public page not configured (js/publicApi.js)' };
  }
  try {
    const res = await fetch(`${PUBLIC_APPS_SCRIPT_URL}?action=public`);
    const data = await res.json();
    if (data.error) return { busy: [], items: [], classes: [], error: data.error };
    const result = { busy: data.busy || [], items: data.items || [], classes: data.classes || [], error: null };
    setCachedPublicData(result);
    return result;
  } catch (e) {
    return { busy: [], items: [], classes: [], error: 'Could not reach the server.' };
  }
}

// The "ping me" button — for friends/family (who, same as the rest of this
// page, never have the owner's token) to get through when the owner's
// phone is on DND. Unauthenticated like fetchPublicData above, but gated by
// its own password instead (see Code.gs's doPost 'ping' branch and
// getPingPassword_ — a cell in the Sheet, never exposed to any browser),
// checked server-side; a wrong one here just means a wrong guess, not a
// leaked secret.
export async function sendPublicPing(password) {
  if (!PUBLIC_APPS_SCRIPT_URL || PUBLIC_APPS_SCRIPT_URL.startsWith('REPLACE_WITH_')) {
    return { ok: false, error: 'Not configured' };
  }
  try {
    const res = await fetch(PUBLIC_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'ping', password }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: 'Could not reach the server.' };
  }
}
