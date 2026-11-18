// A project's report editor (#/projects/<slug>/report), opened from the
// project page's Report button. Everything autosaves (js/report.js), so it
// can be closed and reopened at any point.
//
// Layout: header, the sticky symbol toolbar (templates, Greek, and every
// nomenclature symbol as a chip), the Nomenclature table (grouped), then the
// sections and their blocks.
//
// Editing model: every editable thing is a "field" (.rf) that shows its
// rendered form; clicking (or tabbing into) one swaps in a textarea running
// js/mathInput.js's typing rules, with a live preview underneath. Leaving it
// (Enter in an equation, Escape, clicking elsewhere) saves and renders it
// again in place. Whole-page rebuilds only happen while no field is open, so
// a sync arriving mid-edit can never throw away what's being typed.

import { escapeHtml, hexToRgba } from '../format.js?v=70';
import { projectBySlug } from '../projects.js?v=70';
import { getGithubRepo } from '../projectPlan.js?v=70';
import {
  loadKatex, renderMath, renderRich, attachMathInput, insertMath, prepareSymbols, GREEK_LETTERS, GREEK_KEY_FOR,
} from '../mathInput.js?v=70';
import * as R from '../report.js?v=70';

let container = null;
let slug = null;
let active = null; // { rf, ta, key, mode } — the open field
let selfWrite = false; // our own field saves: no rebuild for those
let pendingRebuild = false;
let rebuildTimer = null;
const saveTimers = new Map();
let symbols = []; // prepared for rendering (hover data)
let symbolRows = new Map(); // id -> nomenclature row, for tooltips
let tooltip = null;
// Which nomenclature group's chips the toolbar shows (a group id, '' for
// ungrouped, NO_TAB for none) — remembered per report, per browser.
const NO_TAB = '__none__';
let symbolTab = null;
// View mode: read-only, editing chrome hidden. Remembered per browser.
let viewing = false;

const VIEW_KEY = 'dietz:reportViewing';
const tabKey = () => `dietz:reportSymbolTab:${slug}`;

function readPref(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* convenience only */ }
}

const BLOCK_LABELS = { paragraph: 'Paragraph', equation: 'Equation', bullets: 'Bullets', table: 'Table', figure: 'Figure' };

// Toolbar templates: [label, shorthand inserted, tooltip, form used when
// something is selected (optional)]. ⬚ = a slot; %s = the selection (a slot
// if none), %e = the selection (nothing if none) — see insertMath. So
// selecting 5x+3 and pressing ∫ puts it under the integral.
const TEMPLATE_BUTTONS = [
  ['√', '√(%s)', 'Square root: sqrt + space. Wraps the selection.'],
  ['∫', '∫_(⬚)^(⬚) %s', 'Integral: int + space. Wraps the selection.'],
  ['∑', '∑_(⬚)^(⬚) %s', 'Sum: sum + space. Wraps the selection.'],
  ['d/d', '(d%s)/(d⬚)', 'Derivative: d/d + space. Wraps the selection.'],
  ['∂/∂', '(∂%s)/(∂⬚)', 'Partial derivative: pd/pd + space. Wraps the selection.'],
  ['ẋ', 'dot', 'Dot: type right after the letter, e.g. qdot', '\\dot{%s}'],
  ['ẍ', 'ddot', 'Double dot: qddot', '\\ddot{%s}'],
  ['x̂', 'hat', 'Hat: xhat', '\\hat{%s}'],
  ['vec', 'vec', 'Arrow: rvec', '\\vec{%s}'],
  ['𝐱', 'bf', 'Bold: rbf', '\\boldsymbol{%s}'],
  ['[ ]', 'mat(%s, ⬚; ⬚, ⬚)', 'Matrix: mat(a, b; c, d) — , between columns, ; between rows'],
  ['×', '×', 'times'], ['⋅', '⋅', 'cdot'], ['⊗', '⊗', 'otimes'], ['±', '±', 'pm or +-'],
  ['≈', '≈', 'approx or ~='], ['≤', '≤', 'leq or <='], ['≥', '≥', 'geq or >='],
  ['≼', '≼', 'Matrix inequality (negative semidefinite): preceq + space'],
  ['≻', '≻', 'Matrix inequality (positive definite): succ + space'],
  ['→', '→', '->'],
  ['∞', '∞', 'inf'], ['∂', '∂', 'partial'], ['∇', '∇', 'nabla'], ['°', '°', 'deg'],
];

