// A project's README through the Apps Script backend's GitHub proxy (see
// Code.gs: githubReadmeGet_ / githubMarkdown_ / githubReadmePut_). The
// GitHub token lives only in the backend's Script Properties; this side just
// sends the Dietz token, in the POST body (never in a URL).
import { store } from './store.js?v=68';

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

// The backend has no GitHub token/allow-list (or predates this proxy): the
// Readme window falls back to the public read-only view.
export function isProxyUnavailable(result) {
  const err = String(result?.error || '');
  return err === 'github not configured' || err === 'unknown action' || /did not answer with JSON/.test(err);
}
