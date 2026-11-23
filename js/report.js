// A project's report (js/views/report.js), stored format-neutral so the
// Tools channel can later lay it out as Updates / AIAA / IEEE / LaTeX. Two
// synced tables (see apps-script/Code.gs TABLES):
//
//   ReportNomenclature  kind 'group' (name) or 'symbol' (symbol, description,
//                       units; groupId = its group, '' = ungrouped).
//                       symbol is equation shorthand (js/mathInput.js),
//                       units/description are text with $…$ equations.
//   ReportBlocks        kind 'section' (text = title; data {"lettered"})
//                       or a block inside one (sectionId): 'paragraph',
//                       'bullets' (one item per line), 'equation' (text =
//                       shorthand), 'table' (data {"rows": [[…]]}, first
//                       row is the header; caption), 'figure' (text = repo
//                       path or image URL; caption).
//
// Numbers are never stored, they come from order: lettered sections A, B, …;
// equations (A.1), (A.2) per section; tables and figures 1, 2, … overall.
import { store } from './store.js?v=71';

const NOM = 'ReportNomenclature';
const BLK = 'ReportBlocks';

function bySortOrder(a, b) {
  return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
}

function nextOrder(rows) {
  return rows.reduce((max, r) => Math.max(max, Number(r.sortOrder) || 0), 0) + 1;
}

// kind: 'nom' | 'block'.
export function findRow(kind, id) {
  return store.table(kind === 'nom' ? NOM : BLK).find((r) => r.id === id) || null;
}

