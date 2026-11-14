import { escapeHtml, hexToRgba, formatDateISO, formatShortDate } from '../format.js?v=68';
import { projectBySlug } from '../projects.js?v=68';
import { projectMinutesByWeek, projectMinutesOnDay, weekStart } from '../projectHours.js?v=68';
import {
  PITCH_FIELDS, getPitch, savePitch,
  parseGithubRepo, getGithubRepo, saveGithubRepo,
  milestoneTree, milestoneProgress,
  addMilestone, updateMilestone, moveMilestone, deleteMilestone, descendantCount,
  linkTask, unlinkTask, allLinkedTaskIds,
  getLinks, normalizeUrl, addLink, removeLink,
  logEntries, addLogEntry, deleteLogEntry,
} from '../projectPlan.js?v=68';
import {
  fetchNotionTasks, getCachedNotionTasks, createTask, pushCheckboxUpdates,
  addCachedNotionTask, patchCachedNotionTask,
} from '../notion.js?v=68';
import { taskDay } from '../taskDisplay.js?v=68';

// One project's own page (#/projects/<slug>): header (name, logged hours,
// milestone position, back + Pitch buttons), the milestones (phases A, B,
// ... -> checkpoints 1, 2, ... -> steps 3.1, 3.2, ...), the log, and
// resources (links). The pitch opens in a dialog from the header's Pitch
// button. Data: js/projectPlan.js. Built on Spindock first, the same page
// serves every project.

let container = null;
let slug = null;
// UI state that survives rebuilds.
let editingId = null; // milestone whose title is being edited inline
let editingIsNew = false; // that milestone was just added (empty title -> discard)
let busyStepId = null; // step whose Notion task is being created
let saveError = null; // last failed Notion write, shown on the Milestones card
let currentProject = null; // { name, slug, hex, ... } from the last rebuild

export function render(rootEl, params) {
  container = rootEl;
  slug = params.id;
  editingId = null;
  editingIsNew = false;
  busyStepId = null;
  saveError = null;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('dietz:store-changed', onStoreChanged);
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  rebuild();
  // Fresh task states (linked steps check off from them). A failure just
  // keeps the cached ones.
  fetchNotionTasks().then(() => { if (container && !editingId) rebuild(); }).catch(() => {});
}

export function unmount() {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('dietz:store-changed', onStoreChanged);
  if (container) {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
  }
  container = null;
}

// Any data change (this page's own edits, or another device's via sync).
// Not while a title is being typed, so a rebuild can't throw that away. An
// open dialog (pitch, task picker) also holds rebuilds off; see rebuild().
function onStoreChanged() {
  if (!container || editingId) return;
  rebuild();
}

function onKeyDown(e) {
  if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, textarea, select')) return;
  e.preventDefault();
  location.hash = '#/projects';
}

function hoursText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// Today / This week / All time, shown next to the title.
function hoursStatsHtml(name) {
  const todayISO = formatDateISO(new Date());
  const byWeek = projectMinutesByWeek(name);
  const stats = [
    ['Today', projectMinutesOnDay(name, todayISO)],
    ['This week', byWeek[weekStart(todayISO)] || 0],
    ['All time', Object.values(byWeek).reduce((sum, m) => sum + m, 0)],
  ];
  return `
    <div class="project-hours-stats mono">
      ${stats.map(([label, minutes]) => `<span><span class="muted">${label}:</span> <strong>${hoursText(minutes)}</strong></span>`).join('')}
    </div>
  `;
}

// "At B · 3.2" plus a steps-done bar, under the title row.
function progressHtml(progress, hex) {
  if (!progress.total) return '';
  const pct = Math.round((progress.done / progress.total) * 100);
  return `
    <div class="project-progress mono">
      <span>${progress.current ? `<span class="muted">At</span> <strong>${escapeHtml(progress.current)}</strong>` : '<strong>All steps done</strong>'}</span>
      <span class="project-progress-bar" style="--bar-color:${hex};"><span style="width:${pct}%;"></span></span>
      <span class="muted">${progress.done}/${progress.total} steps</span>
    </div>
  `;
}

