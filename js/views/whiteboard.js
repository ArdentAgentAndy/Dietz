import { store } from '../store.js?v=71';
import { escapeHtml, hexToRgba } from '../format.js?v=71';
import { hexForNotionColor } from '../notionColors.js?v=71';

// Projects whiteboard (#/projects/board): one brainstorming board shared by
// every project. Not the plan itself (that lives on each project page); just
// a place to think. Items live in the synced BoardItems table:
//   box      a text note (x, y, w, h, text, color)
//   section  a titled frame; dragging its title moves the boxes inside it too
//   edge     a dashed connector from one box to another (fromId, toId)
// Positions are board pixels, snapped to GRID when a move/resize ends.
//
// Mouse: drag empty space to pan, wheel to zoom, double-click empty space for
// a new box, double-click a box/section title to edit, drag a box's ● to
// another box to connect them. Keys: listed in HINT below.

const GRID = 20;
const BOX_W = 160;
const BOX_H = 80;
const SECTION_W = 520;
const SECTION_H = 340;
const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
const VIEW_KEY = 'dietz:boardView';
const COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const HINT = 'Double-click: new box · drag ● to connect · N box · Enter connected box · E edit · Del delete · arrows nudge · Tab next · 1–9 sections · 0 fit · Esc back';

let container = null;
let viewport = null;
let view = { x: 40, y: 40, scale: 1 }; // screen offset of board (0,0), and zoom
let selectedId = null;
let editingId = null;
let editingIsNew = false;
let drag = null; // active pointer gesture, see onPointerDown

export function render(rootEl) {
  container = rootEl;
  selectedId = null;
  editingId = null;
  editingIsNew = false;
  drag = null;
  view = loadView();
  container.innerHTML = `
    <section class="card wb-head">
      <h1 class="mono">Whiteboard</h1>
      <div class="wb-toolbar" data-toolbar></div>
      <a href="#/projects" class="muted mono project-back">&larr; Projects</a>
    </section>
    <div class="wb-viewport" data-viewport tabindex="-1">
      <div class="wb-world" data-world></div>
    </div>
    <p class="wb-hint mono muted">${HINT}</p>
  `;
  viewport = container.querySelector('[data-viewport]');
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerUp);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('dblclick', onDoubleClick);
  container.querySelector('[data-toolbar]').addEventListener('click', onToolbarClick);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('dietz:store-changed', onStoreChanged);
  if (!localStorageHasView()) fitAll();
  rebuild();
}

export function unmount() {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('dietz:store-changed', onStoreChanged);
  container = null;
  viewport = null;
}

// --- Data ---------------------------------------------------------------

function items() {
  return store.table('BoardItems');
}

function itemById(id) {
  return items().find((i) => i.id === id) || null;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function rectOf(item) {
  return { x: num(item.x), y: num(item.y), w: num(item.w, BOX_W), h: num(item.h, BOX_H) };
}

function snap(v) {
  return Math.round(v / GRID) * GRID;
}

function boxes() {
  return items().filter((i) => i.kind === 'box');
}

// Sections in reading order (top to bottom, then left to right): 1–9 jump keys.
function sections() {
  return items().filter((i) => i.kind === 'section')
    .sort((a, b) => num(a.y) - num(b.y) || num(a.x) - num(b.x));
}

function addItem(row) {
  return store.upsert('BoardItems', { text: '', color: '', fromId: '', toId: '', ...row });
}

function deleteItem(id) {
  for (const e of items().filter((i) => i.kind === 'edge' && (i.fromId === id || i.toId === id))) {
    store.remove('BoardItems', e.id);
  }
  store.remove('BoardItems', id);
}

function connect(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const exists = items().some((i) => i.kind === 'edge'
    && ((i.fromId === fromId && i.toId === toId) || (i.fromId === toId && i.toId === fromId)));
  if (!exists) addItem({ kind: 'edge', fromId, toId, x: 0, y: 0, w: 0, h: 0 });
}

// --- View (pan/zoom), remembered per browser ------------------------------

function localStorageHasView() {
  try { return Boolean(localStorage.getItem(VIEW_KEY)); } catch (e) { return false; }
}

function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY));
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.scale)) return v;
  } catch (e) { /* fall through */ }
  return { x: 40, y: 40, scale: 1 };
}