export function parseData(row) {
  try {
    const data = JSON.parse(row.data || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

// Swap with the neighbour in `siblings` (already sorted). Renumbers first if
// any orders collide, so a swap always moves something.
function swapOrder(table, siblings, id, dir) {
  const idx = siblings.findIndex((r) => r.id === id);
  const other = siblings[idx + dir];
  if (idx === -1 || !other) return;
  const orders = siblings.map((r) => Number(r.sortOrder) || 0);
  if (new Set(orders).size !== orders.length) {
    siblings.forEach((r, i) => { if ((Number(r.sortOrder) || 0) !== i + 1) store.upsert(table, { id: r.id, sortOrder: i + 1 }); });
    siblings.forEach((r, i) => { r.sortOrder = i + 1; });
  }
  const a = siblings[idx];
  store.upsert(table, { id: a.id, sortOrder: other.sortOrder });
  store.upsert(table, { id: other.id, sortOrder: a.sortOrder });
}

// --- Nomenclature --------------------------------------------------------

function nomRows(projectId) {
  return store.table(NOM).filter((r) => r.projectId === projectId);
}

// { ungrouped: [symbol…], groups: [{ …group, symbols: [symbol…] }] }. A
// symbol whose group was deleted elsewhere falls back to ungrouped.
export function nomenclature(projectId) {
  const rows = nomRows(projectId);
  const groups = rows.filter((r) => r.kind === 'group').sort(bySortOrder);
  const groupIds = new Set(groups.map((g) => g.id));
  const symbols = rows.filter((r) => r.kind !== 'group');
  const inGroup = (gid) => symbols.filter((s) => (groupIds.has(s.groupId) ? s.groupId : '') === gid).sort(bySortOrder);
  return { ungrouped: inGroup(''), groups: groups.map((g) => ({ ...g, symbols: inGroup(g.id) })) };
}

// Every filled-in symbol, in table order, with its group's name.
export function symbolList(projectId) {
  const { ungrouped, groups } = nomenclature(projectId);
  return [
    ...ungrouped.map((s) => ({ ...s, groupName: '' })),
    ...groups.flatMap((g) => g.symbols.map((s) => ({ ...s, groupName: g.name || '' }))),
  ].filter((s) => String(s.symbol || '').trim());
}

export function addGroup(projectId) {
  const groups = nomRows(projectId).filter((r) => r.kind === 'group');
  return store.upsert(NOM, { projectId, kind: 'group', groupId: '', name: '', symbol: '', description: '', units: '', sortOrder: nextOrder(groups) });
}

export function addSymbol(projectId, groupId = '') {
  const siblings = nomRows(projectId).filter((r) => r.kind !== 'group' && (r.groupId || '') === groupId);
  return store.upsert(NOM, { projectId, kind: 'symbol', groupId, name: '', symbol: '', description: '', units: '', sortOrder: nextOrder(siblings) });
}

export function updateNom(id, patch) {
  store.upsert(NOM, { id, ...patch });
}

// Moves a symbol to another group (or '' for ungrouped), at the end.
export function setSymbolGroup(id, groupId) {
  const row = store.table(NOM).find((r) => r.id === id);
  if (!row || (row.groupId || '') === groupId) return;
  const siblings = nomRows(row.projectId).filter((r) => r.kind !== 'group' && (r.groupId || '') === groupId);
  store.upsert(NOM, { id, groupId, sortOrder: nextOrder(siblings) });
}

export function moveNom(id, dir) {
  const row = store.table(NOM).find((r) => r.id === id);
  if (!row) return;
  const siblings = nomRows(row.projectId)
    .filter((r) => (row.kind === 'group' ? r.kind === 'group' : r.kind !== 'group' && (r.groupId || '') === (row.groupId || '')))
    .sort(bySortOrder);
  swapOrder(NOM, siblings, id, dir);
}

// Deleting a group keeps its symbols: they move to ungrouped.
export function deleteNom(id) {
  const row = store.table(NOM).find((r) => r.id === id);
  if (!row) return;
  if (row.kind === 'group') {
    const kept = nomRows(row.projectId).filter((r) => r.kind !== 'group' && r.groupId === id);
    let order = nextOrder(nomRows(row.projectId).filter((r) => r.kind !== 'group' && !r.groupId));
    for (const s of kept) store.upsert(NOM, { id: s.id, groupId: '', sortOrder: order++ });
  }
  store.remove(NOM, id);
}

// --- Sections and blocks ----------------------------------------------------

function blockRows(projectId) {
  return store.table(BLK).filter((r) => r.projectId === projectId);
}

export function isLettered(section) {
  return parseData(section).lettered !== false;
}

// [{ …section, code: 'A' | '', blocks: [{ …block, number }] }], with
// equation numbers 'A.1' (or '1', '2', … in an unlettered section) and
// table/figure numbers 1, 2, … across the whole report.
export function reportOutline(projectId) {
  const rows = blockRows(projectId);
  const sections = rows.filter((r) => r.kind === 'section').sort(bySortOrder);
  let letter = 0;
  let tables = 0;
  let figures = 0;
  let looseEquations = 0;
  return sections.map((section) => {
    const code = isLettered(section) ? letterCode(letter++) : '';
    let equations = 0;
    const blocks = rows.filter((r) => r.kind !== 'section' && r.sectionId === section.id).sort(bySortOrder).map((b) => {
      let number = '';
      if (b.kind === 'equation') number = code ? `${code}.${++equations}` : String(++looseEquations);
      if (b.kind === 'table') number = String(++tables);
      if (b.kind === 'figure') number = String(++figures);
      return { ...b, number };
    });
    return { ...section, code, blocks };
  });
}

function letterCode(index) {
  let s = '';
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function hasReport(projectId) {
  return blockRows(projectId).some((r) => r.kind === 'section');
}

// The Updates skeleton: overview and the closing sections. The project's
// own (A), (B), … sections go in between with "+ Section".
const STARTER_SECTIONS = [
  ['Project Overview', false],
  ['Results', true],
  ['Discussion', true],
  ['Limitations', true],
  ['Further Expansions', true],
  ['References', false],
  ['Appendix', false],
];

export function startReport(projectId) {
  if (hasReport(projectId)) return;
  STARTER_SECTIONS.forEach(([title, lettered], i) => {
    store.upsert(BLK, { projectId, kind: 'section', sectionId: '', sortOrder: i + 1, text: title, caption: '', data: JSON.stringify({ lettered }) });
  });
}

// A new section goes right after `afterId` (or at the end), shifting the
// ones below it down.
export function addSection(projectId, afterId = '') {
  const sections = blockRows(projectId).filter((r) => r.kind === 'section').sort(bySortOrder);
  const idx = sections.findIndex((s) => s.id === afterId);
  let order;
  if (idx === -1) {
    order = nextOrder(sections);
  } else {
    order = idx + 2;
    sections.forEach((s, i) => {
      const want = i <= idx ? i + 1 : i + 2;
      if ((Number(s.sortOrder) || 0) !== want) store.upsert(BLK, { id: s.id, sortOrder: want });
    });
  }
  return store.upsert(BLK, { projectId, kind: 'section', sectionId: '', sortOrder: order, text: '', caption: '', data: JSON.stringify({ lettered: true }) });
}

const BLOCK_DEFAULTS = {
  paragraph: {},
  bullets: {},
  equation: {},
  table: { data: JSON.stringify({ rows: [['', '', ''], ['', '', ''], ['', '', '']] }) },
  figure: {},
};

export function addBlock(projectId, sectionId, kind) {
  const siblings = blockRows(projectId).filter((r) => r.kind !== 'section' && r.sectionId === sectionId);
  return store.upsert(BLK, { projectId, kind, sectionId, sortOrder: nextOrder(siblings), text: '', caption: '', data: '', ...BLOCK_DEFAULTS[kind] });
}

export function updateBlock(id, patch) {
  store.upsert(BLK, { id, ...patch });
}

export function setLettered(id, lettered) {
  const row = store.table(BLK).find((r) => r.id === id);
  if (row) store.upsert(BLK, { id, data: JSON.stringify({ ...parseData(row), lettered }) });
}

export function moveBlock(id, dir) {
  const row = store.table(BLK).find((r) => r.id === id);
  if (!row) return;
  const siblings = blockRows(row.projectId)
    .filter((r) => (row.kind === 'section' ? r.kind === 'section' : r.kind !== 'section' && r.sectionId === row.sectionId))
    .sort(bySortOrder);
  swapOrder(BLK, siblings, id, dir);
}

export function blockCount(sectionId) {
  return store.table(BLK).filter((r) => r.kind !== 'section' && r.sectionId === sectionId).length;
}

// A section takes its blocks with it.
export function deleteBlock(id) {
  const row = store.table(BLK).find((r) => r.id === id);
  if (!row) return;
  if (row.kind === 'section') {
    for (const b of store.table(BLK).filter((r) => r.kind !== 'section' && r.sectionId === id)) store.remove(BLK, b.id);
  }
  store.remove(BLK, id);
}

// --- Tables -------------------------------------------------------------

export function tableRows(block) {
  const rows = parseData(block).rows;
  return Array.isArray(rows) && rows.length ? rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])) : [['']];
}

function saveRows(id, block, rows) {
  store.upsert(BLK, { id, data: JSON.stringify({ ...parseData(block), rows }) });
}

export function setTableCell(id, r, c, value) {
  const block = store.table(BLK).find((b) => b.id === id);
  if (!block) return;
  const rows = tableRows(block);
  while (rows.length <= r) rows.push([]);
  while (rows[r].length <= c) rows[r].push('');
  rows[r][c] = value;
  saveRows(id, block, rows);
}

// op: 'add-row' | 'del-row' | 'add-col' | 'del-col' (always keeps 1×1).
export function resizeTable(id, op) {
  const block = store.table(BLK).find((b) => b.id === id);
  if (!block) return;
  const rows = tableRows(block);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  if (op === 'add-row') rows.push(Array(cols).fill(''));
  if (op === 'del-row' && rows.length > 1) rows.pop();
  if (op === 'add-col') rows.forEach((r) => { while (r.length < cols) r.push(''); r.push(''); });
  if (op === 'del-col' && cols > 1) rows.forEach((r) => { r.length = Math.min(r.length, cols - 1); });
  saveRows(id, block, rows);
}
