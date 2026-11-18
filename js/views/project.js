import { escapeHtml, hexToRgba, formatDateISO, formatShortDate } from '../format.js?v=70';
import { projectBySlug } from '../projects.js?v=70';
import { projectMinutesByWeek, projectMinutesOnDay, weekStart } from '../projectHours.js?v=70';
import {
  PITCH_FIELDS, getPitch, savePitch,
  parseGithubRepo, getGithubRepo, saveGithubRepo,
  milestoneTree, milestoneProgress, linkTask, unlinkTask, linkedTaskIds,
  addMilestone, updateMilestone, moveMilestone, deleteMilestone, descendantCount,
  getLinks, normalizeUrl, addLink, removeLink,
  logEntries, addLogEntry, deleteLogEntry,
} from '../projectPlan.js?v=70';
import { store } from '../store.js?v=70';
import {
  fetchNotionTasks, getCachedNotionTasks, createTask, addCachedNotionTask,
  pushCheckboxUpdates, patchCachedNotionTask, deleteTask, removeCachedNotionTask,
  promptTaskDuration,
} from '../notion.js?v=70';
import { taskDay } from '../taskDisplay.js?v=70';
import { startOfDay } from '../taskDisplay.js?v=70';
import { readOnlyWeekHtml, weekRangeLabel, MODE_COLORS } from './calendar.js?v=70';
import { getReadme, renderMarkdown, saveReadme, isProxyUnavailable, tokenExpiryNote } from '../github.js?v=70';

// One project's own page (#/projects/<slug>): header (name, logged hours,
// milestone position, back + Pitch buttons), big Roadmap / Report / Readme /
// Log / Resources buttons, and this project's week calendar (read-only).
// Roadmap, Log and Resources are pages of this same module
// (#/projects/<slug>/<section>); Roadmap holds the milestones (phases A, B, ... ->
// checkpoints 1, 2, ... -> steps 3.1, 3.2, ...). The pitch opens in a dialog from the header's Pitch
// button. Data: js/projectPlan.js. Built on Spindock first, the same page
// serves every project.

let container = null;
let slug = null;
let section = null; // null: the project page; 'roadmap' | 'log' | 'resources': that page
// UI state that survives rebuilds.
let editingId = null; // milestone whose title is being edited inline
let editingIsNew = false; // that milestone was just added (empty title -> discard)
let currentProject = null; // { name, slug, hex, ... } from the last rebuild
let fieldTimer = null; // debounced save of a step's description / done-when
let pendingField = null; // the textarea that save is for
let rebuildHeld = false; // a rebuild skipped while a step field had focus
let selfWrite = false; // a step field's own save (needs no rebuild)
let weekAnchor = startOfDay(new Date()); // the week the project calendar shows
// Linking a step to the calendar: { stepId, name } while picking a day (the
// calendar is tinted the project's color), busy while the task is created.
let picking = null;
let pickBusy = false;
let pickError = null;
// The calendar's complete [C] / mass-delete [X] modes, as in the Agenda:
// null, or { kind: 'completed' | 'delete', pending, touched, marked }.
let calMode = null;
let calError = null;
// A step to flash once the Roadmap page renders (set by clicking its task in
// the project page's calendar). Module-level, so it survives the route change.
let pendingFlashStepId = null;

export function render(rootEl, params) {
  container = rootEl;
  slug = params.id;
  section = params.section || null;
  editingId = null;
  editingIsNew = false;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('dietz:store-changed', onStoreChanged);
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container.addEventListener('input', onInput);
  container.addEventListener('focusout', onFocusOut);
  weekAnchor = startOfDay(new Date());
  picking = null;
  pickBusy = false;
  pickError = null;
  phaseEditId = null;
  calMode = null;
  calError = null;
  rebuild();
  // The week calendar draws from the cached Notion tasks right away; this
  // refreshes them (a failure just keeps the cached ones).
  if (!section) fetchNotionTasks().then(() => { if (container && !editingId) rebuild(); }).catch(() => {});
}

// This project's tasks (category Project, project = its name), read-only, in
// the Calendar's own week grid. Tasks get added elsewhere, not from here.
function projectTasks(project = currentProject) {
  return project ? getCachedNotionTasks().filter((t) => t.category === 'Project' && t.project === project.name) : [];
}

// [C] / [X]: labeled by key only. Active: the mode's color, plus [Esc] to cancel.
function modeButtonsHtml() {
  const btn = (kind, key) => {
    const active = calMode?.kind === kind;
    const color = MODE_COLORS[kind];
    const style = active ? ` style="border-color:${color}; color:${color}; background:${hexToRgba(color, 0.14)};"` : '';
    const title = active ? (kind === 'delete' ? 'Confirm delete [Enter]' : 'Save [Enter]') : '';
    const disabled = (calMode && !active) || picking;
    return `<button type="button" data-action="cal-mode" data-kind="${kind}" class="mono${active ? ' active' : ''}"${style}${disabled ? ' disabled' : ''}${title ? ` title="${title}"` : ''}>[${key}]</button>`;
  };
  return `
    <div class="project-week-modes">
      ${btn('completed', 'C')}
      ${btn('delete', 'X')}
      ${calMode ? '<button type="button" data-action="cal-mode-cancel" class="mono" title="Cancel">[Esc]</button>' : ''}
    </div>
  `;
}