function saveView() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* convenience only */ }
}

function applyView() {
  const world = container?.querySelector('[data-world]');
  if (!world) return;
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  const g = GRID * view.scale;
  viewport.style.backgroundSize = `${g}px ${g}px`;
  viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
}

function screenToBoard(clientX, clientY) {
  const r = viewport.getBoundingClientRect();
  return { x: (clientX - r.left - view.x) / view.scale, y: (clientY - r.top - view.y) / view.scale };
}

function viewCenter() {
  const r = viewport.getBoundingClientRect();
  return screenToBoard(r.left + r.width / 2, r.top + r.height / 2);
}

// Zoom/pan so a board rectangle fills the viewport (never past 100%).
function showRect(rect, pad = 40) {
  if (!viewport) return;
  const r = viewport.getBoundingClientRect();
  const scale = Math.min(1, (r.width - pad * 2) / Math.max(rect.w, 1), (r.height - pad * 2) / Math.max(rect.h, 1));
  view.scale = Math.max(MIN_SCALE, scale);
  view.x = r.width / 2 - (rect.x + rect.w / 2) * view.scale;
  view.y = r.height / 2 - (rect.y + rect.h / 2) * view.scale;
  applyView();
  saveView();
}

function fitAll() {
  const shown = items().filter((i) => i.kind !== 'edge');
  if (!shown.length) {
    view = { x: 40, y: 40, scale: 1 };
    applyView();
    return;
  }
  const rects = shown.map(rectOf);
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  showRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

// Pan just enough to bring an item on screen.
function ensureVisible(item) {
  const r = viewport.getBoundingClientRect();
  const rect = rectOf(item);
  const left = rect.x * view.scale + view.x;
  const top = rect.y * view.scale + view.y;
  const right = left + rect.w * view.scale;
  const bottom = top + rect.h * view.scale;
  if (left < 20) view.x += 20 - left;
  else if (right > r.width - 20) view.x -= right - (r.width - 20);
  if (top < 20) view.y += 20 - top;
  else if (bottom > r.height - 20) view.y -= bottom - (r.height - 20);
  applyView();
  saveView();
}

// --- Rendering ---------------------------------------------------------

function colorOf(item) {
  return hexForNotionColor(item.color || (item.kind === 'section' ? 'default' : 'gray'));
}

function sectionHtml(s) {
  const r = rectOf(s);
  const hex = colorOf(s);
  const editing = s.id === editingId;
  return `
    <div class="wb-section${s.id === selectedId ? ' is-selected' : ''}" data-item="${s.id}"
      style="left:${r.x}px; top:${r.y}px; width:${r.w}px; height:${r.h}px; --item-color:${hex}; background:${hexToRgba(hex, 0.06)};">
      <div class="wb-section-title mono" data-section-title="${s.id}">
        ${editing
          ? `<input type="text" class="wb-section-input" data-edit-input value="${escapeHtml(s.text || '')}" placeholder="Section name">`
          : (escapeHtml(s.text || '') || '<span class="muted">Untitled section</span>')}
      </div>
      <span class="wb-resize" data-resize="${s.id}"></span>
    </div>
  `;
}

function boxHtml(b) {
  const r = rectOf(b);
  const hex = colorOf(b);
  const editing = b.id === editingId;
  return `
    <div class="wb-box${b.id === selectedId ? ' is-selected' : ''}" data-item="${b.id}"
      style="left:${r.x}px; top:${r.y}px; width:${r.w}px; height:${r.h}px; --item-color:${hex}; background:${hexToRgba(hex, 0.16)};">
      ${editing
        ? `<textarea class="wb-box-input" data-edit-input placeholder="Type…">${escapeHtml(b.text || '')}</textarea>`
        : `<div class="wb-box-text">${escapeHtml(b.text || '')}</div>`}
      <span class="wb-port" data-port="${b.id}" title="Drag to another box to connect"></span>
      <span class="wb-resize" data-resize="${b.id}"></span>
    </div>
  `;
}

// Where the line from a rect's center toward (tx, ty) leaves the rect.
function borderPoint(r, tx, ty) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(Math.abs((r.w / 2) / (dx || 1e-9)), Math.abs((r.h / 2) / (dy || 1e-9)));
  return { x: cx + dx * t, y: cy + dy * t };
}