// --- Pitch (dialog from the header's Pitch button) ----------------------

function pitchViewHtml(saved) {
  const filled = PITCH_FIELDS.filter((f) => String(saved[f.key] || '').trim());
  if (!filled.length) return '<p class="muted">No pitch yet. It\'s the version of this project you\'d pitch to a professor.</p>';
  return `
    <dl class="project-pitch">
      ${filled.map((f) => `
        <dt class="mono muted">${escapeHtml(f.label)}</dt>
        <dd class="${f.key === 'pitch_hook' ? 'project-pitch-hook' : ''}">${escapeHtml(String(saved[f.key]).trim())}</dd>
      `).join('')}
    </dl>
  `;
}

// View mode first (Edit switches the same dialog to the form). Escape in
// the form goes back to the view instead of closing, so a half-typed edit
// isn't lost to a stray Escape; Cancel does the same.
function openPitchDialog() {
  const dialog = container.querySelector('#modal-dialog');
  if (!dialog || !currentProject) return;
  let editing = false;

  const showView = () => {
    editing = false;
    dialog.innerHTML = `
      <div class="modal-form project-pitch-dialog">
        <h2 class="mono">Pitch</h2>
        ${pitchViewHtml(getPitch(slug))}
        <div class="modal-actions">
          <button type="button" data-pitch-close>Close</button>
          <button type="button" class="btn-primary" data-pitch-edit>Edit</button>
        </div>
      </div>
    `;
    dialog.querySelector('[data-pitch-close]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-pitch-edit]').addEventListener('click', showForm);
  };

  const showForm = () => {
    editing = true;
    const saved = getPitch(slug);
    dialog.innerHTML = `
      <form class="modal-form project-pitch-form project-pitch-dialog" data-pitch-form>
        <h2 class="mono">Edit pitch</h2>
        ${PITCH_FIELDS.map((f) => `
          <label>${escapeHtml(f.label)}
            <textarea name="${f.key}" rows="${f.key === 'pitch_hook' ? 2 : 5}" placeholder="${escapeHtml(f.hint)}">${escapeHtml(saved[f.key] || '')}</textarea>
          </label>
        `).join('')}
        <div class="modal-actions">
          <button type="button" data-pitch-cancel>Cancel</button>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>
    `;
    const form = dialog.querySelector('[data-pitch-form]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const fields = {};
      for (const f of PITCH_FIELDS) fields[f.key] = String(data.get(f.key) || '').trim();
      savePitch(slug, fields);
      showView();
    });
    dialog.querySelector('[data-pitch-cancel]').addEventListener('click', showView);
    form.querySelector('textarea')?.focus();
  };

  const onCancel = (e) => {
    if (!editing) return;
    e.preventDefault();
    showView();
  };
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', () => {
    dialog.removeEventListener('cancel', onCancel);
    dialog.classList.remove('is-wide');
    rebuild();
  }, { once: true });

  dialog.classList.add('is-wide');
  showView();
  dialog.showModal();
}

// --- Readme (pulled from the project's GitHub repo) ---------------------

// The repo is stored on the project's own row (Projects.github), set from
// the header's GitHub button — the Readme reads the same one.
function githubRepo() {
  return getGithubRepo(slug);
}

function githubUrl(repo) {
  return `https://github.com/${repo.owner}/${repo.repo}`;
}

// Header split button. With a repo: "GitHub ↗" opens it, ⧉ copies its URL,
// ✎ changes it. Without one: a single "+ GitHub" button that asks for it.
function githubButtonHtml() {
  const repo = githubRepo();
  if (!repo) {
    return '<button type="button" class="project-gh-add" data-action="edit-github" title="Link this project\'s GitHub repo">+ GitHub</button>';
  }
  const url = githubUrl(repo);
  return `
    <span class="btn project-gh">
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="project-gh-open" title="${escapeHtml(url)}">GitHub ↗</a>
      <button type="button" class="project-gh-part" data-action="copy-github" data-url="${escapeHtml(url)}" title="Copy repo link" aria-label="Copy repo link">⧉</button>
      <button type="button" class="project-gh-part" data-action="edit-github" title="Change repo link" aria-label="Change repo link">✎</button>
    </span>
  `;
}