function projectWeekHtml(project) {
  const tasks = projectTasks(project);
  return `
    <section class="card cal-grid-card project-week${picking ? ' is-picking' : ''}${calMode ? ' is-mode' : ''}">
      <div class="project-card-head">
        <h2 class="mono">Calendar</h2>
        ${modeButtonsHtml()}
        <div class="cal-nav">
          <button type="button" data-action="week-prev" aria-label="Previous week">[Q]</button>
          <span class="mono cal-range-label">${weekRangeLabel(weekAnchor)}</span>
          <button type="button" data-action="week-today">[T] Today</button>
          <button type="button" data-action="week-next" aria-label="Next week">[E]</button>
        </div>
      </div>
      ${picking ? `
        <div class="project-pick-banner">
          <span class="mono">${pickBusy ? 'Saving…' : `Pick a day for <strong>${escapeHtml(picking.name)}</strong>, or click an existing task (purple) to link it`}</span>
          <button type="button" data-action="pick-cancel" ${pickBusy ? 'disabled' : ''}>Cancel</button>
        </div>
      ` : ''}
      ${pickError ? `<p class="project-error">${escapeHtml(pickError)}</p>` : ''}
      ${calError ? `<p class="project-error">${escapeHtml(calError)}</p>` : ''}
      ${readOnlyWeekHtml(tasks, weekAnchor, calMode)}
    </section>
  `;
}

// "[A] (3.2) Mesh solver": the Notion task a step's link creates.
function linkedTaskName(phase, step) {
  const title = String(step.title || '').trim();
  return `[${phase.code}] (${step.code})${title ? ` ${title}` : ''}`;
}