function edgeEnds(edge, rects) {
  const a = rects.get(edge.fromId);
  const b = rects.get(edge.toId);
  if (!a || !b) return null;
  const p = borderPoint(a, b.x + b.w / 2, b.y + b.h / 2);
  const q = borderPoint(b, a.x + a.w / 2, a.y + a.h / 2);
  return { p, q };
}

function edgesSvg(rects) {
  const lines = items().filter((i) => i.kind === 'edge').map((e) => {
    const ends = edgeEnds(e, rects);
    if (!ends) return '';
    const { p, q } = ends;
    const sel = e.id === selectedId ? ' is-selected' : '';
    return `
      <line class="wb-edge${sel}" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"></line>
      <line class="wb-edge-hit" data-edge="${e.id}" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"></line>
    `;
  }).join('');
  return `<svg class="wb-edges" data-edges>${lines}<line class="wb-edge wb-edge-temp" data-temp-edge x1="0" y1="0" x2="0" y2="0" style="display:none"></line></svg>`;
}

function liveRects() {
  return new Map(items().filter((i) => i.kind !== 'edge').map((i) => [i.id, rectOf(i)]));
}

function redrawEdges(rects) {
  const svg = container.querySelector('[data-edges]');
  if (svg) svg.outerHTML = edgesSvg(rects);
}

function toolbarHtml() {
  const sel = selectedId ? itemById(selectedId) : null;
  const colorable = sel && sel.kind !== 'edge';
  const secs = sections();
  return `
    <button type="button" data-tool="add-box" title="New box (N)">+ Box</button>
    <button type="button" data-tool="add-section">+ Section</button>
    <span class="wb-swatches" title="${colorable ? 'Color' : 'Select a box or section to color it'}">
      ${COLORS.map((c) => `<button type="button" class="wb-swatch${colorable && (sel.color || (sel.kind === 'section' ? 'default' : 'gray')) === c ? ' is-current' : ''}"
        data-tool="color" data-color="${c}" style="--swatch:${hexForNotionColor(c)};" ${colorable ? '' : 'disabled'} aria-label="${c}"></button>`).join('')}
    </span>
    <button type="button" data-tool="delete" ${sel ? '' : 'disabled'} title="Delete (Del)">Delete</button>
    <button type="button" data-tool="fit" title="Fit everything (0)">Fit</button>
    ${secs.length ? `
      <span class="wb-jumps">
        ${secs.slice(0, 9).map((s, i) => `<button type="button" class="wb-jump" data-tool="jump" data-id="${s.id}" title="Jump (${i + 1})">${i + 1} ${escapeHtml(s.text || 'Untitled')}</button>`).join('')}
      </span>
    ` : ''}
  `;
}

function rebuild() {
  if (!container) return;
  const world = container.querySelector('[data-world]');
  const all = items();
  const rects = liveRects();
  world.innerHTML = `
    ${all.filter((i) => i.kind === 'section').map(sectionHtml).join('')}
    ${edgesSvg(rects)}
    ${all.filter((i) => i.kind === 'box').map(boxHtml).join('')}
    ${all.length ? '' : '<p class="wb-empty muted">Double-click anywhere (or press N) to add a box.</p>'}
  `;
  container.querySelector('[data-toolbar]').innerHTML = toolbarHtml();
  applyView();
  wireEditor();
}