// Small form in the shared dialog: paste a URL (or owner/repo); Remove
// clears it.
function openGithubDialog() {
  const dialog = container.querySelector('#modal-dialog');
  if (!dialog) return;
  const current = githubRepo();
  dialog.innerHTML = `
    <form class="modal-form" data-github-form>
      <h2 class="mono">GitHub repo</h2>
      <label>Repo link
        <input type="text" name="github" value="${current ? escapeHtml(githubUrl(current)) : ''}" placeholder="https://github.com/owner/repo" autocomplete="off">
      </label>
      <div class="modal-actions">
        ${current ? '<button type="button" class="btn-danger" data-github-remove>Remove</button>' : ''}
        <button type="button" data-github-cancel>Cancel</button>
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>
  `;
  const form = dialog.querySelector('[data-github-form]');
  const input = form.querySelector('input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const repo = parseGithubRepo(input.value);
    if (!repo) {
      input.setCustomValidity('Paste a github.com repo link, or owner/repo.');
      input.reportValidity();
      return;
    }
    saveGithubRepo(slug, repo);
    dialog.close();
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
  dialog.querySelector('[data-github-cancel]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-github-remove]')?.addEventListener('click', () => {
    saveGithubRepo(slug, null);
    dialog.close();
  });
  dialog.addEventListener('close', () => rebuild(), { once: true });
  dialog.showModal();
  input.focus();
  input.select();
}

async function copyGithub(btn) {
  try {
    await navigator.clipboard.writeText(btn.dataset.url);
    btn.textContent = '✓';
    btn.classList.add('is-copied');
  } catch (e) {
    btn.textContent = '✕';
  }
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.textContent = '⧉';
    btn.classList.remove('is-copied');
  }, 1200);
}

// GitHub's own rendered HTML (application/vnd.github.html+json) — already
// sanitized by GitHub. Unauthenticated: public repos only, 60 requests/hour
// per IP.
async function fetchReadmeHtml({ owner, repo }) {
  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`, {
    headers: { Accept: 'application/vnd.github.html+json' },
  });
  if (res.status === 404) throw new Error(`No README found in ${owner}/${repo} (or the repo is private).`);
  if (res.status === 403) throw new Error('GitHub rate limit hit (60 per hour without a token). Try again later.');
  if (!res.ok) throw new Error(`GitHub returned ${res.status}.`);
  return absolutizeReadme(await res.text(), owner, repo);
}

// The rendered HTML keeps the README's own relative paths
// (_docs/images/orbit.png), which would resolve against this app instead of
// the repo. Images -> raw files, other links -> the file on github.com,
// external links open in a new tab. In-page "#x" links are left as
// data-readme-anchor (a real "#x" would hijack this app's #/ routing) and
// scrolled to by openReadmeDialog.
function absolutizeReadme(html, owner, repo) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const path = doc.querySelector('[data-path]')?.getAttribute('data-path') || 'README.md';
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`;
  const blobBase = `https://github.com/${owner}/${repo}/blob/HEAD/${path}`;
  const isRelative = (v) => v && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(v);

  doc.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (isRelative(src)) img.setAttribute('src', new URL(src, rawBase).href);
  });
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      a.removeAttribute('href');
      a.setAttribute('data-readme-anchor', decodeURIComponent(href.slice(1)));
      return;
    }
    if (isRelative(href)) a.setAttribute('href', new URL(href, blobBase).href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  return doc.body.innerHTML;
}

