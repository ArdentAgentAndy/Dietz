// A project's plan, for its project page (js/views/project.js): the pitch and
// the milestones. Two synced tables (see apps-script/Code.gs TABLES):
//
//   Projects           one row per project, id = its slug (js/projects.js's
//                      projectSlug). Holds the pitch text.
//   ProjectMilestones  one row per node. kind is 'phase' | 'checkpoint' |
//                      'step'; parentId links a checkpoint to its phase and a
//                      step to its checkpoint. sortOrder orders siblings.
//                      taskIds (comma-joined Notion ids): tasks linked to a
//                      step. A step with linked tasks is done when all of
//                      them are done (their `mark`), worked out at render
//                      time; one with none uses its own `done`.
//
// Codes are never stored, they come from order every time: phases are
// lettered A, B, C; checkpoints are numbered 1, 2, 3 continuously across
// phases; steps are <checkpoint>.<n>, e.g. 3.1. So reordering renumbers.
import { store } from './store.js?v=67';

// The pitch: what you'd say to a professor. Order = display order.
export const PITCH_FIELDS = [
  { key: 'pitch_hook', label: 'Hook', hint: 'One sentence: what it is and why it matters.' },
  { key: 'pitch_problem', label: 'Problem', hint: 'What gap or problem does it address?' },
  { key: 'pitch_approach', label: 'Approach', hint: 'How you are tackling it.' },
  { key: 'pitch_novel', label: "What's new", hint: 'What is different from what already exists.' },
  { key: 'pitch_results', label: 'Results so far', hint: 'Anything built, measured or shown.' },
  { key: 'pitch_ask', label: 'Ask', hint: 'Optional: what you want from them (advice, lab, funding).' },
];

// The project's own row (pitch, connections, links); { id } if none yet.
export function getProjectRow(projectId) {
  return store.table('Projects').find((p) => p.id === projectId) || { id: projectId };
}

export const getPitch = getProjectRow;

export function savePitch(projectId, fields) {
  store.upsert('Projects', { id: projectId, ...fields });
}

// --- Connections: buildsOn / skills are comma-joined project slugs ---------

export function slugList(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function addToList(projectId, field, slug) {
  const list = slugList(getProjectRow(projectId)[field]);
  if (!list.includes(slug)) store.upsert('Projects', { id: projectId, [field]: [...list, slug].join(',') });
}

export function removeFromList(projectId, field, slug) {
  const list = slugList(getProjectRow(projectId)[field]);
  store.upsert('Projects', { id: projectId, [field]: list.filter((s) => s !== slug).join(',') });
}

// Every project id whose `field` list contains this one (the reverse view:
// "leads to" from others' buildsOn, "used in" from others' skills).
export function projectsListing(field, slug) {
  return store.table('Projects').filter((p) => slugList(p[field]).includes(slug)).map((p) => p.id);
}

// --- Resources: links as a JSON [{ label, url }] list --------------------

export function getLinks(projectId) {
  try {
    const list = JSON.parse(getProjectRow(projectId).links || '[]');
    return Array.isArray(list) ? list.filter((l) => l && l.url) : [];
  } catch (e) {
    return [];
  }
}

// Only http(s) links, so a pasted "javascript:" can never become a live href.
// A bare "example.com" gets https:// added.
export function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch (e) {
    return '';
  }
}

export function addLink(projectId, label, url) {
  const links = [...getLinks(projectId), { label: String(label || '').trim(), url }];
  store.upsert('Projects', { id: projectId, links: JSON.stringify(links) });
}

export function removeLink(projectId, index) {
  const links = getLinks(projectId).filter((_, i) => i !== index);
  store.upsert('Projects', { id: projectId, links: JSON.stringify(links) });
}

// --- Log: dated notes, newest first --------------------------------------

