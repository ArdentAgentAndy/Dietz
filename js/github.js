// A project's README through the Apps Script backend's GitHub proxy (see
// Code.gs: githubReadmeGet_ / githubMarkdown_ / githubReadmePut_). The
// GitHub token lives only in the backend's Script Properties; this side just
// sends the Dietz token, in the POST body (never in a URL).
import { store } from './store.js?v=69';

function getConfig() {
  const settings = store.table('Settings');
  const url = settings.find((s) => s.key === 'appsScriptUrl')?.value;
  const token = settings.find((s) => s.key === 'appsScriptToken')?.value;
  return url && token ? { url, token } : null;
}

async function post(action, fields) {
  const config = getConfig();
  if (!config) return { ok: false, error: 'Apps Script not configured (see Settings)' };
  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ token: config.token, action, ...fields }),
  });
  try {
    return await res.json();
  } catch (err) {
    return { ok: false, error: 'The backend did not answer with JSON. Is the latest Code.gs deployed?' };
  }
}

// A backend from before this proxy doesn't reject an unknown action — it
// treats it as an empty sync and answers { ok: true }. `expect` is the field
// a real answer always has, so that case reads as "unknown action".
async function call(action, fields, expect) {
  const result = await post(action, fields);
  if (result.ok && result[expect] === undefined) return { ok: false, error: 'unknown action' };
  return result;
}

// repo: "owner/repo". -> { ok, path, sha, url, content } | { error }
export function getReadme(repo) {
  return call('github-readme-get', { repo }, 'content');
}

// -> { ok, html } | { error }
export function renderMarkdown(repo, text) {
  return call('github-markdown', { repo, text }, 'html');
}

// sha: the one the README was opened at (a newer one on GitHub is refused).
// -> { ok, sha, commitUrl } | { error }
export function saveReadme(repo, path, content, sha, message) {
  return call('github-readme-put', { repo, path, content, sha, message }, 'sha');
}

// The fine-grained token in Script Properties (GITHUB_TOKEN) expires on this
// day. When it does, editing falls back to read-only until a new one is made
// (same steps: Contents read & write, the same repos) and pasted in. Update
// this date with it.
export const GITHUB_TOKEN_EXPIRES = '2027-08-01';
const EXPIRY_WARN_DAYS = 30;

// -> { text, level: 'ok' | 'soon' | 'expired' } for the Readme window.
export function tokenExpiryNote(today = new Date()) {
  const [y, m, d] = GITHUB_TOKEN_EXPIRES.split('-').map(Number);
  const expires = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((expires - start) / 86400000);
  const label = expires.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (days < 0) return { level: 'expired', text: `GitHub token expired ${label}. Make a new one and replace GITHUB_TOKEN.` };
  if (days === 0) return { level: 'soon', text: `GitHub token expires today (${label}). Make a new one.` };
  if (days <= EXPIRY_WARN_DAYS) return { level: 'soon', text: `GitHub token expires in ${days} day${days === 1 ? '' : 's'} (${label}). Make a new one soon.` };
  return { level: 'ok', text: `Token expires ${label}` };
}

// The backend has no GitHub token/allow-list (or predates this proxy): the
// Readme window falls back to the public read-only view.
export function isProxyUnavailable(result) {
  const err = String(result?.error || '');
  return err === 'github not configured' || err === 'unknown action' || /did not answer with JSON/.test(err);
}