function openReadmeDialog() {
  const dialog = container.querySelector('#modal-dialog');
  if (!dialog || !currentProject) return;
  const repo = githubRepo();
  const repoUrl = repo ? githubUrl(repo) : '';

  const frame = (body) => `
    <div class="modal-form project-pitch-dialog">
      <div class="project-readme-head">
        <h2 class="mono">Readme</h2>
        ${repo ? `<a href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener noreferrer" class="mono muted">${escapeHtml(`${repo.owner}/${repo.repo}`)} ↗</a>` : ''}
      </div>
      ${body}
      <div class="modal-actions">
        <button type="button" data-readme-close>Close</button>
      </div>
    </div>
  `;
  const show = (body) => {
    dialog.innerHTML = frame(body);
    dialog.querySelector('[data-readme-close]').addEventListener('click', () => dialog.close());
  };

  dialog.addEventListener('close', () => {
    dialog.classList.remove('is-wide');
    rebuild();
  }, { once: true });
  dialog.classList.add('is-wide');

  if (!repo) {
    show('<p class="muted">No GitHub repo linked yet. Add it with the "+ GitHub" button at the top of the page, then open this again.</p>');
    dialog.showModal();
    return;
  }

  show('<p class="muted mono">Loading README from GitHub…</p>');
  dialog.showModal();
  fetchReadmeHtml(repo)
    .then((html) => {
      if (!dialog.open) return;
      show(`<div class="readme-body">${html}</div>`);
      // GitHub prefixes heading ids with "user-content-".
      dialog.querySelectorAll('[data-readme-anchor]').forEach((a) => {
        a.addEventListener('click', () => {
          const id = a.dataset.readmeAnchor;
          const target = dialog.querySelector(`[id="user-content-${CSS.escape(id)}"], [id="${CSS.escape(id)}"]`);
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    })
    .catch((err) => { if (dialog.open) show(`<p class="project-error">${escapeHtml(err.message)}</p>`); });
}

// --- Milestones --------------------------------------------------------

function titleHtml(node, placeholder) {
  if (node.id === editingId) {
    return `<input type="text" class="ms-title-input" data-title-input="${node.id}" value="${escapeHtml(node.title || '')}" placeholder="${placeholder}">`;
  }
  const title = String(node.title || '').trim();
  return `<span class="ms-title" data-action="edit-title" data-id="${node.id}" title="Click to rename">${title ? escapeHtml(title) : `<span class="muted">${placeholder}</span>`}</span>`;
}

function actionsHtml(node, addLabel, addAction, extra = '') {
  return `
    <span class="ms-actions">
      ${extra}
      ${addAction ? `<button type="button" class="ms-btn" data-action="${addAction}" data-id="${node.id}">+ ${addLabel}</button>` : ''}
      <button type="button" class="ms-btn" data-action="move-up" data-id="${node.id}" title="Move up">↑</button>
      <button type="button" class="ms-btn" data-action="move-down" data-id="${node.id}" title="Move down">↓</button>
      <button type="button" class="ms-btn ms-btn-danger" data-action="delete" data-id="${node.id}" title="Delete">✕</button>
    </span>
  `;
}

// A linked Notion task under its step: done state, name, date, unlink.
function linkedTaskHtml(step, task) {
  const day = taskDay(task);
  return `
    <li class="ms-task${task.mark ? ' is-done' : ''}">
      <span class="ms-task-state" aria-hidden="true">${task.mark ? '✓' : '○'}</span>
      <span class="ms-task-name">${escapeHtml(task.name || 'Untitled')}</span>
      ${day ? `<span class="ms-task-date mono muted">${escapeHtml(formatShortDate(day))}</span>` : ''}
      <button type="button" class="ms-btn ms-task-unlink" data-action="unlink-task" data-id="${step.id}" data-task-id="${task.id}" title="Unlink (the task stays in Notion)">✕</button>
    </li>
  `;
}

function stepHtml(step) {
  const linked = step.linkedTasks.length > 0;
  const busy = busyStepId === step.id;
  const stepButtons = `
    <button type="button" class="ms-btn" data-action="make-task" data-id="${step.id}" ${busy ? 'disabled' : ''} title="Create a Notion task for this step">${busy ? 'Creating…' : '+ task'}</button>
    <button type="button" class="ms-btn" data-action="link-task" data-id="${step.id}" title="Link an existing task">link</button>
  `;
  return `
    <li class="ms-step${step.complete ? ' is-done' : ''}">
      <div class="ms-row ms-row-step">
        <input type="checkbox" class="ms-check" data-step-check="${step.id}" ${step.complete ? 'checked' : ''}
          aria-label="Done" title="${linked ? 'Done when its linked tasks are done; ticking marks them done in Notion' : 'Done'}">
        <span class="ms-code mono">${step.code}</span>
        ${titleHtml(step, 'Untitled step')}
        ${actionsHtml(step, '', '', stepButtons)}
      </div>
      ${linked ? `<ul class="ms-tasks">${step.linkedTasks.map((t) => linkedTaskHtml(step, t)).join('')}</ul>` : ''}
    </li>
  `;
}

function checkpointHtml(cp) {
  const total = cp.steps.length;
  const done = cp.steps.filter((s) => s.complete).length;
  const complete = total > 0 && done === total;
  const target = cp.targetDate ? String(cp.targetDate).slice(0, 10) : '';
  return `
    <div class="ms-checkpoint${complete ? ' is-done' : ''}">
      <div class="ms-row ms-row-checkpoint">
        <span class="ms-code ms-code-checkpoint mono">${cp.code}</span>
        ${titleHtml(cp, 'Untitled checkpoint')}
        <span class="ms-meta mono muted">${total ? `${done}/${total}` : ''}</span>
        <label class="ms-target mono muted" title="Target date">
          <input type="date" data-target-date="${cp.id}" value="${escapeHtml(target)}">
        </label>
        ${actionsHtml(cp, 'step', 'add-step')}
      </div>
      ${cp.steps.length ? `<ul class="ms-steps">${cp.steps.map(stepHtml).join('')}</ul>` : ''}
    </div>
  `;
}

function phaseHtml(phase, hex) {
  const steps = phase.checkpoints.flatMap((cp) => cp.steps);
  const done = steps.filter((s) => s.complete).length;
  return `
    <div class="ms-phase" style="--phase-color:${hex};">
      <div class="ms-row ms-row-phase">
        <span class="ms-code ms-code-phase mono">${phase.code}</span>
        ${titleHtml(phase, 'Untitled phase')}
        <span class="ms-meta mono muted">${steps.length ? `${done}/${steps.length}` : ''}</span>
        ${actionsHtml(phase, 'checkpoint', 'add-checkpoint')}
      </div>
      ${phase.checkpoints.map(checkpointHtml).join('')}
    </div>
  `;
}

function milestonesHtml(tree, hex) {
  if (!tree.length) {
    return '<p class="muted">No milestones yet. Start with a phase (A), then add checkpoints and their steps.</p>';
  }
  return `<div class="ms-tree">${tree.map((p) => phaseHtml(p, hex)).join('')}</div>`;
}

// --- Log, resources ----------------------------------------------------

function logHtml() {
  const entries = logEntries(slug);
  return `
    <form class="project-inline-form" data-log-form>
      <input type="date" name="date" value="${formatDateISO(new Date())}" data-keep="log-date" aria-label="Date">
      <textarea name="text" rows="2" placeholder="Progress, a decision, a blocker…" data-keep="log-text" required></textarea>
      <button type="submit">Add</button>
    </form>
    ${entries.length ? `
      <ul class="project-log">
        ${entries.map((l) => `
          <li>
            <span class="project-log-date mono muted">${l.date ? escapeHtml(formatShortDate(l.date)) : ''}</span>
            <span class="project-log-text">${escapeHtml(String(l.text || ''))}</span>
            <button type="button" class="ms-btn ms-btn-danger project-row-delete" data-action="delete-log" data-id="${l.id}" title="Delete">✕</button>
          </li>
        `).join('')}
      </ul>
    ` : '<p class="muted">Nothing logged yet.</p>'}
  `;
}

function resourcesHtml() {
  const links = getLinks(slug);
  return `
    ${links.length ? `
      <ul class="project-links">
        ${links.map((l, i) => {
          const url = normalizeUrl(l.url);
          let host = '';
          try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* bad url */ }
          return `
            <li>
              ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || host || url)}</a>` : `<span>${escapeHtml(l.label || l.url)}</span>`}
              ${host && l.label ? `<span class="mono muted project-link-host">${escapeHtml(host)}</span>` : ''}
              <button type="button" class="ms-btn ms-btn-danger project-row-delete" data-action="delete-link" data-index="${i}" title="Remove">✕</button>
            </li>
          `;
        }).join('')}
      </ul>
    ` : '<p class="muted">No links yet: repo, docs, drive folder, papers…</p>'}
    <form class="project-inline-form" data-link-form>
      <input type="text" name="label" placeholder="Label (optional)" data-keep="link-label">
      <input type="text" name="url" placeholder="https://…" data-keep="link-url" required>
      <button type="submit">Add</button>
    </form>
  `;
}