// --- Lifecycle ---------------------------------------------------------------

export function render(rootEl, params) {
  container = rootEl;
  slug = params.id;
  active = null;
  pendingRebuild = false;
  symbolTab = readPref(tabKey());
  viewing = readPref(VIEW_KEY) === '1';
  container.closest('#app')?.classList.add('app-report');

  tooltip = document.createElement('div');
  tooltip.className = 'sym-tip';
  tooltip.hidden = true;
  document.body.appendChild(tooltip);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('dietz:store-changed', onStoreChanged);
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container.addEventListener('focusin', onFocusIn);
  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('mouseover', onMouseOver);

  rebuild();
  // Math renders as plain shorthand until KaTeX arrives, then properly.
  loadKatex().then(() => { if (container) rebuild(); }).catch(() => {});
}

export function unmount() {
  if (active) deactivate(); // saves the open field
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
  clearTimeout(rebuildTimer);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('dietz:store-changed', onStoreChanged);
  if (container) {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
    container.removeEventListener('focusin', onFocusIn);
    container.removeEventListener('mousedown', onMouseDown);
    container.removeEventListener('mouseover', onMouseOver);
    container.closest('#app')?.classList.remove('app-report', 'report-viewing');
  }
  tooltip?.remove();
  tooltip = null;
  container = null;
}

function onStoreChanged() {
  if (!container || selfWrite) return;
  if (active) { pendingRebuild = true; return; }
  rebuild();
}

function onKeyDown(e) {
  if (e.key !== 'Escape' || active || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, textarea, select')) return;
  e.preventDefault();
  location.hash = `#/projects/${encodeURIComponent(slug)}`;
}

// Structural changes (add/move/delete): one rebuild at the end, not one per
// store write.
function mutate(fn) {
  if (active) deactivate();
  selfWrite = true;
  try { fn(); } finally { selfWrite = false; }
  rebuild();
}

// --- Fields --------------------------------------------------------------

// key: "n|<id>|<column>" (nomenclature), "b|<id>|<column>" (section or
// block), "c|<id>|<row>|<col>" (a table cell).
function rowFor(key) {
  const [t, id] = key.split('|');
  return R.findRow(t === 'n' ? 'nom' : 'block', id);
}

function getValue(key) {
  const [t, , a, b] = key.split('|');
  const row = rowFor(key);
  if (!row) return '';
  if (t === 'c') return R.tableRows(row)[Number(a)]?.[Number(b)] ?? '';
  return String(row[a] ?? '');
}

function writeValue(key, value) {
  if (getValue(key) === value) return;
  const [t, id, a, b] = key.split('|');
  selfWrite = true;
  try {
    if (t === 'n') R.updateNom(id, { [a]: value });
    else if (t === 'b') R.updateBlock(id, { [a]: value });
    else if (t === 'c') R.setTableCell(id, Number(a), Number(b), value);
  } finally {
    selfWrite = false;
  }
}

function setStatus(text) {
  const el = container?.querySelector('[data-status]');
  if (el) el.textContent = text;
}

function scheduleSave(key, value) {
  clearTimeout(saveTimers.get(key));
  setStatus('Saving…');
  saveTimers.set(key, setTimeout(() => flushSave(key, value), 600));
}

function flushSave(key, value) {
  clearTimeout(saveTimers.get(key));
  saveTimers.delete(key);
  writeValue(key, value);
  if (!saveTimers.size) setStatus('Saved');
}

// opts: mode 'eq' | 'text' | 'plain'; multiline; display (centred block
// equation); as 'bullets'; placeholder; cls; rebuild (re-render the page
// after editing — nomenclature and figure paths affect other things).
function fieldHtml(key, opts) {
  const { mode, multiline = false, display = false, as = '', placeholder = '', cls = '', rebuild: rb = false } = opts;
  return `<div class="rf rf-${mode}${display ? ' rf-display' : ''} ${cls}" tabindex="0" data-field="${escapeHtml(key)}" data-mode="${mode}"`
    + `${multiline ? ' data-multiline="1"' : ''}${display ? ' data-display="1"' : ''}${as ? ` data-as="${as}"` : ''}`
    + `${rb ? ' data-rebuild="1"' : ''} data-placeholder="${escapeHtml(placeholder)}">`
    + `${displayHtml(getValue(key), { mode, display, as, placeholder })}</div>`;
}

function displayHtml(value, { mode, display, as, placeholder }) {
  if (!String(value).trim()) return `<span class="rf-placeholder">${escapeHtml(placeholder)}</span>`;
  if (mode === 'eq') return renderMath(value, { display, symbols });
  if (mode === 'plain') return escapeHtml(value);
  if (as === 'bullets') {
    const items = String(value).split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '')).filter((l) => l.trim());
    return `<ul class="rf-bullets">${items.map((l) => `<li>${renderRich(l, { symbols })}</li>`).join('')}</ul>`;
  }
  return renderRich(value, { symbols });
}

