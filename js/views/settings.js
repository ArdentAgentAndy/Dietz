import { store } from '../store.js?v=17';
import { escapeHtml } from '../format.js?v=17';
import { requestSync } from '../sync.js?v=17';

const TABLES = ['Courses', 'Items', 'CourseState', 'Categories', 'Sessions', 'PastTerms', 'Settings'];

let container = null;

export function render(rootEl) {
  container = rootEl;
  rebuild();
}

export function unmount() {
  container = null;
}

function getSetting(key) {
  return store.table('Settings').find((s) => s.key === key)?.value ?? '';
}

// <input type="date"> only accepts an exact YYYY-MM-DD value — a stale row
// written before the backend's literal-text guard existed can still hold a
// full datetime string, which the input would otherwise silently blank out.
function getDateSetting(key) {
  return getSetting(key).slice(0, 10);
}

function setSetting(key, value) {
  store.upsert('Settings', { id: key, key, value });
}

function pastTermRowHtml(term) {
  return `
    <tr>
      <td>${escapeHtml(term.term)}</td>
      <td>${term.credits}</td>
      <td>${term.gpa}</td>
      <td class="item-actions">
        <button data-action="edit-term" data-id="${term.id}">Edit</button>
        <button data-action="delete-term" data-id="${term.id}">Delete</button>
      </td>
    </tr>
  `;
}

function rebuild() {
  const pastTerms = store.table('PastTerms');

  container.innerHTML = `
    <section class="card">
      <h1 class="mono">Settings</h1>
    </section>

    <section class="card">
      <h2 class="mono">Sync (Apps Script)</h2>
      <p class="muted">See apps-script/SETUP.md to deploy the backend. The token never leaves this browser except in requests to your own script.</p>
      <div class="field-row">
        <label>Web app URL
          <input type="text" data-setting="appsScriptUrl" value="${escapeHtml(getSetting('appsScriptUrl'))}" placeholder="https://script.google.com/...">
        </label>
        <label>Token
          <input type="password" data-setting="appsScriptToken" value="${escapeHtml(getSetting('appsScriptToken'))}" autocomplete="off">
        </label>
      </div>
      <button data-action="force-sync" style="margin-top:12px;">Force sync</button>
    </section>

    <section class="card">
      <h2 class="mono">Semester</h2>
      <p class="muted">Used for the "Semester" range on the hours graph.</p>
      <div class="field-row">
        <label>Start date <input type="date" data-setting="semesterStart" value="${getDateSetting('semesterStart')}"></label>
        <label>End date <input type="date" data-setting="semesterEnd" value="${getDateSetting('semesterEnd')}"></label>
      </div>
    </section>

    <section class="card">
      <div class="row-between">
        <h2 class="mono">Past terms</h2>
        <button data-action="add-term">+ Add term</button>
      </div>
      <p class="muted">Pre-app history, folded into cumulative GPA (CLAUDE.md §6).</p>
      ${
        pastTerms.length
          ? `<table class="item-table">
              <thead><tr><th>Term</th><th>Credits</th><th>GPA</th><th></th></tr></thead>
              <tbody>${pastTerms.map(pastTermRowHtml).join('')}</tbody>
            </table>`
          : '<p class="muted">No past terms recorded.</p>'
      }
    </section>

    <section class="card">
      <h2 class="mono">Backup</h2>
      <button data-action="export">Export JSON backup</button>
    </section>

    <dialog id="modal-dialog"></dialog>
  `;

  attachEvents();
}

function attachEvents() {
  container.querySelectorAll('[data-setting]').forEach((input) => {
    input.addEventListener('change', () => setSetting(input.dataset.setting, input.value));
  });

  container.querySelector('[data-action="force-sync"]')?.addEventListener('click', requestSync);

  container.querySelector('[data-action="add-term"]')?.addEventListener('click', () => openTermDialog());

  container.querySelectorAll('[data-action="edit-term"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const term = store.table('PastTerms').find((t) => t.id === btn.dataset.id);
      if (term) openTermDialog(term);
    });
  });

  container.querySelectorAll('[data-action="delete-term"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (confirm('Delete this past term?')) {
        store.remove('PastTerms', btn.dataset.id);
        rebuild();
      }
    });
  });

  container.querySelector('[data-action="export"]')?.addEventListener('click', exportBackup);
}

function openTermDialog(existing = null) {
  const dialog = container.querySelector('#modal-dialog');

  dialog.innerHTML = `
    <form method="dialog" class="modal-form">
      <h2 class="mono">${existing ? 'Edit term' : 'Add past term'}</h2>
      <label>Term <input type="text" name="term" placeholder="Spring 2026" value="${existing ? escapeHtml(existing.term) : ''}" required></label>
      <div class="field-row">
        <label>Credits <input type="number" name="credits" step="any" min="0" value="${existing?.credits ?? ''}" required></label>
        <label>GPA <input type="number" name="gpa" step="any" min="0" max="4" value="${existing?.gpa ?? ''}" required></label>
      </div>
      <div class="modal-actions">
        <button type="button" data-action="cancel">Cancel</button>
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>
  `;

  const form = dialog.querySelector('form');
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', () => {
    const data = new FormData(form);
    store.upsert('PastTerms', {
      id: existing?.id,
      term: data.get('term'),
      credits: Number(data.get('credits')),
      gpa: Number(data.get('gpa')),
    });
    rebuild();
  });

  dialog.showModal();
}

function exportBackup() {
  const backup = {};
  for (const table of TABLES) backup[table] = store.table(table);

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dietz-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