// --- Events ------------------------------------------------------------

function startEditing(id, isNew = false) {
  editingId = id;
  editingIsNew = isNew;
  rebuild();
}

function add(kind, parentId) {
  const row = addMilestone(slug, kind, parentId, '');
  startEditing(row.id, true);
}

function commitTitle(input, save) {
  const id = input.dataset.titleInput;
  if (id !== editingId) return; // already handled (blur after Enter/Esc)
  const title = input.value.trim();
  const wasNew = editingIsNew;
  editingId = null;
  editingIsNew = false;
  if (wasNew && (!save || !title)) deleteMilestone(id);
  else if (save && title) updateMilestone(id, { title });
  rebuild();
}

function findStep(stepId) {
  return milestoneTree(slug, getCachedNotionTasks())
    .flatMap((p) => p.checkpoints).flatMap((cp) => cp.steps)
    .find((s) => s.id === stepId);
}

// "+ task": a Notion task (category Project, this project) named after the
// step, e.g. "3.1 Mesh solver", linked to it. The code in the name is a
// snapshot; it doesn't follow later reordering. The link itself is by id.
async function makeTask(stepId) {
  const step = findStep(stepId);
  if (!step || !currentProject || busyStepId) return;
  busyStepId = stepId;
  saveError = null;
  rebuild();
  const title = String(step.title || '').trim();
  let result;
  try {
    result = await createTask({ name: title ? `${step.code} ${title}` : step.code, category: 'Project', project: currentProject.name });
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  busyStepId = null;
  if (result.ok && result.task) {
    addCachedNotionTask(result.task);
    linkTask(stepId, result.task.id); // rebuilds via store change
  } else {
    saveError = result.error || 'Failed to create the task';
  }
  if (container && !editingId) rebuild();
}

// Ticking a step that has linked tasks marks them all done (or not done) in
// Notion, since that's what decides the step. Optimistic, reverted on failure.
async function setLinkedTasksDone(step, done) {
  const changed = step.linkedTasks.filter((t) => Boolean(t.mark) !== done);
  if (!changed.length) return;
  for (const t of changed) patchCachedNotionTask(t.id, { mark: done });
  saveError = null;
  rebuild();
  let result;
  try {
    result = await pushCheckboxUpdates('?', changed.map((t) => ({ pageId: t.id, value: done })));
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  if (!result.ok) {
    for (const t of changed) patchCachedNotionTask(t.id, { mark: Boolean(t.mark) });
    saveError = result.error || 'Failed to update the tasks in Notion';
  }
  if (container && !editingId) rebuild();
}

// Picker: this project's tasks not linked to any step yet, open ones first.
function openLinkPicker(stepId) {
  const step = findStep(stepId);
  const dialog = container.querySelector('#modal-dialog');
  if (!step || !dialog || !currentProject) return;
  const taken = allLinkedTaskIds(slug);
  const tasks = getCachedNotionTasks()
    .filter((t) => t.category === 'Project' && t.project === currentProject.name && !taken.has(t.id))
    .sort((a, b) => Number(Boolean(a.mark)) - Number(Boolean(b.mark)) || (taskDay(a) || '9').localeCompare(taskDay(b) || '9'));
  dialog.innerHTML = `
    <div class="modal-form">
      <h2 class="mono">Link a task to ${escapeHtml(step.code)}</h2>
      ${tasks.length ? `
        <ul class="ms-picker">
          ${tasks.map((t) => `
            <li><button type="button" class="ms-picker-item${t.mark ? ' is-done' : ''}" data-pick-task="${t.id}">
              <span>${t.mark ? '✓' : '○'} ${escapeHtml(t.name || 'Untitled')}</span>
              <span class="mono muted">${taskDay(t) ? escapeHtml(formatShortDate(taskDay(t))) : ''}</span>
            </button></li>
          `).join('')}
        </ul>
      ` : `<p class="muted">No unlinked ${escapeHtml(currentProject.name)} tasks. Use "+ task" to make one, or add one in Agenda with category Project and project ${escapeHtml(currentProject.name)}.</p>`}
      <div class="modal-actions">
        <button type="button" data-picker-close>Cancel</button>
      </div>
    </div>
  `;
  dialog.addEventListener('close', () => rebuild(), { once: true });
  dialog.querySelector('[data-picker-close]').addEventListener('click', () => dialog.close());
  dialog.querySelectorAll('[data-pick-task]').forEach((btn) => {
    btn.addEventListener('click', () => {
      dialog.close();
      linkTask(stepId, btn.dataset.pickTask);
    });
  });
  dialog.showModal();
}

function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || !container.contains(btn)) return;
  const id = btn.dataset.id;
  switch (btn.dataset.action) {
    case 'make-task': makeTask(id); break;
    case 'link-task': openLinkPicker(id); break;
    case 'unlink-task': unlinkTask(id, btn.dataset.taskId); break;
    case 'delete-log': deleteLogEntry(id); break;
    case 'delete-link': removeLink(slug, Number(btn.dataset.index)); break;
    case 'pitch-open': openPitchDialog(); break;
    case 'readme-open': openReadmeDialog(); break;
    case 'copy-github': copyGithub(btn); break;
    case 'edit-github': openGithubDialog(); break;
    case 'report-open': location.hash = `#/projects/${encodeURIComponent(slug)}/report`; break;
    case 'add-phase': add('phase', ''); break;
    case 'add-checkpoint': add('checkpoint', id); break;
    case 'add-step': add('step', id); break;
    case 'edit-title': startEditing(id); break;
    case 'move-up': moveMilestone(id, -1); break;
    case 'move-down': moveMilestone(id, 1); break;
    case 'delete': {
      const under = descendantCount(id);
      if (under && !confirm(`Delete this and the ${under} item${under === 1 ? '' : 's'} under it?`)) return;
      deleteMilestone(id);
      break;
    }
    default: return;
  }
}