// Selection changes only flip classes, so a double-click's second click
// still lands on the same element.
function select(id) {
  selectedId = id;
  container.querySelectorAll('[data-item]').forEach((el) => el.classList.toggle('is-selected', el.dataset.item === id));
  container.querySelectorAll('.wb-edge:not(.wb-edge-temp)').forEach((el) => {
    el.classList.toggle('is-selected', el.nextElementSibling?.dataset.edge === id);
  });
  container.querySelector('[data-toolbar]').innerHTML = toolbarHtml();
}

function onStoreChanged() {
  if (!container || drag || editingId) return;
  if (selectedId && !itemById(selectedId)) selectedId = null;
  rebuild();
}

// --- Editing -------------------------------------------------------------

function startEditing(id, isNew = false) {
  selectedId = id;
  editingId = id;
  editingIsNew = isNew;
  rebuild();
}

function wireEditor() {
  const input = container.querySelector('[data-edit-input]');
  if (!input) return;
  input.focus();
  if (input.tagName === 'INPUT') input.select();
  else input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // board keys are off while typing
    const isBox = input.tagName === 'TEXTAREA';
    if (e.key === 'Escape' || (e.key === 'Enter' && (!isBox || e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      commitEdit(input);
    }
  });
  input.addEventListener('blur', () => commitEdit(input));
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
}

function commitEdit(input) {
  const id = editingId;
  if (!id) return;
  const text = input.value.trim();
  const wasNew = editingIsNew;
  editingId = null;
  editingIsNew = false;
  const item = itemById(id);
  if (wasNew && !text && item?.kind === 'box') {
    deleteItem(id);
    selectedId = null;
  } else if (item && text !== (item.text || '')) {
    store.upsert('BoardItems', { id, text });
  }
  rebuild();
  viewport?.focus({ preventScroll: true });
}

// --- Creating ----------------------------------------------------------

function addBoxAt(x, y, extra = {}) {
  const row = addItem({ kind: 'box', x: snap(x), y: snap(y), w: BOX_W, h: BOX_H, color: 'gray', ...extra });
  startEditing(row.id, true);
  return row;
}

function addBoxAtCenter() {
  const c = viewCenter();
  addBoxAt(c.x - BOX_W / 2, c.y - BOX_H / 2);
}

// Enter on a box: a new box to its right, already connected.
function addConnectedBox(fromId) {
  const from = itemById(fromId);
  if (!from || from.kind !== 'box') return;
  const r = rectOf(from);
  let y = r.y;
  // Step down past boxes already sitting in that spot.
  const x = r.x + r.w + GRID * 4;
  while (boxes().some((b) => {
    const o = rectOf(b);
    return o.x < x + BOX_W && o.x + o.w > x && o.y < y + BOX_H && o.y + o.h > y;
  })) y += BOX_H + GRID;
  const row = addItem({ kind: 'box', x: snap(x), y: snap(y), w: BOX_W, h: BOX_H, color: from.color || 'gray' });
  connect(fromId, row.id);
  ensureVisible(row);
  startEditing(row.id, true);
}

function addSection() {
  const c = viewCenter();
  const row = addItem({ kind: 'section', x: snap(c.x - SECTION_W / 2), y: snap(c.y - SECTION_H / 2), w: SECTION_W, h: SECTION_H, color: 'default', text: '' });
  startEditing(row.id, true);
}

// --- Pointer gestures --------------------------------------------------

function boxesInside(section) {
  const s = rectOf(section);
  return boxes().filter((b) => {
    const r = rectOf(b);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h;
  });
}