function specOf(rf) {
  return {
    mode: rf.dataset.mode,
    display: Boolean(rf.dataset.display),
    as: rf.dataset.as || '',
    placeholder: rf.dataset.placeholder || '',
  };
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

function updatePreview() {
  if (!active) return;
  const preview = active.rf.querySelector('.rf-preview');
  if (!preview) return;
  const { value } = active.ta;
  if (active.mode === 'eq') preview.innerHTML = renderMath(value, { display: Boolean(active.rf.dataset.display), symbols });
  else preview.innerHTML = /[$]/.test(value) ? displayHtml(value, specOf(active.rf)) : '';
}

function activate(rf) {
  if (active?.rf === rf) return;
  if (active) deactivate();
  const key = rf.dataset.field;
  const mode = rf.dataset.mode;
  rf.classList.add('is-editing');
  rf.removeAttribute('tabindex');
  rf.innerHTML = `<textarea class="rf-input" rows="1" spellcheck="${mode === 'text'}"></textarea>${mode === 'plain' ? '' : '<div class="rf-preview"></div>'}`;
  const ta = rf.querySelector('textarea');
  ta.value = getValue(key);
  ta.placeholder = rf.dataset.placeholder || '';
  active = { rf, ta, key, mode };

  if (mode === 'plain') {
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        deactivate();
      }
    });
  } else {
    attachMathInput(ta, { mode, multiline: Boolean(rf.dataset.multiline), onCommit: () => deactivate() });
  }
  ta.addEventListener('input', () => {
    autosize(ta);
    updatePreview();
    scheduleSave(key, ta.value);
  });
  ta.addEventListener('blur', () => { if (active?.ta === ta) deactivate(); });

  autosize(ta);
  updatePreview();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function deactivate() {
  if (!active) return;
  const { rf, ta, key } = active;
  active = null;
  flushSave(key, ta.value);
  rf.classList.remove('is-editing');
  rf.setAttribute('tabindex', '0');
  if (key.startsWith('n|')) {
    refreshSymbols();
    renderToolbar();
  }
  rf.innerHTML = displayHtml(ta.value, specOf(rf));
  if (rf.dataset.rebuild) pendingRebuild = true;
  if (pendingRebuild) {
    // Later, and only if nothing got opened meanwhile — a rebuild right now
    // would swap out the field being clicked into.
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => { if (container && !active) rebuild(); }, 300);
  }
}

function openField(key) {
  const rf = container?.querySelector(`.rf[data-field="${CSS.escape(key)}"]`);
  if (rf) activate(rf);
}

// --- Events --------------------------------------------------------------

function onFocusIn(e) {
  if (viewing) return;
  const rf = e.target.closest?.('.rf');
  if (rf && !rf.classList.contains('is-editing') && container.contains(rf)) activate(rf);
}

// Toolbar buttons must not steal focus from the field they insert into.
function onMouseDown(e) {
  if (e.target.closest('.report-toolbar button')) e.preventDefault();
}