function onChange(e) {
  const check = e.target.closest('[data-step-check]');
  if (check) {
    const step = findStep(check.dataset.stepCheck);
    if (step?.linkedTasks.length) setLinkedTasksDone(step, check.checked);
    else updateMilestone(check.dataset.stepCheck, { done: check.checked });
    return;
  }
  const date = e.target.closest('[data-target-date]');
  if (date) updateMilestone(date.dataset.targetDate, { targetDate: date.value });
}

function wireAfterRender() {
  const logForm = container.querySelector('[data-log-form]');
  logForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(logForm);
    const text = String(data.get('text') || '').trim();
    if (!text) return;
    logForm.querySelector('[name="text"]').value = '';
    logForm.querySelector('[name="date"]').value = formatDateISO(new Date()); // next entry defaults to today again
    addLogEntry(slug, String(data.get('date') || formatDateISO(new Date())), text);
  });
  // Ctrl/Cmd+Enter adds from the textarea.
  logForm?.querySelector('textarea').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); logForm.requestSubmit(); }
  });

  const linkForm = container.querySelector('[data-link-form]');
  linkForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(linkForm);
    const url = normalizeUrl(data.get('url'));
    const urlInput = linkForm.querySelector('[name="url"]');
    if (!url) {
      urlInput.setCustomValidity('Enter a web address (http or https).');
      urlInput.reportValidity();
      return;
    }
    linkForm.querySelector('[name="label"]').value = '';
    urlInput.value = '';
    addLink(slug, data.get('label'), url);
  });
  linkForm?.querySelector('[name="url"]').addEventListener('input', (e) => e.target.setCustomValidity(''));

  const input = container.querySelector('[data-title-input]');
  if (input) {
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitTitle(input, true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commitTitle(input, false); }
    });
    input.addEventListener('blur', () => commitTitle(input, true));
  }
}