export function logEntries(projectId) {
  return store.table('ProjectLog')
    .filter((l) => l.projectId === projectId)
    .map((l) => ({ ...l, date: String(l.date || '').slice(0, 10) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function addLogEntry(projectId, date, text) {
  store.upsert('ProjectLog', { projectId, date, text });
}

export function deleteLogEntry(id) {
  store.remove('ProjectLog', id);
}

// Sheets can hand a checkbox back as a real boolean or as text.
export function isDone(row) {
  return row.done === true || row.done === 'TRUE' || row.done === 'true';
}

function bySortOrder(a, b) {
  return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
}

function rows(projectId) {
  return store.table('ProjectMilestones').filter((m) => m.projectId === projectId);
}

function children(projectId, kind, parentId) {
  return rows(projectId)
    .filter((m) => m.kind === kind && (kind === 'phase' || m.parentId === parentId))
    .sort(bySortOrder);
}

export function linkedTaskIds(step) {
  return String(step.taskIds || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Every task id linked to any step of this project.
export function allLinkedTaskIds(projectId) {
  return new Set(rows(projectId).filter((m) => m.kind === 'step').flatMap(linkedTaskIds));
}

export function linkTask(stepId, taskId) {
  const step = store.table('ProjectMilestones').find((m) => m.id === stepId);
  if (!step) return;
  const ids = linkedTaskIds(step);
  if (!ids.includes(taskId)) updateMilestone(stepId, { taskIds: [...ids, taskId].join(',') });
}

export function unlinkTask(stepId, taskId) {
  const step = store.table('ProjectMilestones').find((m) => m.id === stepId);
  if (!step) return;
  updateMilestone(stepId, { taskIds: linkedTaskIds(step).filter((id) => id !== taskId).join(',') });
}

// The whole tree, with codes:
// [{ ...phase, code: 'A', checkpoints: [{ ...cp, code: '3', steps: [{ ...step, code: '3.1' }] }] }]
// Each step also gets `linkedTasks` (the linked Notion tasks still found in
// `tasks`; a deleted one just drops out) and `complete`.
export function milestoneTree(projectId, tasks = []) {
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const withTasks = (step) => {
    const linkedTasks = linkedTaskIds(step).map((id) => tasksById.get(id)).filter(Boolean);
    const complete = linkedTasks.length ? linkedTasks.every((t) => t.mark) : isDone(step);
    return { ...step, linkedTasks, complete };
  };
  let checkpointNumber = 0;
  return children(projectId, 'phase').map((phase, pi) => ({
    ...phase,
    code: phaseLetter(pi),
    checkpoints: children(projectId, 'checkpoint', phase.id).map((cp) => {
      checkpointNumber += 1;
      const cpCode = String(checkpointNumber);
      return {
        ...cp,
        code: cpCode,
        steps: children(projectId, 'step', cp.id).map((step, si) => ({ ...withTasks(step), code: `${cpCode}.${si + 1}` })),
      };
    }),
  }));
}

// A..Z, then AA, AB, ... (more than 26 phases is unlikely, but never breaks).
function phaseLetter(index) {
  let s = '';
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// Progress for the header: where you are (the first step not done, as
// "B · 3.2") and how many steps are done.
export function milestoneProgress(tree) {
  let total = 0;
  let done = 0;
  let current = null;
  for (const phase of tree) {
    for (const cp of phase.checkpoints) {
      for (const step of cp.steps) {
        total += 1;
        if (step.complete) done += 1;
        else if (!current) current = `${phase.code} · ${step.code}`;
      }
    }
  }
  return { total, done, current };
}

export function addMilestone(projectId, kind, parentId, title) {
  const siblings = children(projectId, kind, parentId);
  const sortOrder = siblings.length ? Math.max(...siblings.map((s) => Number(s.sortOrder) || 0)) + 1 : 0;
  return store.upsert('ProjectMilestones', {
    projectId,
    kind,
    parentId: kind === 'phase' ? '' : parentId,
    title,
    sortOrder,
    done: false,
    targetDate: '',
    taskIds: '',
  });
}

export function updateMilestone(id, patch) {
  store.upsert('ProjectMilestones', { id, ...patch });
}

// Swap with the sibling above (dir -1) or below (dir +1).
export function moveMilestone(id, dir) {
  const row = store.table('ProjectMilestones').find((m) => m.id === id);
  if (!row) return;
  const siblings = children(row.projectId, row.kind, row.parentId);
  const i = siblings.findIndex((s) => s.id === id);
  const other = siblings[i + dir];
  if (!other) return;
  // Renumber the whole sibling list first so equal/missing sortOrders can't
  // make a swap a no-op.
  siblings.forEach((s, idx) => { if (Number(s.sortOrder) !== idx) updateMilestone(s.id, { sortOrder: idx }); });
  updateMilestone(id, { sortOrder: i + dir });
  updateMilestone(other.id, { sortOrder: i });
}

// Removes a node and everything under it.
export function deleteMilestone(id) {
  const all = store.table('ProjectMilestones');
  const doomed = [id];
  for (let i = 0; i < doomed.length; i++) {
    for (const m of all) if (m.parentId === doomed[i]) doomed.push(m.id);
  }
  for (const d of doomed) store.remove('ProjectMilestones', d);
}

// How many nodes sit under one (for the delete confirmation).
export function descendantCount(id) {
  const all = store.table('ProjectMilestones');
  let count = 0;
  const queue = [id];
  while (queue.length) {
    const parent = queue.shift();
    for (const m of all) if (m.parentId === parent) { count += 1; queue.push(m.id); }
  }
  return count;
}
