import { escapeHtml, hexToRgba, formatDateISO, formatShortDate } from '../format.js?v=67';
import { projectBySlug, allProjects } from '../projects.js?v=67';
import { projectMinutesByWeek, projectMinutesOnDay, weekStart } from '../projectHours.js?v=67';
import {
  PITCH_FIELDS, getPitch, savePitch,
  milestoneTree, milestoneProgress,
  addMilestone, updateMilestone, moveMilestone, deleteMilestone, descendantCount,
  linkTask, unlinkTask, allLinkedTaskIds,
  getProjectRow, slugList, addToList, removeFromList, projectsListing,
  getLinks, normalizeUrl, addLink, removeLink,
  logEntries, addLogEntry, deleteLogEntry,
} from '../projectPlan.js?v=67';
import {
  fetchNotionTasks, getCachedNotionTasks, createTask, pushCheckboxUpdates,
  addCachedNotionTask, patchCachedNotionTask,
} from '../notion.js?v=67';
import { taskDay } from '../taskDisplay.js?v=67';

// One project's own page (#/projects/<slug>): header (name, logged hours,
// milestone position), the pitch, the milestones (phases A, B, ... ->
// checkpoints 1, 2, ... -> steps 3.1, 3.2, ...), the log, connections to
// other projects, and resources (links). Data: js/projectPlan.js. Built on
// Spindock first, the same page serves every project.

let container = null;
let slug = null;
// UI state that survives rebuilds.
let pitchEditing = false;
let pitchDraft = null; // unsaved pitch form values, kept across rebuilds
let editingId = null; // milestone whose title is being edited inline
let editingIsNew = false; // that milestone was just added (empty title -> discard)
let busyStepId = null; // step whose Notion task is being created
let saveError = null; // last failed Notion write, shown on the Milestones card
let currentProject = null; // { name, slug, hex, ... } from the last rebuild

export function render(rootEl, params) {
  container = rootEl;
  slug = params.id;
  pitchEditing = false;
  pitchDraft = null;
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
// open pitch form survives rebuilds through pitchDraft.
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

// --- Pitch -------------------------------------------------------------

function pitchHtml(saved) {
  if (pitchEditing) {
    const pitch = pitchDraft || saved;
    return `
      <form class="project-pitch-form" data-pitch-form>
        ${PITCH_FIELDS.map((f) => `
          <label>${escapeHtml(f.label)}
            <textarea name="${f.key}" rows="${f.key === 'pitch_hook' ? 2 : 3}" placeholder="${escapeHtml(f.hint)}">${escapeHtml(pitch[f.key] || '')}</textarea>
          </label>
        `).join('')}
        <div class="modal-actions">
          <button type="button" data-action="pitch-cancel">Cancel</button>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>
    `;
  }
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

// --- Log, connections, resources ---------------------------------------

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

function chipHtml(p, field) {
  return `
    <span class="project-chip" style="--chip-color:${p.hex};">
      <a href="#/projects/${encodeURIComponent(p.slug)}">${escapeHtml(p.name)}</a>
      ${field ? `<button type="button" class="project-chip-remove" data-action="remove-conn" data-field="${field}" data-slug="${escapeHtml(p.slug)}" title="Remove">✕</button>` : ''}
    </span>
  `;
}

// One line: label, chips, and (for a stored list) an add dropdown.
function connectionRowHtml(label, chips, field, options) {
  return `
    <div class="project-conn-row">
      <span class="project-conn-label mono muted">${label}</span>
      <span class="project-conn-chips">
        ${chips.map((p) => chipHtml(p, field)).join('') || (field ? '' : '<span class="muted">None</span>')}
        ${field && options.length ? `
          <select class="project-conn-add" data-add-conn="${field}" aria-label="Add to ${label}">
            <option value="">+ add</option>
            ${options.map((p) => `<option value="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</option>`).join('')}
          </select>
        ` : ''}
      </span>
    </div>
  `;
}

// Builds on / Leads to between any two projects, and the Skills link: a
// project lists the Skills projects it uses; a Skills project shows where
// it's used. Only projects shown on the Projects page (placed in
// js/projectThemes.js) are offered.
function connectionsHtml(project) {
  const shown = allProjects().filter((p) => p.theme && p.slug !== project.slug);
  const bySlug = new Map(shown.map((p) => [p.slug, p]));
  const row = getProjectRow(slug);
  const pick = (slugs) => slugs.map((s) => bySlug.get(s)).filter(Boolean);
  const buildsOn = pick(slugList(row.buildsOn));
  const leadsTo = pick(projectsListing('buildsOn', slug));
  const isSkill = project.theme?.theme === 'skills';
  const notIn = (list) => shown.filter((p) => !list.some((x) => x.slug === p.slug));

  return `
    ${connectionRowHtml('Builds on', buildsOn, 'buildsOn', notIn(buildsOn))}
    ${connectionRowHtml('Leads to', leadsTo, null, [])}
    ${isSkill
      ? connectionRowHtml('Used in', pick(projectsListing('skills', slug)), null, [])
      : (() => {
        const skills = pick(slugList(row.skills));
        const skillOptions = shown.filter((p) => p.theme.theme === 'skills' && !skills.some((s) => s.slug === p.slug));
        return connectionRowHtml('Skills', skills, 'skills', skillOptions);
      })()}
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
    case 'remove-conn': removeFromList(slug, btn.dataset.field, btn.dataset.slug); break;
    case 'pitch-edit': pitchEditing = true; pitchDraft = null; rebuild(); container.querySelector('[data-pitch-form] textarea')?.focus(); break;
    case 'pitch-cancel': pitchEditing = false; pitchDraft = null; rebuild(); break;
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
  if (date) { updateMilestone(date.dataset.targetDate, { targetDate: date.value }); return; }
  const conn = e.target.closest('[data-add-conn]');
  if (conn && conn.value) addToList(slug, conn.dataset.addConn, conn.value);
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

  const form = container.querySelector('[data-pitch-form]');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const fields = {};
      for (const f of PITCH_FIELDS) fields[f.key] = String(data.get(f.key) || '').trim();
      pitchEditing = false;
      pitchDraft = null;
      savePitch(slug, fields);
      rebuild();
    });
  }

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
  // The picker dialog lives in this markup. Wait for it to close (its close
  // handler rebuilds).
  if (container.querySelector('#modal-dialog[open]')) return;

  const openForm = container.querySelector('[data-pitch-form]');
  if (pitchEditing && openForm) {
    const data = new FormData(openForm);
    pitchDraft = {};
    for (const f of PITCH_FIELDS) pitchDraft[f.key] = String(data.get(f.key) || '');
  }
  // Half-typed log/link text (and which of those fields had focus) survives
  // the rebuild too.
  const kept = {};
  container.querySelectorAll('[data-keep]').forEach((el) => { kept[el.dataset.keep] = el.value; });
  const focusedKeep = document.activeElement?.dataset?.keep || null;

  const project = projectBySlug(slug);
  if (!project) {
    container.innerHTML = `
      <section class="card">
        <a href="#/projects" class="muted mono">&larr; Projects</a>
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
      <a href="#/projects" class="muted mono project-back">&larr; Projects</a>
      ${progressHtml(progress, project.hex)}
    </section>
    <section class="card">
      <div class="project-card-head">
        <h2 class="mono">Pitch</h2>
        ${pitchEditing ? '' : '<button type="button" data-action="pitch-edit">Edit</button>'}
      </div>
      ${pitchHtml(getPitch(slug))}
    </section>
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
      <div class="project-card-head"><h2 class="mono">Connections</h2></div>
      ${connectionsHtml(project)}
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