function rebuild() {
  if (!container) return;
  // The dialog (task picker, pitch) lives in this markup. Wait for it to
  // close (its close handler rebuilds).
  if (container.querySelector('#modal-dialog[open]')) return;

  // Half-typed log/link text (and which of those fields had focus) survives
  // the rebuild too.
  const kept = {};
  container.querySelectorAll('[data-keep]').forEach((el) => { kept[el.dataset.keep] = el.value; });
  const focusedKeep = document.activeElement?.dataset?.keep || null;

  const project = projectBySlug(slug);
  if (!project) {
    container.innerHTML = `
      <section class="card">
        <a href="#/projects" class="btn btn-back">&larr; Projects</a>
        <p class="muted">Project not found.</p>
      </section>
    `;
    return;
  }

  currentProject = project;
  const tree = milestoneTree(slug, getCachedNotionTasks());
  const progress = milestoneProgress(tree);
  const nextTarget = tree.flatMap((p) => p.checkpoints)
    .filter((cp) => cp.targetDate && !(cp.steps.length && cp.steps.every((s) => s.complete)))
    .map((cp) => ({ code: cp.code, date: String(cp.targetDate).slice(0, 10) }))
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  container.innerHTML = `
    <section class="card project-head" style="border-color:${hexToRgba(project.hex, 0.6)};">
      <h1 class="mono" style="color:${project.hex};">${escapeHtml(project.name)}${project.archived ? ' <span class="tag">archived</span>' : ''}</h1>
      ${hoursStatsHtml(project.name)}
      <div class="project-head-actions">
        <button type="button" data-action="pitch-open">Pitch</button>
        ${githubButtonHtml()}
        <a href="#/projects" class="btn btn-back">&larr; Projects</a>
      </div>
      ${progressHtml(progress, project.hex)}
    </section>
    <div class="project-doc-buttons">
      <button type="button" class="project-doc-btn" data-action="report-open" title="Open this project's report editor">Report</button>
      <button type="button" class="project-doc-btn" data-action="readme-open" title="README from the project's GitHub repo">Readme</button>
    </div>
    <section class="card">
      <div class="project-card-head">
        <h2 class="mono">Milestones</h2>
        ${nextTarget ? `<span class="mono muted project-next-target">Next target: checkpoint ${nextTarget.code}, ${escapeHtml(formatShortDate(nextTarget.date))}</span>` : ''}
        <button type="button" data-action="add-phase">+ Phase</button>
      </div>
      ${saveError ? `<p class="project-error">${escapeHtml(saveError)}</p>` : ''}
      ${milestonesHtml(tree, project.hex)}
    </section>
    <section class="card">
      <div class="project-card-head"><h2 class="mono">Log</h2></div>
      ${logHtml()}
    </section>
    <section class="card">
      <div class="project-card-head"><h2 class="mono">Resources</h2></div>
      ${resourcesHtml()}
    </section>
    <dialog id="modal-dialog"></dialog>
  `;
  container.querySelectorAll('[data-keep]').forEach((el) => {
    if (el.dataset.keep in kept) el.value = kept[el.dataset.keep];
  });
  if (focusedKeep) container.querySelector(`[data-keep="${focusedKeep}"]`)?.focus({ preventScroll: true });
  wireAfterRender();
}