function onMouseOver(e) {
  if (!tooltip) return;
  const el = e.target.closest?.('[data-sym]');
  const row = el && symbolRows.get(el.getAttribute('data-sym'));
  if (!row) { tooltip.hidden = true; return; }
  tooltip.innerHTML = `
    <div class="sym-tip-sym">${renderMath(row.symbol)}</div>
    ${row.description ? `<div class="sym-tip-desc">${renderRich(row.description)}</div>` : ''}
    <div class="sym-tip-units mono">${row.units ? renderRich(row.units) : '<span class="muted">no units</span>'}</div>
    ${row.groupName ? `<div class="sym-tip-group mono muted">${escapeHtml(row.groupName)}</div>` : ''}
  `;
  tooltip.hidden = false;
  const r = el.getBoundingClientRect();
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  const top = r.top - th - 8 < 8 ? r.bottom + 8 : r.top - th - 8;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function confirmDeleteBlock(id) {
  const row = R.findRow('block', id);
  if (!row) return false;
  if (row.kind === 'section') {
    const n = R.blockCount(id);
    return !n || confirm(`Delete this section and the ${n} block${n === 1 ? '' : 's'} in it?`);
  }
  const hasContent = String(row.text || '').trim() || String(row.caption || '').trim()
    || (row.kind === 'table' && R.tableRows(row).some((r) => r.some((c) => String(c).trim())));
  return !hasContent || confirm(`Delete this ${BLOCK_LABELS[row.kind]?.toLowerCase() || 'block'}?`);
}

function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || !container.contains(btn)) return;
  const { id } = btn.dataset;
  switch (btn.dataset.action) {
    case 'tb-insert': {
      if (!active || active.mode === 'plain') { flashToolbarHint(); return; }
      const { ta } = active;
      const hasSelection = ta.selectionStart !== ta.selectionEnd;
      insertMath(ta, hasSelection && btn.dataset.wrap ? btn.dataset.wrap : btn.dataset.insert, active.mode);
      return;
    }
    case 'symbol-tab': {
      const tab = btn.dataset.tab;
      symbolTab = tab === currentTab() ? NO_TAB : tab;
      writePref(tabKey(), symbolTab);
      renderToolbar();
      return;
    }
    case 'toggle-view': {
      if (active) deactivate();
      viewing = !viewing;
      writePref(VIEW_KEY, viewing ? '1' : '0');
      rebuild();
      return;
    }
    case 'start-report': mutate(() => R.startReport(slug)); return;
    case 'nom-add-group': {
      let row;
      mutate(() => { row = R.addGroup(slug); });
      openField(`n|${row.id}|name`);
      return;
    }
    case 'nom-add-symbol': {
      let row;
      mutate(() => { row = R.addSymbol(slug, btn.dataset.group || ''); });
      openField(`n|${row.id}|symbol`);
      return;
    }
    case 'nom-up': mutate(() => R.moveNom(id, -1)); return;
    case 'nom-down': mutate(() => R.moveNom(id, 1)); return;
    case 'nom-delete': {
      const row = R.findRow('nom', id);
      if (row?.kind === 'group' && !confirm('Delete this group? Its symbols stay, as ungrouped.')) return;
      mutate(() => R.deleteNom(id));
      return;
    }
    case 'section-add': {
      let row;
      mutate(() => { row = R.addSection(slug, btn.dataset.after || ''); });
      openField(`b|${row.id}|text`);
      return;
    }
    case 'block-add': {
      let row;
      mutate(() => { row = R.addBlock(slug, btn.dataset.section, btn.dataset.kind); });
      openField(row.kind === 'table' ? `b|${row.id}|caption` : `b|${row.id}|text`);
      return;
    }
    case 'block-up': mutate(() => R.moveBlock(id, -1)); return;
    case 'block-down': mutate(() => R.moveBlock(id, 1)); return;
    case 'block-delete': if (confirmDeleteBlock(id)) mutate(() => R.deleteBlock(id)); return;
    case 'table-op': mutate(() => R.resizeTable(id, btn.dataset.op)); return;
    default:
  }
}

function onChange(e) {
  const lettered = e.target.closest('[data-lettered]');
  if (lettered) { mutate(() => R.setLettered(lettered.dataset.lettered, lettered.checked)); return; }
  const group = e.target.closest('[data-nom-group]');
  if (group) mutate(() => R.setSymbolGroup(group.dataset.nomGroup, group.value));
}

function flashToolbarHint() {
  const hint = container.querySelector('.rt-hint');
  if (!hint) return;
  hint.classList.remove('is-flash');
  void hint.offsetWidth; // restart the animation
  hint.classList.add('is-flash');
}

// --- Toolbar ---------------------------------------------------------------