function onPointerDown(e) {
  if (e.button !== 0 || editingId) return;
  const t = e.target;
  const start = { x: e.clientX, y: e.clientY };
  const resize = t.closest('[data-resize]');
  const port = t.closest('[data-port]');
  const edge = t.closest('[data-edge]');
  const box = t.closest('.wb-box');
  const sectionTitle = t.closest('[data-section-title]');

  if (resize) {
    const item = itemById(resize.dataset.resize);
    select(item.id);
    drag = { type: 'resize', id: item.id, start, orig: rectOf(item) };
  } else if (port) {
    select(port.dataset.port);
    drag = { type: 'connect', id: port.dataset.port, start };
  } else if (edge) {
    select(edge.dataset.edge);
    drag = null;
    return;
  } else if (box || sectionTitle) {
    const id = box ? box.dataset.item : sectionTitle.dataset.sectionTitle;
    const item = itemById(id);
    select(id);
    const carried = item.kind === 'section' ? boxesInside(item).map((b) => ({ id: b.id, orig: rectOf(b) })) : [];
    drag = { type: 'move', id, start, orig: rectOf(item), carried, moved: false };
  } else {
    select(null);
    drag = { type: 'pan', start, orig: { x: view.x, y: view.y } };
  }
  viewport.setPointerCapture(e.pointerId);
  viewport.focus({ preventScroll: true });
}

function setElRect(id, r) {
  const el = container.querySelector(`[data-item="${id}"]`);
  if (!el) return;
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

function onPointerMove(e) {
  if (!drag) return;
  const dxScreen = e.clientX - drag.start.x;
  const dyScreen = e.clientY - drag.start.y;
  const dx = dxScreen / view.scale;
  const dy = dyScreen / view.scale;

  if (drag.type === 'pan') {
    view.x = drag.orig.x + dxScreen;
    view.y = drag.orig.y + dyScreen;
    applyView();
    return;
  }
  if (drag.type === 'connect') {
    const from = rectOf(itemById(drag.id));
    const p = screenToBoard(e.clientX, e.clientY);
    const a = borderPoint(from, p.x, p.y);
    const line = container.querySelector('[data-temp-edge]');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
    line.style.display = '';
    return;
  }

  const rects = liveRects();
  if (drag.type === 'move') {
    if (Math.abs(dxScreen) + Math.abs(dyScreen) > 3) drag.moved = true;
    const r = { ...drag.orig, x: drag.orig.x + dx, y: drag.orig.y + dy };
    rects.set(drag.id, r);
    setElRect(drag.id, r);
    for (const c of drag.carried) {
      const cr = { ...c.orig, x: c.orig.x + dx, y: c.orig.y + dy };
      rects.set(c.id, cr);
      setElRect(c.id, cr);
    }
  } else if (drag.type === 'resize') {
    const item = itemById(drag.id);
    const minW = item.kind === 'section' ? 200 : 80;
    const minH = item.kind === 'section' ? 120 : 40;
    const r = { ...drag.orig, w: Math.max(minW, drag.orig.w + dx), h: Math.max(minH, drag.orig.h + dy) };
    rects.set(drag.id, r);
    setElRect(drag.id, r);
    drag.moved = true;
  }
  drag.liveRects = rects;
  redrawEdges(rects);
}

function onPointerUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (viewport.hasPointerCapture?.(e.pointerId)) viewport.releasePointerCapture(e.pointerId);

  if (d.type === 'pan') {
    saveView();
    return;
  }
  if (d.type === 'connect') {
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.wb-box');
    container.querySelector('[data-temp-edge]').style.display = 'none';
    if (target && target.dataset.item !== d.id) connect(d.id, target.dataset.item);
    return;
  }
  if (!d.moved || !d.liveRects) {
    // A click (or a jiggle under 3px): put back anything nudged, without a
    // rebuild, so a double-click's second click finds the same element.
    if (d.liveRects) {
      setElRect(d.id, d.orig);
      for (const c of d.carried || []) setElRect(c.id, c.orig);
      redrawEdges(liveRects());
    }
    return;
  }
  const r = d.liveRects.get(d.id);
  if (d.type === 'move') {
    store.upsert('BoardItems', { id: d.id, x: snap(r.x), y: snap(r.y) });
    for (const c of d.carried) {
      const cr = d.liveRects.get(c.id);
      store.upsert('BoardItems', { id: c.id, x: snap(cr.x), y: snap(cr.y) });
    }
  } else {
    store.upsert('BoardItems', { id: d.id, w: snap(r.w), h: snap(r.h) });
  }
}