function startPick(stepId) {
  if (pickBusy) return;
  for (const phase of milestoneTree(slug)) {
    for (const cp of phase.checkpoints) {
      const step = cp.steps.find((s) => s.id === stepId);
      if (step) {
        picking = { stepId, name: linkedTaskName(phase, step) };
        pickError = null;
        rebuild();
        container.querySelector('.project-week')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
    }
  }
}

function cancelPick() {
  picking = null;
  pickError = null;
  rebuild();
}

// A task card clicked while picking: links that existing Notion task to the
// step instead of creating a new one. A task belongs to one step (see
// findLinkedStep), so one already linked elsewhere moves to this step.
function linkExistingTask(taskId) {
  if (!picking || pickBusy) return;
  const { stepId } = picking;
  const prev = findLinkedStep(taskId);
  picking = null;
  pickError = null;
  if (prev && prev.step.id !== stepId) unlinkTask(prev.step.id, taskId);
  linkTask(stepId, taskId); // rebuilds via the store change
  rebuild();
}

// A day clicked while picking: the Notion task (category Project, this
// project) on that day, linked to the step.
async function pickDay(day) {
  if (!picking || pickBusy || !currentProject) return;
  const { stepId, name } = picking;
  // Every new task needs a duration. Cancelling stays in picking mode.
  const duration = promptTaskDuration(name);
  if (duration === null) return;
  pickBusy = true;
  rebuild();
  let result;
  try {
    result = await createTask({ name, category: 'Project', project: currentProject.name, date: day, duration });
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  if (!container) return;
  pickBusy = false;
  if (result.ok && result.task) {
    addCachedNotionTask(result.task);
    picking = null;
    linkTask(stepId, result.task.id); // rebuilds via the store change
  } else {
    pickError = result.error || 'Failed to create the task';
  }
  rebuild();
}

// Same tint as the Agenda's modes (#app.has-mode-tint), in the project's color.
function applyPickTint(hex) {
  const app = document.getElementById('app');
  if (!app) return;
  if (hex) {
    app.classList.add('has-mode-tint');
    app.style.setProperty('--mode-color', hex);
    app.style.setProperty('--mode-tint', hexToRgba(hex, 0.05));
  } else {
    app.classList.remove('has-mode-tint');
    app.style.removeProperty('--mode-color');
    app.style.removeProperty('--mode-tint');
  }
}

// --- Calendar modes ([C] complete, [X] mass delete), as in the Agenda ---

function startCalMode(kind) {
  if (calMode || picking || section) return;
  calError = null;
  calMode = {
    kind,
    pending: new Set(kind === 'completed' ? projectTasks().filter((t) => t.mark).map((t) => t.id) : []),
    touched: new Set(),
    marked: new Set(),
  };
  rebuild();
}

function cancelCalMode() {
  calMode = null;
  rebuild();
}

// The mode's own key / button again (or Enter): save / confirm.
function finishCalMode() {
  if (!calMode) return;
  if (calMode.kind === 'completed') saveCompleted();
  else confirmDelete();
}

function toggleChip(id) {
  if (!calMode) return;
  if (calMode.kind === 'delete') {
    if (calMode.marked.has(id)) calMode.marked.delete(id); else calMode.marked.add(id);
  } else {
    if (calMode.pending.has(id)) calMode.pending.delete(id); else calMode.pending.add(id);
    calMode.touched.add(id);
  }
  rebuild();
}

// Applied right away, then written to Notion; a failure rolls it back.
async function saveCompleted() {
  const { pending } = calMode;
  const changed = projectTasks().filter((t) => Boolean(t.mark) !== pending.has(t.id));
  calMode = null;
  calError = null;
  if (!changed.length) { rebuild(); return; }
  for (const t of changed) patchCachedNotionTask(t.id, { mark: pending.has(t.id) });
  rebuild();
  let result;
  try {
    result = await pushCheckboxUpdates('?', changed.map((t) => ({ pageId: t.id, value: pending.has(t.id) })));
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  if (!result.ok) {
    for (const t of changed) patchCachedNotionTask(t.id, { mark: Boolean(t.mark) });
    calError = result.error || 'Failed to save completed flags to Notion';
    rebuild();
  }
}

// Asks first (they go to Notion's trash). Removed right away; any that fail
// to delete come back.
async function confirmDelete() {
  const ids = [...calMode.marked];
  if (!ids.length) { cancelCalMode(); return; }
  if (!confirm(`Delete ${ids.length} task${ids.length === 1 ? '' : 's'}? They'll be moved to Notion's trash, recoverable there.`)) return;
  const removed = projectTasks().filter((t) => calMode.marked.has(t.id));
  calMode = null;
  calError = null;
  for (const id of ids) removeCachedNotionTask(id);
  rebuild();
  const results = await Promise.all(ids.map((id) => deleteTask(id).catch((err) => ({ ok: false, error: err.message }))));
  const failed = removed.filter((t) => !results[ids.indexOf(t.id)]?.ok);
  if (failed.length) {
    for (const t of failed) addCachedNotionTask(t);
    calError = `${failed.length} task${failed.length === 1 ? '' : 's'} failed to delete. Check Notion and try again.`;
    rebuild();
  }
}

function shiftWeek(days) {
  const d = new Date(weekAnchor);
  d.setDate(d.getDate() + days);
  weekAnchor = days ? d : startOfDay(new Date());
  rebuild();
}

export function unmount() {
  saveStepField();
  picking = null;
  calMode = null;
  applyPickTint(null);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('dietz:store-changed', onStoreChanged);
  if (container) {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
    container.removeEventListener('input', onInput);
    container.removeEventListener('focusout', onFocusOut);
  }
  container = null;
}

// Any data change (this page's own edits, or another device's via sync).
// Not while a title or a step's field is being typed, so a rebuild can't
// throw that away (a held one runs when the field loses focus). An open
// dialog (pitch) also holds rebuilds off; see rebuild().
function onStoreChanged() {
  if (!container || editingId || selfWrite) return;
  if (document.activeElement?.matches?.('[data-step-field]') && container.contains(document.activeElement)) {
    rebuildHeld = true;
    return;
  }
  rebuild();
}

// Step description / done-when: saved as you type (debounced), and on blur.
function saveStepField() {
  clearTimeout(fieldTimer);
  fieldTimer = null;
  const el = pendingField;
  pendingField = null;
  if (!el) return;
  const row = store.table('ProjectMilestones').find((m) => m.id === el.dataset.id);
  if (row && String(row[el.dataset.stepField] || '') !== el.value) {
    // The textarea already shows it: no rebuild for this one (a rebuild
    // between mousedown and click would swallow the click).
    selfWrite = true;
    try { updateMilestone(el.dataset.id, { [el.dataset.stepField]: el.value }); } finally { selfWrite = false; }
  }
}

function onInput(e) {
  const field = e.target.closest?.('[data-step-field]');
  if (!field) return;
  if (pendingField && pendingField !== field) saveStepField();
  pendingField = field;
  clearTimeout(fieldTimer);
  fieldTimer = setTimeout(saveStepField, 600);
}

function onFocusOut(e) {
  if (!e.target.closest?.('[data-step-field]')) return;
  saveStepField();
  if (!rebuildHeld) return;
  // A change from elsewhere arrived while typing. Once focus has landed:
  // still in a step field -> keep holding; otherwise rebuild now.
  setTimeout(() => {
    if (!container || editingId || !rebuildHeld) return;
    if (document.activeElement?.matches?.('[data-step-field]') && container.contains(document.activeElement)) return;
    rebuildHeld = false;
    rebuild();
  }, 0);
}

function onKeyDown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, textarea, select')) return;
  // The calendar's modes, project page only: C / X start one (the same key
  // again, or Enter, saves / confirms), Esc cancels.
  if (!section) {
    const key = e.key.toLowerCase();
    const kind = key === 'c' ? 'completed' : key === 'x' ? 'delete' : null;
    if (kind && !e.repeat) {
      e.preventDefault();
      if (!calMode) startCalMode(kind);
      else if (calMode.kind === kind) finishCalMode();
      return;
    }
    if (e.key === 'Enter' && calMode) { e.preventDefault(); finishCalMode(); return; }
    // Week nav, as in the Agenda: Q back, E forward, T today.
    const nav = { q: -7, e: 7, t: 0 }[key];
    if (nav !== undefined && !pickBusy) { e.preventDefault(); shiftWeek(nav); return; }
    // The Roadmap card's phase: ← / →.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); shiftCardPhase(e.key === 'ArrowLeft' ? -1 : 1); return; }
  }
  if (e.key !== 'Escape') return;
  e.preventDefault();
  if (calMode) { cancelCalMode(); return; }
  if (picking && !pickBusy) { cancelPick(); return; }
  if (phaseEditId && !section) { phaseEditId = null; rebuild(); return; }
  location.hash = section ? `#/projects/${encodeURIComponent(slug)}` : '#/projects';
}

function hoursText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// Today / Week / All time, shown next to the title.
function hoursStatsHtml(name) {
  const todayISO = formatDateISO(new Date());
  const byWeek = projectMinutesByWeek(name);
  const stats = [
    ['Today', projectMinutesOnDay(name, todayISO)],
    ['Week', byWeek[weekStart(todayISO)] || 0],
    ['All time', Object.values(byWeek).reduce((sum, m) => sum + m, 0)],
  ];
  return `
    <div class="project-hours-stats mono">
      ${stats.map(([label, minutes]) => `<span><span class="muted">${label}:</span> <strong>${hoursText(minutes)}</strong></span>`).join('')}
    </div>
  `;
}

// The steps-done bar (full card width), % complete, and count, under the title row.
function progressHtml(progress, hex) {
  if (!progress.total) return '';
  const pct = Math.round((progress.done / progress.total) * 100);
  return `
    <div class="project-progress mono">
      <span class="project-progress-bar" style="--bar-color:${hex};"><span style="width:${pct}%;"></span></span>
      <strong class="project-progress-pct" style="color:${hex};">${pct}%</strong>
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
function absolutizeReadme(html, owner, repo, readmePath = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const path = readmePath || doc.querySelector('[data-path]')?.getAttribute('data-path') || 'README.md';
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

// Preview / Edit window for the repo's README. Reads and saves through the
// backend's GitHub proxy (js/github.js) — the GitHub token never reaches
// this page. Without the proxy set up (no GITHUB_TOKEN, or an older Code.gs)
// it falls back to the public, read-only view.
function openReadmeDialog() {
  const dialog = container.querySelector('#modal-dialog');
  if (!dialog || !currentProject) return;
  const repo = githubRepo();
  const repoName = repo ? `${repo.owner}/${repo.repo}` : '';

  const state = {
    tab: 'preview', // 'preview' | 'edit'
    readOnly: false, // proxy unavailable: public view only
    readme: null, // { path, sha, url, content } as last loaded/saved
    draft: '',
    previewFor: null, // the text previewHtml was rendered from
    previewHtml: '',
    status: '', // HTML line under the content (errors, "saved")
    busy: false,
    confirming: null, // { message } while the push warning screen is up
  };
  const dirty = () => Boolean(state.readme) && state.draft !== state.readme.content;

  const wireAnchors = () => {
    // GitHub prefixes heading ids with "user-content-".
    dialog.querySelectorAll('[data-readme-anchor]').forEach((a) => {
      a.addEventListener('click', () => {
        const id = a.dataset.readmeAnchor;
        const target = dialog.querySelector(`[id="user-content-${CSS.escape(id)}"], [id="${CSS.escape(id)}"]`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  };

  const render = (body) => {
    const editable = Boolean(state.readme) && !state.readOnly;
    dialog.innerHTML = `
      <div class="modal-form project-pitch-dialog readme-dialog">
        <div class="project-readme-head">
          <h2 class="mono">Readme</h2>
          ${repo ? `<a href="${escapeHtml(githubUrl(repo))}" target="_blank" rel="noopener noreferrer" class="mono muted">${escapeHtml(repoName)} ↗</a>` : ''}
          ${state.readme ? `<span class="mono muted readme-path">${escapeHtml(state.readme.path)}${dirty() ? ' • unsaved' : ''}</span>` : ''}
          ${editable ? `
            <span class="readme-tabs">
              <button type="button" class="${state.tab === 'preview' ? 'active' : ''}" data-readme-tab="preview">Preview</button>
              <button type="button" class="${state.tab === 'edit' ? 'active' : ''}" data-readme-tab="edit">Edit</button>
            </span>
          ` : ''}
        </div>
        ${body}
        ${state.status ? `<p class="readme-status">${state.status}</p>` : ''}
        ${expiryHtml()}
        <div class="modal-actions">
          ${editable && state.tab === 'edit' && !state.confirming ? `
            <input type="text" class="readme-message" data-readme-message placeholder="Commit message (default: Update README)" autocomplete="off">
            <button type="button" class="btn-primary" data-readme-save ${dirty() && !state.busy ? '' : 'disabled'}>${state.busy ? 'Saving…' : 'Save to GitHub'}</button>
          ` : ''}
          <button type="button" data-readme-close>Close</button>
        </div>
      </div>
    `;
    dialog.querySelector('[data-readme-close]').addEventListener('click', () => {
      if (dirty() && !confirm('Discard your unsaved README changes?')) return;
      dialog.close();
    });
    dialog.querySelectorAll('[data-readme-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.readmeTab)));
    dialog.querySelector('[data-readme-save]')?.addEventListener('click', save);
    const ta = dialog.querySelector('[data-readme-text]');
    ta?.addEventListener('input', () => {
      const wasDirty = dirty();
      state.draft = ta.value;
      if (wasDirty !== dirty()) {
        // Only the save button and "unsaved" marker change; keep the textarea.
        dialog.querySelector('[data-readme-save]').disabled = !dirty() || state.busy;
        const path = dialog.querySelector('.readme-path');
        if (path) path.textContent = `${state.readme.path}${dirty() ? ' • unsaved' : ''}`;
      }
    });
    wireAnchors();
  };

  const showPreview = async () => {
    if (state.previewFor === state.draft) {
      render(`<div class="readme-body">${state.previewHtml}</div>`);
      return;
    }
    render('<p class="muted mono">Rendering…</p>');
    const result = await renderMarkdown(repoName, state.draft).catch((err) => ({ error: err.message }));
    if (!dialog.open || state.tab !== 'preview') return;
    if (result.error) {
      state.status = `<span class="project-error">${escapeHtml(result.error)}</span>`;
      render('');
      return;
    }
    state.previewFor = state.draft;
    state.previewHtml = absolutizeReadme(result.html, repo.owner, repo.repo, state.readme.path);
    render(`<div class="readme-body">${state.previewHtml}</div>`);
  };

  // The token's expiry (js/github.js): a quiet note normally, a warning
  // within 30 days or once it's past. Shown whenever editing is on, and when
  // it's off because the token has expired.
  const expiryHtml = () => {
    const note = tokenExpiryNote();
    if (state.readOnly && note.level !== 'expired') return '';
    if (!state.readme && !state.readOnly) return '';
    return `<p class="readme-expiry mono${note.level === 'ok' ? ' muted' : ' is-warning'}">${escapeHtml(note.text)}</p>`;
  };

  const showEdit = (message = '') => {
    state.confirming = null;
    render(`<textarea class="readme-editor" data-readme-text spellcheck="true"></textarea>`);
    const ta = dialog.querySelector('[data-readme-text]');
    ta.value = state.draft;
    const input = dialog.querySelector('[data-readme-message]');
    if (input && message) input.value = message;
    ta.focus();
  };

  // Lines added / removed between the README on GitHub and the draft (a
  // per-line count, enough for the warning screen).
  const lineChanges = () => {
    const count = (text) => {
      const m = new Map();
      for (const line of text.split('\n')) m.set(line, (m.get(line) || 0) + 1);
      return m;
    };
    const before = count(state.readme.content);
    const after = count(state.draft);
    let added = 0;
    let removed = 0;
    for (const [line, n] of after) added += Math.max(0, n - (before.get(line) || 0));
    for (const [line, n] of before) removed += Math.max(0, n - (after.get(line) || 0));
    return { added, removed };
  };

  // The warning screen before anything is pushed: what, where, and the
  // message. Only "Commit & push" sends it.
  const showConfirm = (message) => {
    state.confirming = { message };
    state.status = '';
    const { added, removed } = lineChanges();
    const shownMessage = message.trim() || 'Update README';
    render(`
      <div class="readme-confirm">
        <p class="readme-confirm-title">⚠ Push this to GitHub?</p>
        <p>This commits straight to <strong class="mono">${escapeHtml(repoName)}</strong> on its default branch. It shows up on GitHub right away and stays in the repo's history.</p>
        <dl class="readme-confirm-facts mono">
          <dt>File</dt><dd>${escapeHtml(state.readme.path)}</dd>
          <dt>Message</dt><dd>${escapeHtml(shownMessage)}</dd>
          <dt>Changes</dt><dd><span class="readme-added">+${added}</span> <span class="readme-removed">−${removed}</span> lines</dd>
        </dl>
        <div class="readme-confirm-actions">
          <button type="button" data-readme-back>Back to editing</button>
          <button type="button" class="btn-primary readme-push" data-readme-push>Commit &amp; push</button>
        </div>
      </div>
    `);
    dialog.querySelector('[data-readme-back]').addEventListener('click', () => showEdit(message));
    dialog.querySelector('[data-readme-push]').addEventListener('click', () => push(message));
    dialog.querySelector('[data-readme-back]').focus();
  };

  const setTab = (tab) => {
    if (state.busy) return;
    const message = dialog.querySelector('[data-readme-message]')?.value ?? state.confirming?.message;
    state.confirming = null;
    state.tab = tab;
    state.status = '';
    if (tab === 'edit') showEdit();
    else showPreview();
    const input = dialog.querySelector('[data-readme-message]');
    if (input && message) input.value = message;
  };

  // "Save to GitHub" only opens the warning screen; push() does the commit.
  function save() {
    if (!dirty() || state.busy) return;
    showConfirm(dialog.querySelector('[data-readme-message]')?.value || '');
  }

  async function push(message) {
    if (!dirty() || state.busy) return;
    state.busy = true;
    const pushBtn = dialog.querySelector('[data-readme-push]');
    if (pushBtn) { pushBtn.disabled = true; pushBtn.textContent = 'Pushing…'; }
    dialog.querySelector('[data-readme-back]')?.setAttribute('disabled', '');
    const result = await saveReadme(repoName, state.readme.path, state.draft, state.readme.sha, message).catch((err) => ({ error: err.message }));
    state.busy = false;
    if (!dialog.open) return;
    if (result.error) {
      state.status = `<span class="project-error">${escapeHtml(result.error)}</span>`;
      showEdit(message); // the draft and message are kept
      return;
    }
    state.confirming = null;
    state.readme = { ...state.readme, sha: result.sha, content: state.draft };
    state.status = `Saved to GitHub. <a href="${escapeHtml(result.commitUrl)}" target="_blank" rel="noopener noreferrer">View the commit ↗</a>`;
    state.tab = 'preview';
    showPreview();
  }

  // Esc: same "discard unsaved changes?" check as Close.
  const onCancel = (e) => {
    if (state.confirming) {
      e.preventDefault();
      if (!state.busy) showEdit(state.confirming.message);
      return;
    }
    if (dirty() && !confirm('Discard your unsaved README changes?')) e.preventDefault();
  };
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', () => {
    dialog.removeEventListener('cancel', onCancel);
    dialog.classList.remove('is-wide', 'is-readme');
    rebuild();
  }, { once: true });
  dialog.classList.add('is-wide', 'is-readme');

  if (!repo) {
    render('<p class="muted">No GitHub repo linked yet. Add it with the "+ GitHub" button at the top of the page, then open this again.</p>');
    dialog.showModal();
    return;
  }

  render('<p class="muted mono">Loading README from GitHub…</p>');
  dialog.showModal();
  getReadme(repoName)
    .catch((err) => ({ error: err.message }))
    .then(async (result) => {
      if (!dialog.open) return;
      if (result.ok) {
        state.readme = { path: result.path, sha: result.sha, url: result.url, content: result.content };
        state.draft = result.content;
        showPreview();
        return;
      }
      if (!isProxyUnavailable(result)) {
        state.status = `<span class="project-error">${escapeHtml(result.error || 'Could not load the README.')}</span>`;
        render('');
        return;
      }
      // No proxy: the public read-only view, with a note on how to enable editing.
      state.readOnly = true;
      state.status = '<span class="muted">Read-only. To edit here, set GITHUB_TOKEN and GITHUB_REPOS in the Apps Script\'s Script Properties (see Code.gs).</span>';
      try {
        render(`<div class="readme-body">${await fetchReadmeHtml(repo)}</div>`);
      } catch (err) {
        state.status = `<span class="project-error">${escapeHtml(err.message)}</span>`;
        render('');
      }
    });
}

// --- Milestones --------------------------------------------------------

// True while milestonesHtml renders the project page's read-only Roadmap
// card: folds work, nothing else is editable.
let renderingView = false;
// The one phase of that card being edited in place (null: none).
let phaseEditId = null;

function titleHtml(node, placeholder) {
  if (!renderingView && node.id === editingId) {
    return `<input type="text" class="ms-title-input" data-title-input="${node.id}" value="${escapeHtml(node.title || '')}" placeholder="${placeholder}">`;
  }
  const title = String(node.title || '').trim();
  if (renderingView) return `<span class="ms-title is-static">${title ? escapeHtml(title) : `<span class="muted">${placeholder}</span>`}</span>`;
  return `<span class="ms-title" data-action="edit-title" data-id="${node.id}" title="Click to rename">${title ? escapeHtml(title) : `<span class="muted">${placeholder}</span>`}</span>`;
}

function actionsHtml(node, addLabel, addAction, extra = '') {
  if (renderingView) return '';
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

// Folding: phases and checkpoints start open, steps start closed (their
// description / done-when fields show when open). Per project, remembered
// on this device only.
function foldKey() {
  return `dietz:roadmapOpen:${slug}`;
}

function loadFolds() {
  try {
    return JSON.parse(localStorage.getItem(foldKey()) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function isOpen(node) {
  const folds = loadFolds();
  return node.id in folds ? Boolean(folds[node.id]) : node.kind !== 'step';
}

function toggleFold(id) {
  const node = store.table('ProjectMilestones').find((m) => m.id === id);
  if (!node) return;
  const folds = loadFolds();
  folds[id] = !isOpen(node);
  try { localStorage.setItem(foldKey(), JSON.stringify(folds)); } catch (e) { /* convenience only */ }
  rebuild();
}

function foldButtonHtml(node, open, label) {
  return `<button type="button" class="ms-fold" data-action="toggle-fold" data-id="${node.id}" aria-expanded="${open}" title="${open ? 'Collapse' : 'Expand'} ${label}">${open ? '▼' : '▶'}</button>`;
}

const STEP_FIELDS = [
  { key: 'description', label: 'Description', placeholder: 'What this step is' },
  { key: 'doneWhen', label: 'Done when', placeholder: 'The check that says it\'s finished' },
];

function stepHtml(step) {
  const open = isOpen(step);
  const hasDetail = STEP_FIELDS.some((f) => String(step[f.key] || '').trim());
  return `
    <li class="ms-step${step.complete ? ' is-done' : ''}" data-step-id="${step.id}">
      <div class="ms-row ms-row-step">
        ${foldButtonHtml(step, open, 'step')}
        <input type="checkbox" class="ms-check" data-step-check="${step.id}" ${step.complete ? 'checked' : ''} ${renderingView ? 'disabled' : ''} aria-label="Done" title="Done">
        <span class="ms-code mono">${step.code}</span>
        ${titleHtml(step, 'Untitled step')}
        ${!open && hasDetail ? '<span class="ms-has-detail muted" title="Has a description / done-when">≡</span>' : ''}
        ${renderingView ? stepLinksHtml(step) : ''}
        ${actionsHtml(step, '', '')}
      </div>
      ${open ? `
        <div class="ms-step-detail">
          ${renderingView ? STEP_FIELDS.filter((f) => String(step[f.key] || '').trim()).map((f) => `
            <div class="ms-field">
              <span class="ms-field-label mono muted">${f.label}</span>
              <p class="ms-field-text">${escapeHtml(String(step[f.key]).trim())}</p>
            </div>
          `).join('') || '<p class="muted ms-field-text">No description yet.</p>' : STEP_FIELDS.map((f) => `
            <label class="ms-field">
              <span class="ms-field-label mono muted">${f.label}</span>
              <textarea rows="2" data-step-field="${f.key}" data-id="${step.id}" placeholder="${escapeHtml(f.placeholder)}">${escapeHtml(String(step[f.key] || ''))}</textarea>
            </label>
          `).join('')}
        </div>
      ` : ''}
    </li>
  `;
}

function checkpointHtml(cp) {
  const total = cp.steps.length;
  const done = cp.steps.filter((s) => s.complete).length;
  const complete = total > 0 && done === total;
  const open = isOpen(cp);
  return `
    <div class="ms-checkpoint${complete ? ' is-done' : ''}">
      <div class="ms-row ms-row-checkpoint">
        ${foldButtonHtml(cp, open, 'checkpoint')}
        <span class="ms-code ms-code-checkpoint mono" title="Checkpoint ${cp.code}">${cp.code}</span>
        ${titleHtml(cp, 'Untitled checkpoint')}
        ${actionsHtml(cp, 'step', 'add-step')}
        <span class="ms-meta mono muted">${total ? `${done}/${total}` : ''}</span>
      </div>
      ${open && cp.steps.length ? `<ul class="ms-steps">${cp.steps.map(stepHtml).join('')}</ul>` : ''}
    </div>
  `;
}

function phaseHtml(phase, hex) {
  // The Roadmap card edits one phase in place: that phase renders like the
  // Roadmap page, the rest stay read-only.
  if (renderingView && phase.id === phaseEditId) {
    renderingView = false;
    try {
      return phaseRowsHtml(phase, hex, true);
    } finally {
      renderingView = true;
    }
  }
  return phaseRowsHtml(phase, hex, false);
}

function phaseEditButtonHtml(phase, isEditing) {
  return isEditing
    ? `<button type="button" class="ms-btn ms-phase-edit is-active" data-action="phase-edit-done" title="Stop editing [Esc]">Done</button>`
    : `<button type="button" class="ms-btn ms-phase-edit" data-action="phase-edit" data-id="${phase.id}" title="Edit this phase here">Edit</button>`;
}

function phaseRowsHtml(phase, hex, isEditing) {
  const inCard = renderingView || isEditing;
  const steps = phase.checkpoints.flatMap((cp) => cp.steps);
  const done = steps.filter((s) => s.complete).length;
  const open = isOpen(phase);
  return `
    <div class="ms-phase${isEditing ? ' is-editing' : ''}" style="--phase-color:${hex};">
      <div class="ms-row ms-row-phase">
        ${foldButtonHtml(phase, open, 'phase')}
        <span class="ms-code ms-code-phase mono" title="Phase ${phase.code}">${phase.code}</span>
        ${titleHtml(phase, 'Untitled phase')}
        ${actionsHtml(phase, 'checkpoint', 'add-checkpoint')}
        ${inCard ? phaseEditButtonHtml(phase, isEditing) : ''}
        <span class="ms-meta mono muted">${steps.length ? `${done}/${steps.length}` : ''}</span>
      </div>
      ${steps.length ? `<div class="ms-phase-progress" role="progressbar" aria-label="Phase ${phase.code} steps done" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${done}"><span style="width:${Math.round((done / steps.length) * 100)}%;"></span></div>` : ''}
      ${open && phase.checkpoints.length ? `<div class="ms-phase-body">${phase.checkpoints.map(checkpointHtml).join('')}</div>` : ''}
    </div>
  `;
}

// The read-only view's step row: the days its linked tasks sit on (from the
// cached Notion tasks; a deleted one drops out), and the link button.
function stepLinksHtml(step) {
  const byId = new Map(getCachedNotionTasks().map((t) => [t.id, t]));
  const days = linkedTaskIds(step).map((id) => byId.get(id)).filter(Boolean)
    .map((t) => ({ day: taskDay(t), done: Boolean(t.mark) }))
    .filter((d) => d.day)
    .sort((a, b) => a.day.localeCompare(b.day));
  const isPicking = picking?.stepId === step.id;
  return `
    <button type="button" class="ms-btn ms-link-btn${isPicking ? ' is-active' : ''}" data-action="link-step" data-id="${step.id}" title="Put this step on the calendar: then pick a day above">${isPicking ? 'picking…' : '+ day'}</button>
    ${days.map((d) => `<span class="ms-link-day mono${d.done ? ' is-done' : ''}">${escapeHtml(formatShortDate(d.day))}</span>`).join('')}
  `;
}

// The project page's Roadmap card: the same tree, read-only.
function roadmapViewHtml(tree, hex) {
  const i = cardPhaseIndex(tree);
  renderingView = true;
  try {
    return `
      <section class="card project-roadmap-view">
        <div class="project-card-head">
          <h2 class="mono">Roadmap</h2>
          ${tree.length > 1 ? `
            <div class="project-roadmap-nav">
              <button type="button" class="mono" data-action="card-phase" data-dir="-1" title="Previous phase [←]" ${i <= 0 ? 'disabled' : ''}>[←]</button>
              <button type="button" class="mono" data-action="card-phase" data-dir="1" title="Next phase [→]" ${i >= tree.length - 1 ? 'disabled' : ''}>[→]</button>
            </div>
          ` : ''}
          <button type="button" data-action="section-open" data-section="roadmap">Open roadmap</button>
        </div>
        ${tree.length ? milestonesHtml([tree[i]], hex) : '<p class="muted">No milestones yet. Add phases in Open roadmap.</p>'}
      </section>
    `;
  } finally {
    renderingView = false;
  }
}

// --- Which phase the card shows (one at a time; ← / → switch) ----------

function cardPhaseKey() {
  return `dietz:roadmapCardPhase:${slug}`;
}

// The remembered phase, else the one you're on (its first step not done),
// else the first.
function cardPhaseIndex(tree) {
  if (!tree.length) return 0;
  let saved = null;
  try { saved = localStorage.getItem(cardPhaseKey()); } catch (e) { /* convenience only */ }
  const savedIndex = tree.findIndex((p) => p.id === saved);
  if (savedIndex !== -1) return savedIndex;
  const current = tree.findIndex((p) => p.checkpoints.some((cp) => cp.steps.some((st) => !st.complete)));
  return current === -1 ? 0 : current;
}

function setCardPhase(phaseId) {
  try { localStorage.setItem(cardPhaseKey(), phaseId); } catch (e) { /* convenience only */ }
}

function shiftCardPhase(dir) {
  const tree = milestoneTree(slug);
  const next = cardPhaseIndex(tree) + dir;
  if (next < 0 || next >= tree.length) return;
  saveStepField();
  setCardPhase(tree[next].id);
  phaseEditId = null;
  editingId = null;
  rebuild();
}

// --- Calendar task -> its step on the roadmap ---------------------------

function findLinkedStep(taskId) {
  for (const phase of milestoneTree(slug)) {
    for (const cp of phase.checkpoints) {
      const step = cp.steps.find((st) => linkedTaskIds(st).includes(taskId));
      if (step) return { phase, cp, step };
    }
  }
  return null;
}

// Opens the phase and checkpoint around a step so its row is on screen.
function openAround(phase, cp) {
  const folds = loadFolds();
  folds[phase.id] = true;
  folds[cp.id] = true;
  try { localStorage.setItem(foldKey(), JSON.stringify(folds)); } catch (e) { /* convenience only */ }
}

// A calendar task clicked (no mode on): its step flashes in the card when
// the card is showing that step's phase, otherwise on the Roadmap page.
function showTaskOnRoadmap(taskId) {
  const found = findLinkedStep(taskId);
  if (!found) return;
  openAround(found.phase, found.cp);
  const tree = milestoneTree(slug);
  if (tree[cardPhaseIndex(tree)]?.id === found.phase.id) {
    rebuild();
    flashStep(found.step.id);
  } else {
    pendingFlashStepId = found.step.id;
    location.hash = `#/projects/${encodeURIComponent(slug)}/roadmap`;
  }
}

function flashStep(stepId) {
  const row = container?.querySelector(`.ms-step[data-step-id="${CSS.escape(stepId)}"] > .ms-row`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('ms-flash');
  void row.offsetWidth; // restart the animation if it's already flashing
  row.classList.add('ms-flash');
  row.addEventListener('animationend', () => row.classList.remove('ms-flash'), { once: true });
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
      <input type="text" name="text" placeholder="Progress, a decision, a blocker…" data-keep="log-text" required>
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

function onClick(e) {
  // A mode is on: clicking a card in the calendar toggles it.
  const chip = calMode && e.target.closest('.project-week .cal-chip[data-task-id]');
  if (chip) { toggleChip(chip.dataset.taskId); return; }
  // Picking for a step: a task card links that existing task; anywhere else
  // in a day column creates a new one on that day.
  const pickChip = picking && !pickBusy && e.target.closest('.project-week .cal-chip[data-task-id]');
  if (pickChip) { linkExistingTask(pickChip.dataset.taskId); return; }
  const dayCol = picking && !pickBusy && e.target.closest('.project-week .cal-day-col[data-date]');
  if (dayCol) { pickDay(dayCol.dataset.date); return; }
  // No mode, not picking: a task card shows its step on the roadmap.
  const taskChip = !calMode && !picking && e.target.closest('.project-week .cal-chip[data-task-id]');
  if (taskChip) { showTaskOnRoadmap(taskChip.dataset.taskId); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn || !container.contains(btn)) return;
  const id = btn.dataset.id;
  switch (btn.dataset.action) {
    case 'toggle-fold': toggleFold(id); break;
    case 'link-step': if (!calMode) startPick(id); break;
    case 'cal-mode': if (!calMode) startCalMode(btn.dataset.kind); else if (calMode.kind === btn.dataset.kind) finishCalMode(); break;
    case 'cal-mode-cancel': cancelCalMode(); break;
    case 'card-phase': shiftCardPhase(Number(btn.dataset.dir)); break;
    case 'phase-edit': saveStepField(); phaseEditId = id; editingId = null; rebuild(); break;
    case 'phase-edit-done': saveStepField(); phaseEditId = null; editingId = null; rebuild(); break;
    case 'pick-cancel': cancelPick(); break;
    case 'week-prev': shiftWeek(-7); break;
    case 'week-next': shiftWeek(7); break;
    case 'week-today': shiftWeek(0); break;
    case 'delete-log': deleteLogEntry(id); break;
    case 'delete-link': removeLink(slug, Number(btn.dataset.index)); break;
    case 'pitch-open': openPitchDialog(); break;
    case 'readme-open': openReadmeDialog(); break;
    case 'copy-github': copyGithub(btn); break;
    case 'edit-github': openGithubDialog(); break;
    case 'section-open': location.hash = `#/projects/${encodeURIComponent(slug)}/${btn.dataset.section}`; break;
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
      if (id === phaseEditId) phaseEditId = null;
      deleteMilestone(id);
      break;
    }
    default: return;
  }
}

function onChange(e) {
  const check = e.target.closest('[data-step-check]');
  if (check) updateMilestone(check.dataset.stepCheck, { done: check.checked });
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
  // The dialog (pitch, readme, GitHub) lives in this markup. Wait for it to
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
  const tree = milestoneTree(slug);
  const progress = milestoneProgress(tree);

  container.innerHTML = section ? sectionPageHtml(project, progress, tree) : `
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
      <button type="button" class="project-doc-btn" data-action="section-open" data-section="roadmap" title="Phases, checkpoints and steps">Roadmap</button>
      <button type="button" class="project-doc-btn" data-action="report-open" title="Open this project's report editor">Report</button>
      <button type="button" class="project-doc-btn" data-action="readme-open" title="README from the project's GitHub repo">Readme</button>
      <button type="button" class="project-doc-btn" data-action="section-open" data-section="log" title="Dated progress notes">Log</button>
      <button type="button" class="project-doc-btn" data-action="section-open" data-section="resources" title="Links: repo, docs, papers">Resources</button>
    </div>
    ${projectWeekHtml(project)}
    ${roadmapViewHtml(tree, project.hex)}
    <dialog id="modal-dialog"></dialog>
  `;
  applyPickTint(section ? null : picking ? project.hex : calMode ? MODE_COLORS[calMode.kind] : null);
  container.querySelectorAll('[data-keep]').forEach((el) => {
    if (el.dataset.keep in kept) el.value = kept[el.dataset.keep];
  });
  if (focusedKeep) container.querySelector(`[data-keep="${focusedKeep}"]`)?.focus({ preventScroll: true });
  wireAfterRender();
  if (pendingFlashStepId && section === 'roadmap') {
    const id = pendingFlashStepId;
    pendingFlashStepId = null;
    flashStep(id);
  }
}

const SECTION_LABELS = { roadmap: 'Roadmap', log: 'Log', resources: 'Resources' };

// Roadmap / Log / Resources: each its own page under the project, with a
// back button to it.
function sectionPageHtml(project, progress, tree) {
  let body;
  if (section === 'roadmap') {
    body = `
      <div class="project-card-head">
        <h2 class="mono">Milestones</h2>
        <button type="button" data-action="add-phase">+ Phase</button>
      </div>
      ${milestonesHtml(tree, project.hex)}
    `;
  } else if (section === 'log') {
    body = logHtml();
  } else {
    body = resourcesHtml();
  }
  return `
    <section class="card project-head" style="border-color:${hexToRgba(project.hex, 0.6)};">
      <h1 class="mono" style="color:${project.hex};">${escapeHtml(project.name)} <span class="muted">· ${SECTION_LABELS[section]}</span></h1>
      <div class="project-head-actions">
        <a href="#/projects/${encodeURIComponent(slug)}" class="btn btn-back">&larr; ${escapeHtml(project.name)}</a>
      </div>
      ${section === 'roadmap' ? progressHtml(progress, project.hex) : ''}
    </section>
    <section class="card">${body}</section>
    <dialog id="modal-dialog"></dialog>
  `;
}