function refreshSymbols() {
  const list = R.symbolList(slug);
  symbolRows = new Map(list.map((s) => [s.id, s]));
  symbols = prepareSymbols(list.map((s) => ({ id: s.id, source: s.symbol })));
}

function chipHtml(s) {
  return `<button type="button" class="rt-chip" data-action="tb-insert" data-insert="${escapeHtml(s.symbol)}" data-sym="${escapeHtml(s.id)}">${renderMath(s.symbol)}</button>`;
}

// The nomenclature's groups as toolbar tabs: [{ id, name, symbols }], only
// the ones with a filled-in symbol. id '' = the ungrouped symbols.
function symbolTabs() {
  const { ungrouped, groups } = R.nomenclature(slug);
  const filled = (list) => list.filter((s) => String(s.symbol || '').trim());
  return [
    ...(filled(ungrouped).length ? [{ id: '', name: 'Ungrouped', symbols: filled(ungrouped) }] : []),
    ...groups.map((g) => ({ id: g.id, name: g.name || 'Untitled group', symbols: filled(g.symbols) })).filter((g) => g.symbols.length),
  ];
}

// The open tab's id, or null when none is open. Defaults to the first tab
// (also when the remembered one has since been deleted).
function currentTab(tabs = symbolTabs()) {
  if (symbolTab === NO_TAB) return null;
  return tabs.some((t) => t.id === symbolTab) ? symbolTab : (tabs[0]?.id ?? null);
}

