import { store } from '../store.js?v=64';
import { escapeHtml } from '../format.js?v=64';

// Fixed order, one box per category — a Projects entry is still a person
// (whoever you'd contact about that project), same shape as every other
// box, no special-casing needed.
const CONTACT_CATEGORIES = ['Professors', 'Projects', 'Advisors/Staff'];

let container = null;

export function render(rootEl) {
  container = rootEl;
  rebuild();
}

export function unmount() {
  container = null;
}

function contactsByCategory() {
  const map = {};
  CONTACT_CATEGORIES.forEach((c) => (map[c] = []));
  store.table('Contacts').forEach((c) => {
    (map[c.category] = map[c.category] || []).push(c);
  });
  Object.values(map).forEach((list) => list.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
  return map;
}

function contactCardHtml(contact) {
  const meta = [contact.building, contact.room].filter(Boolean).join(' · ');
  return `
    <div class="contact-card">
      <div class="timer-card-head">
        <span class="timer-card-title">
          <span class="mono timer-card-name">${escapeHtml(contact.name || 'Untitled')}</span>
          <button class="card-edit-btn" data-action="manage-contact" data-id="${escapeHtml(contact.id)}" title="Manage">&#9998;</button>
        </span>
      </div>
      ${contact.email ? `<a class="muted mono" href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a>` : ''}
      ${meta ? `<span class="muted mono">${escapeHtml(meta)}</span>` : ''}
      ${contact.notes ? `<p class="muted">${escapeHtml(contact.notes)}</p>` : ''}
    </div>
  `;
}

function categoryBoxHtml(category, contacts) {
  return `
    <section class="card">
      <div class="row-between">
        <h2 class="mono">${escapeHtml(category)}</h2>
        <button data-action="add-contact" data-category="${escapeHtml(category)}">+ Add</button>
      </div>
      <div class="timer-grid" style="margin-top:10px;">
        ${contacts.map(contactCardHtml).join('') || '<p class="muted">No one added yet.</p>'}
      </div>
    </section>
  `;
}

function openContactDialog(category, existing) {
  const dialog = container.querySelector('#modal-dialog');

  dialog.innerHTML = `
    <form method="dialog" class="modal-form">
      <h2 class="mono">${existing ? 'Edit contact' : `Add ${escapeHtml(category)} contact`}</h2>
      <label>Name <input type="text" name="name" value="${existing ? escapeHtml(existing.name || '') : ''}" required></label>
      <label>Email <input type="email" name="email" value="${existing ? escapeHtml(existing.email || '') : ''}"></label>
      <div class="field-row">
        <label>Building <input type="text" name="building" value="${existing ? escapeHtml(existing.building || '') : ''}"></label>
        <label>Room <input type="text" name="room" value="${existing ? escapeHtml(existing.room || '') : ''}"></label>
      </div>
      <label>Notes <input type="text" name="notes" value="${existing ? escapeHtml(existing.notes || '') : ''}" placeholder="Office hours, preferred contact method, …"></label>
      <div class="modal-actions">
        ${existing ? '<button type="button" class="btn-danger" data-action="delete">Delete</button>' : ''}
        <button type="button" data-action="cancel">Cancel</button>
        <button type="submit" class="btn-primary">${existing ? 'Save' : 'Add'}</button>
      </div>
    </form>
  `;

  const form = dialog.querySelector('form');
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());

  form.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
    if (!confirm(`Delete "${existing.name || 'this contact'}"?`)) return;
    store.remove('Contacts', existing.id);
    dialog.close();
    rebuild();
  });

  form.addEventListener('submit', () => {
    const data = new FormData(form);
    store.upsert('Contacts', {
      id: existing?.id,
      category: existing?.category || category,
      name: data.get('name'),
      email: data.get('email'),
      building: data.get('building'),
      room: data.get('room'),
      notes: data.get('notes'),
    });
    rebuild();
  });

  dialog.showModal();
}

function rebuild() {
  if (!container) return;
  const byCategory = contactsByCategory();

  container.innerHTML = `
    <section class="card">
      <h1 class="mono">Contacts</h1>
    </section>
    ${CONTACT_CATEGORIES.map((c) => categoryBoxHtml(c, byCategory[c])).join('')}
    <dialog id="modal-dialog"></dialog>
  `;

  container.querySelectorAll('[data-action="add-contact"]').forEach((btn) => {
    btn.addEventListener('click', () => openContactDialog(btn.dataset.category, null));
  });

  container.querySelectorAll('[data-action="manage-contact"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const contact = store.table('Contacts').find((c) => c.id === btn.dataset.id);
      if (contact) openContactDialog(contact.category, contact);
    });
  });
}