function onWheel(e) {
  e.preventDefault();
  const r = viewport.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const factor = Math.exp(-e.deltaY * 0.0015);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  // Keep the board point under the cursor fixed.
  view.x = mx - ((mx - view.x) / view.scale) * scale;
  view.y = my - ((my - view.y) / view.scale) * scale;
  view.scale = scale;
  applyView();
  saveView();
}

function onDoubleClick(e) {
  if (editingId) return;
  const box = e.target.closest('.wb-box');
  const title = e.target.closest('[data-section-title]');
  if (box) startEditing(box.dataset.item);
  else if (title) startEditing(title.dataset.sectionTitle);
  else if (!e.target.closest('[data-edge], [data-port], [data-resize]')) {
    const p = screenToBoard(e.clientX, e.clientY);
    addBoxAt(p.x - BOX_W / 2, p.y - BOX_H / 2);
  }
}

// --- Toolbar + keys ------------------------------------------------------

function deleteSelected() {
  if (!selectedId) return;
  deleteItem(selectedId); // a section's boxes stay; only the frame goes
  selectedId = null;
  rebuild();
}

function jumpTo(id) {
  const s = itemById(id);
  if (!s) return;
  select(id);
  showRect(rectOf(s));
}

function onToolbarClick(e) {
  const btn = e.target.closest('[data-tool]');
  if (!btn || btn.disabled) return;
  switch (btn.dataset.tool) {
    case 'add-box': addBoxAtCenter(); break;
    case 'add-section': addSection(); break;
    case 'color':
      if (selectedId) store.upsert('BoardItems', { id: selectedId, color: btn.dataset.color });
      break;
    case 'delete': deleteSelected(); break;
    case 'fit': fitAll(); break;
    case 'jump': jumpTo(btn.dataset.id); break;
    default: break;
  }
}

// Tab order: boxes top-to-bottom, left-to-right.
function cycleSelection(dir) {
  const list = boxes().sort((a, b) => num(a.y) - num(b.y) || num(a.x) - num(b.x));
  if (!list.length) return;
  const i = list.findIndex((b) => b.id === selectedId);
  const next = list[(i + dir + list.length) % list.length];
  select(next.id);
  ensureVisible(next);
}

function nudge(dx, dy) {
  const item = selectedId && itemById(selectedId);
  if (!item || item.kind === 'edge') return;
  const moving = [item, ...(item.kind === 'section' ? boxesInside(item) : [])];
  for (const m of moving) store.upsert('BoardItems', { id: m.id, x: num(m.x) + dx, y: num(m.y) + dy });
}

function onKeyDown(e) {
  if (!container || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, textarea, select')) return;
  const sel = selectedId && itemById(selectedId);
  const step = e.shiftKey ? GRID * 5 : GRID;
  const k = e.key;

  if (k === 'Escape') {
    e.preventDefault();
    if (selectedId) select(null);
    else location.hash = '#/projects';
  } else if (k === 'n' || k === 'N') {
    e.preventDefault();
    addBoxAtCenter();
  } else if (k === 'Enter' && sel) {
    e.preventDefault();
    if (sel.kind === 'box') addConnectedBox(sel.id);
    else if (sel.kind === 'section') startEditing(sel.id);
  } else if ((k === 'e' || k === 'E') && sel && sel.kind !== 'edge') {
    e.preventDefault();
    startEditing(sel.id);
  } else if ((k === 'Delete' || k === 'Backspace') && sel) {
    e.preventDefault();
    deleteSelected();
  } else if (k.startsWith('Arrow') && sel) {
    e.preventDefault();
    nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
  } else if (k === 'Tab') {
    e.preventDefault();
    cycleSelection(e.shiftKey ? -1 : 1);
  } else if (/^[1-9]$/.test(k)) {
    const s = sections()[Number(k) - 1];
    if (s) { e.preventDefault(); jumpTo(s.id); }
  } else if (k === '0') {
    e.preventDefault();
    fitAll();
  }
}