function toolbarHtml() {
  const tabs = symbolTabs();
  const openId = currentTab(tabs);
  const open = tabs.find((t) => t.id === openId);
  const toolBtn = ([label, insert, title, wrap]) => `<button type="button" class="rt-btn" data-action="tb-insert" data-insert="${escapeHtml(insert)}"${wrap ? ` data-wrap="${escapeHtml(wrap)}"` : ''} title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
  return `
    <div class="rt-line">
      ${TEMPLATE_BUTTONS.map(toolBtn).join('')}
      <span class="rt-sep" aria-hidden="true"></span>
      ${GREEK_LETTERS.map((g) => `<button type="button" class="rt-btn rt-btn-greek" data-action="tb-insert" data-insert="${g}" title="${GREEK_KEY_FOR[g] ? `;${GREEK_KEY_FOR[g]}` : 'Greek'}">${g}</button>`).join('')}
    </div>
    ${tabs.length ? `
      <div class="rt-line rt-tabs">
        ${tabs.map((t) => `<button type="button" class="rt-tab${t.id === openId ? ' active' : ''}" data-action="symbol-tab" data-tab="${escapeHtml(t.id)}" title="${t.id === openId ? 'Hide' : 'Show'} these symbols">${escapeHtml(t.name)} <span class="rt-tab-count">${t.symbols.length}</span></button>`).join('')}
      </div>
      ${open ? `<div class="rt-line rt-symbols">${open.symbols.map(chipHtml).join('')}</div>` : ''}
    ` : '<div class="rt-line"><span class="muted rt-empty">Symbols you add to the nomenclature appear here.</span></div>'}
    <div class="rt-foot">
      <span class="rt-hint mono muted">Click into a field, then a button inserts at the cursor.</span>
      <details class="rt-help">
        <summary class="mono muted">Typing</summary>
        <ul>
          <li><kbd>\\</kbd> starts an equation inside text, <kbd>Enter</kbd> leaves it.</li>
          <li><kbd>f_a</kbd> <kbd>x^2</kbd> sub/superscript, <kbd>f_(ab)</kbd> for longer ones. <kbd>a/b</kbd> <kbd>(x+1)/(2y)</kbd> fraction (<kbd>\\/</kbd> for a plain slash).</li>
          <li><kbd>;</kbd> then a letter types Greek: <kbd>;a</kbd> α <kbd>;b</kbd> β <kbd>;g</kbd> γ <kbd>;d</kbd> δ <kbd>;q</kbd> θ <kbd>;l</kbd> λ <kbd>;m</kbd> μ <kbd>;r</kbd> ρ <kbd>;s</kbd> σ <kbd>;t</kbd> τ <kbd>;f</kbd> φ <kbd>;w</kbd> ω, capitals <kbd>;D</kbd> Δ <kbd>;W</kbd> Ω. <kbd>;;</kbd> is a plain ;.</li>
          <li><kbd>Space</kbd> after a word converts it: Greek names, <kbd>int</kbd> <kbd>sum</kbd> <kbd>prod</kbd> <kbd>sqrt</kbd> <kbd>d/d</kbd> <kbd>pd/pd</kbd> <kbd>partial</kbd> <kbd>times</kbd> <kbd>cdot</kbd> <kbd>otimes</kbd> <kbd>pm</kbd> <kbd>approx</kbd> <kbd>-&gt;</kbd> <kbd>&lt;=</kbd> <kbd>!=</kbd>…</li>
          <li><kbd>Backspace</kbd> straight after that space undoes the conversion.</li>
          <li><kbd>qdot</kbd> <kbd>qddot</kbd> <kbd>xhat</kbd> <kbd>rvec</kbd> <kbd>rbf</kbd> accents, <kbd>mat(a, b; c, d)</kbd> matrix, <kbd>"max"</kbd> upright text.</li>
          <li><kbd>Tab</kbd> jumps between ⬚ slots. In text, <kbd>s^-1</kbd> + space gives s⁻¹.</li>
          <li>In an equation, select something and type <kbd>(</kbd> <kbd>[</kbd> <kbd>{</kbd> <kbd>&lt;</kbd> to bracket it; toolbar buttons (∫ ∑ √ fraction…) wrap the selection too.</li>
          <li><kbd>Ctrl+B</kbd> bold, <kbd>Ctrl+I</kbd> italic, <kbd>Ctrl+U</kbd> underline.</li>
          <li><kbd>Enter</kbd> finishes an equation, <kbd>Esc</kbd> finishes anything. Hover a symbol for its description and units.</li>
        </ul>
      </details>
    </div>
  `;
}

function renderToolbar() {
  const bar = container?.querySelector('.report-toolbar');
  if (bar) bar.innerHTML = toolbarHtml();
}

// --- Nomenclature ------------------------------------------------------------

function nomActions(id, extra = '') {
  return `
    ${extra}
    <button type="button" class="ms-btn" tabindex="-1" data-action="nom-up" data-id="${id}" title="Move up">↑</button>
    <button type="button" class="ms-btn" tabindex="-1" data-action="nom-down" data-id="${id}" title="Move down">↓</button>
    <button type="button" class="ms-btn ms-btn-danger" tabindex="-1" data-action="nom-delete" data-id="${id}" title="Delete">✕</button>
  `;
}

function symbolRowHtml(s, groups) {
  const groupSelect = groups.length ? `
    <select class="nom-group-select" tabindex="-1" data-nom-group="${s.id}" title="Group">
      <option value="">No group</option>
      ${groups.map((g) => `<option value="${g.id}"${g.id === s.groupId ? ' selected' : ''}>${escapeHtml(g.name || 'Untitled group')}</option>`).join('')}
    </select>` : '';
  return `
    <tr class="nom-row">
      <td class="nom-sym">${fieldHtml(`n|${s.id}|symbol`, { mode: 'eq', placeholder: 'symbol', rebuild: true })}</td>
      <td class="nom-desc">${fieldHtml(`n|${s.id}|description`, { mode: 'text', placeholder: 'description', rebuild: true })}</td>
      <td class="nom-units">
        ${fieldHtml(`n|${s.id}|units`, { mode: 'text', placeholder: 'units, e.g. m s^-1', rebuild: true })}
        <span class="nom-actions">${nomActions(s.id, groupSelect)}</span>
      </td>
    </tr>
  `;
}

// "+ Symbol" under a group's rows ('' = the ungrouped ones at the top).
function addSymbolRowHtml(groupId) {
  return `
    <tr class="nom-add-row">
      <td colspan="3"><button type="button" class="ms-btn" tabindex="-1" data-action="nom-add-symbol" data-group="${groupId}">+ Symbol</button></td>
    </tr>
  `;
}

function nomenclatureHtml() {
  const { ungrouped, groups } = R.nomenclature(slug);
  const empty = !ungrouped.length && !groups.length;
  return `
    <section class="card report-nom">
      <div class="project-card-head">
        <h2 class="mono">Nomenclature</h2>
        <button type="button" data-action="nom-add-group">+ Group</button>
        <button type="button" data-action="nom-add-symbol">+ Symbol</button>
      </div>
      ${empty ? '<p class="muted">Define each symbol once here (symbol, what it is, its units), so equations don\'t need "where…" lists. They become chips in the toolbar, and hovering one anywhere shows its description and units.</p>' : `
        <table class="nom-table">
          <colgroup><col class="nom-col-sym"><col><col class="nom-col-units"></colgroup>
          <thead><tr><th>Symbol</th><th>Description</th><th>Units</th></tr></thead>
          <tbody>
            ${ungrouped.map((s) => symbolRowHtml(s, groups)).join('')}
            ${ungrouped.length ? addSymbolRowHtml('') : ''}
            ${groups.map((g) => `
              <tr class="nom-group-row">
                <td colspan="3">
                  ${fieldHtml(`n|${g.id}|name`, { mode: 'plain', placeholder: 'Group name', cls: 'nom-group-name', rebuild: true })}
                  <span class="nom-actions">${nomActions(g.id)}</span>
                </td>
              </tr>
              ${g.symbols.map((s) => symbolRowHtml(s, groups)).join('')}
              ${addSymbolRowHtml(g.id)}
            `).join('')}
          </tbody>
        </table>
      `}
    </section>
  `;
}

// --- Sections and blocks ------------------------------------------------------

function blockActions(id) {
  return `
    <button type="button" class="ms-btn" tabindex="-1" data-action="block-up" data-id="${id}" title="Move up">↑</button>
    <button type="button" class="ms-btn" tabindex="-1" data-action="block-down" data-id="${id}" title="Move down">↓</button>
    <button type="button" class="ms-btn ms-btn-danger" tabindex="-1" data-action="block-delete" data-id="${id}" title="Delete">✕</button>
  `;
}

// A repo path resolves against the project's GitHub repo (set on the
// project page); a full URL is used as-is.
function figureUrl(src) {
  const text = String(src || '').trim();
  if (!text) return '';
  if (/^(https?:|data:image\/)/i.test(text)) return text;
  const repo = getGithubRepo(slug);
  if (!repo) return '';
  const path = text.replace(/^\.?\//, '').split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/${path}`;
}

function tableHtml(b) {
  const rows = R.tableRows(b);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return `
    <div class="rb-caption"><span class="rb-label mono">Table ${b.number} –</span>${fieldHtml(`b|${b.id}|caption`, { mode: 'text', placeholder: 'caption' })}</div>
    <div class="rb-table-wrap">
      <table class="rb-table">
        ${rows.map((r, ri) => `<tr>${Array.from({ length: cols }, (_, ci) => {
          const tag = ri === 0 ? 'th' : 'td';
          return `<${tag}>${fieldHtml(`c|${b.id}|${ri}|${ci}`, { mode: 'text', placeholder: ri === 0 ? 'heading' : '' })}</${tag}>`;
        }).join('')}</tr>`).join('')}
      </table>
    </div>
    <div class="rb-table-ops">
      <button type="button" class="ms-btn" tabindex="-1" data-action="table-op" data-op="add-row" data-id="${b.id}">+ Row</button>
      <button type="button" class="ms-btn" tabindex="-1" data-action="table-op" data-op="del-row" data-id="${b.id}">− Row</button>
      <button type="button" class="ms-btn" tabindex="-1" data-action="table-op" data-op="add-col" data-id="${b.id}">+ Column</button>
      <button type="button" class="ms-btn" tabindex="-1" data-action="table-op" data-op="del-col" data-id="${b.id}">− Column</button>
    </div>
  `;
}

function figureHtml(b) {
  const url = figureUrl(b.text);
  let image = '';
  if (url) image = `<img class="rb-figure-img" src="${escapeHtml(url)}" alt="" loading="lazy">`;
  else if (String(b.text || '').trim()) image = '<p class="muted rb-figure-note">Set the GitHub repo on the project page to load repo paths, or paste a full image URL.</p>';
  return `
    ${fieldHtml(`b|${b.id}|text`, { mode: 'plain', placeholder: 'Image: path in the GitHub repo (e.g. _docs/images/orbit.png) or a URL', cls: 'rb-figure-src', rebuild: true })}
    ${image}
    <div class="rb-caption rb-caption-figure"><span class="rb-label mono">Figure ${b.number} –</span>${fieldHtml(`b|${b.id}|caption`, { mode: 'text', placeholder: 'caption' })}</div>
  `;
}

function blockHtml(b) {
  let body = '';
  if (b.kind === 'paragraph') {
    body = fieldHtml(`b|${b.id}|text`, { mode: 'text', multiline: true, placeholder: 'Paragraph. \\ starts an equation, Enter leaves it.' });
  } else if (b.kind === 'bullets') {
    body = fieldHtml(`b|${b.id}|text`, { mode: 'text', multiline: true, as: 'bullets', placeholder: 'One point per line' });
  } else if (b.kind === 'equation') {
    body = `<div class="rb-eq">${fieldHtml(`b|${b.id}|text`, { mode: 'eq', display: true, placeholder: 'Equation, e.g. qdot = 1/2 q ⊗ ;w' })}<span class="rb-eq-num mono">(${b.number})</span></div>`;
  } else if (b.kind === 'table') {
    body = tableHtml(b);
  } else if (b.kind === 'figure') {
    body = figureHtml(b);
  }
  return `<div class="rb rb--${b.kind}"><div class="rb-body">${body}</div><span class="rb-actions">${blockActions(b.id)}</span></div>`;
}

function sectionHtml(sec) {
  return `
    <section class="card report-section">
      <div class="report-section-head">
        ${sec.code ? `<span class="report-section-code mono">(${sec.code})</span>` : ''}
        ${fieldHtml(`b|${sec.id}|text`, { mode: 'text', placeholder: 'Section title', cls: 'report-section-title' })}
        <label class="report-lettered mono muted" title="Lettered sections get (A), (B)… and number their equations (A.1), (A.2)…">
          <input type="checkbox" tabindex="-1" data-lettered="${sec.id}"${R.isLettered(sec) ? ' checked' : ''}> lettered
        </label>
        <span class="rb-actions">${blockActions(sec.id)}</span>
      </div>
      ${sec.blocks.length ? `<div class="report-blocks">${sec.blocks.map(blockHtml).join('')}</div>` : ''}
      <div class="report-add-row">
        ${Object.entries(BLOCK_LABELS).map(([kind, label]) => `<button type="button" class="ms-btn" tabindex="-1" data-action="block-add" data-section="${sec.id}" data-kind="${kind}">+ ${label}</button>`).join('')}
        <button type="button" class="ms-btn report-add-section" tabindex="-1" data-action="section-add" data-after="${sec.id}">+ Section below</button>
      </div>
    </section>
  `;
}

// --- Page ----------------------------------------------------------------

function rebuild() {
  if (!container) return;
  if (active) { pendingRebuild = true; return; }
  pendingRebuild = false;
  clearTimeout(rebuildTimer);
  if (tooltip) tooltip.hidden = true;

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

  refreshSymbols();
  const outline = R.reportOutline(slug);
  container.closest('#app')?.classList.toggle('report-viewing', viewing);
  container.innerHTML = `
    <section class="card report-head" style="border-color:${hexToRgba(project.hex, 0.6)};">
      <h1 class="mono" style="color:${project.hex};">${escapeHtml(project.name)} <span class="report-head-sub">Report</span></h1>
      <span class="report-status mono muted" data-status>Saved</span>
      <button type="button" class="${viewing ? 'active' : ''}" data-action="toggle-view" title="${viewing ? 'Back to editing' : 'Read-only view, without the editing controls'}">${viewing ? 'Edit' : 'View'}</button>
      <a href="#/projects/${encodeURIComponent(slug)}" class="btn btn-back">&larr; Project</a>
    </section>
    <div class="report-toolbar card">${toolbarHtml()}</div>
    ${nomenclatureHtml()}
    ${outline.length ? outline.map(sectionHtml).join('') : `
      <section class="card report-empty">
        <p class="muted">No report yet. Start from the Updates layout (Project Overview, Results, Discussion, Limitations, Further Expansions, References, Appendix), then add your own lettered sections in between.</p>
        <button type="button" class="btn-primary" data-action="start-report">Start report</button>
      </section>
    `}
    <div class="report-foot">
      <button type="button" data-action="section-add">+ Section</button>
    </div>
  `;
}
