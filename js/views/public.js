// The page a stranger sees — someone who has never entered (and never
// will enter) the Apps Script URL/token in Settings. See js/publicApi.js
// for the separate, unauthenticated data fetch this uses instead of
// notion.js's token-gated one, and js/router.js for the redirect that lands
// an unconfigured device here. Everything shown is already redacted
// server-side (apps-script/Code.gs's publicPayload_) — no task names,
// courses, locations, or instructors, just category-derived generic labels,
// their Notion color, and timing.
import { fetchPublicData, getCachedPublicData, sendPublicPing } from '../publicApi.js?v=65';
import { escapeHtml, hexToRgba } from '../format.js?v=65';
import { hexForNotionColor } from '../notionColors.js?v=65';

const CHICAGO_TZ = 'America/Chicago';
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PUBLIC_ITEM_LABELS = {
  Examination: 'exam',
  Date: 'busy',
  Meeting: 'meeting',
};

let container = null;
// Local by default — the viewer's own clock, not the owner's — switched to
// Chicago only when they explicitly ask for it (see headerHtml's toggle
// button).
let useLocalTz = true;
let state = { busy: [], items: [], classes: [], error: null, loading: true };
let clockInterval = null;

export function render(rootEl) {
  container = rootEl;
  // Cache-first, same reasoning/pattern as every other Notion-backed page
  // (see js/views/today.js) — renders the last-fetched data instantly on a
  // reload instead of flashing "Loading…" every time, then load() below
  // refreshes it in the background.
  const cached = getCachedPublicData();
  if (cached) {
    state = { ...cached, loading: false };
  }
  rebuild();
  load();
  // Keeps the clock box and busy/free color live without a manual refresh —
  // tick() mirrors load()'s own guard so it never yanks an open ping dialog
  // out from under someone mid-type.
  clockInterval = setInterval(tick, 30000);
}

export function unmount() {
  clearInterval(clockInterval);
  clockInterval = null;
  container = null;
}

function tick() {
  if (!container || container.querySelector('#modal-dialog')?.open) return;
  rebuild();
}

async function load() {
  const data = await fetchPublicData();
  if (!container) return;
  // A failed refresh shouldn't blank out data that's already on screen —
  // keep showing what was cached/already rendered instead.
  if (data.error && getCachedPublicData()) return;
  state = { ...data, loading: false };
  // rebuild() replaces the whole container, including #modal-dialog — if
  // this background refresh resolves while the ping dialog is open, that
  // would silently yank it (and whatever the user was mid-typing) out from
  // under them. state is still updated either way; openPingDialog's own
  // 'close' listener rebuilds once the dialog is actually done with.
  if (container.querySelector('#modal-dialog')?.open) return;
  rebuild();
}

// yyyy-MM-dd in America/Chicago, independent of the display timezone
// toggle below — this is the same calendar-day convention the server
// grouped busy/items by (publicWeekDays_ in Code.gs), so a day column here
// always matches what the server put in it.
function chicagoDay(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: CHICAGO_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Two full Sunday-Saturday weeks (Chicago-anchored) — the one containing
// today, then the next one — matching Code.gs's publicWeekDays_. Not a
// fixed "next 14 days": rows always start Sunday and end Saturday, rolling
// over to the next pair of weeks on their own once the first week's
// Saturday has passed, since this is recomputed fresh from today on every
// render rather than stored. Noon UTC keeps each day comfortably clear of
// a DST boundary shifting it to the wrong calendar day.
function buildWeekDays() {
  const anchor = new Date(`${chicagoDay(new Date())}T12:00:00Z`);
  const dow = anchor.getUTCDay(); // 0=Sun..6=Sat
  const sunday = new Date(anchor);
  sunday.setUTCDate(sunday.getUTCDate() - dow);
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(sunday);
    d.setUTCDate(d.getUTCDate() + i);
    return chicagoDay(d);
  });
}

// Weekday name is purely a function of the (Chicago-anchored) calendar day
// itself, not the display timezone toggle — which day of the week a column
// is doesn't change just because times within it are being shown in a
// different clock.
function weekdayName(dayStr) {
  const d = new Date(`${dayStr}T12:00:00Z`);
  return WEEKDAY_NAMES[d.getUTCDay()];
}

function dateLabel(dayStr) {
  const [, m, d] = dayStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// Chicago time by default (matches the server's own timezone), switched to
// the viewer's local time by the toggle button — a pure re-render, no
// refetch, since the server already sent real ISO instants either way.
function formatTime(date) {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: useLocalTz ? undefined : CHICAGO_TZ,
  });
}

// "Busy" = this instant falls inside any scheduled item or class's
// [start, start+duration] window — a zero-duration entry (no `duration`)
// only matches at the exact start minute, which is fine/expected.
function isBlockingNow(entry, now) {
  if (!entry.start) return false;
  const t = now.getTime();
  const start = new Date(entry.start).getTime();
  const end = start + (entry.duration ? entry.duration * 60000 : 0);
  return t >= start && t <= end;
}

function isBusyNow(now) {
  return [...state.items, ...state.classes].some((e) => isBlockingNow(e, now));
}

// Same bright red as the clock box's own is-busy border — appended after
// cardStyle's border-color so it wins the cascade within this one inline
// style attribute, without needing a separate stylesheet rule/class.
function blockingStyle(entry) {
  return isBlockingNow(entry, new Date()) ? 'border-color:var(--red); border-width:2px;' : '';
}

// Replaces the old plain "Public" title — the date, the viewer's own
// current time, and Chicago time (the owner's), red/green per isBusyNow so
// a visitor can tell at a glance whether now's a good time to reach out.
function clockBoxHtml() {
  const now = new Date();
  const today = chicagoDay(now);
  const fmt = (tz) => now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  const busy = isBusyNow(now);
  return `
    <div class="public-clock-box ${busy ? 'is-busy' : 'is-free'}">
      <span class="public-clock-segment mono">${weekdayName(today)} ${dateLabel(today)}</span>
      <span class="public-clock-segment mono"><span class="muted">Local</span> ${fmt(undefined)}</span>
      <span class="public-clock-segment mono"><span class="muted">Chicago</span> ${fmt(CHICAGO_TZ)}</span>
    </div>
  `;
}

function headerHtml() {
  return `
    <div class="row-between" style="margin-bottom: 8px;">
      ${clockBoxHtml()}
      <div style="display: flex; gap: 8px;">
        <button type="button" class="btn${useLocalTz ? '' : ' active'}" data-action="toggle-tz">${useLocalTz ? 'Display Chicago time' : 'Displaying Chicago time'}</button>
        <button type="button" class="btn" data-action="send-ping">Ping</button>
      </div>
    </div>
    <dialog id="modal-dialog"></dialog>
  `;
}

// Today's own Chicago-anchored day, for comparing against a column's day —
// not the display timezone toggle, which column is "today" doesn't change
// just because times within it are being shown in a different clock.
function isPastDay(dayStr) {
  return dayStr < chicagoDay(new Date());
}

// Same thresholds/classes as Home's own day-total badge (see
// js/views/home.js's dayLevelClass and .home-day-total/.level-* in
// styles.css) — re-derived rather than imported since it's a tiny pure
// function and home.js closes over nothing this needs. Unlike Home's
// version (logged hours, backward-looking), this totals *scheduled*
// duration for the day ahead, across every category — see Code.gs's
// publicBusyTotals_ for why that's safe to expose as a bare number with no
// breakdown.
function busyLevelClass(minutes) {
  const hours = minutes / 60;
  if (hours === 0) return '';
  if (hours < 5) return 'level-yellow';
  if (hours <= 10) return 'level-orange';
  return 'level-red';
}

function groupByDay(entries) {
  const map = {};
  entries.forEach((e) => {
    if (!e.start) return;
    const day = chicagoDay(new Date(e.start));
    (map[day] = map[day] || []).push(e);
  });
  // Chronological within each day — used for both the lessons row
  // (classesSectionHtml) and the items grid (dayCardHtml), neither of which
  // otherwise re-sorts what arrives from the server in whatever order it
  // was returned.
  Object.values(map).forEach((list) => list.sort((a, b) => new Date(a.start) - new Date(b.start)));
  return map;
}

function cardStyle(categoryColor) {
  const color = hexForNotionColor(categoryColor);
  return `border-color:${hexToRgba(color, 0.6)}; background:${hexToRgba(color, 0.18)};`;
}

function itemCardHtml(item) {
  const start = item.start ? new Date(item.start) : null;
  const end = start && item.duration ? new Date(start.getTime() + item.duration * 60000) : null;
  const range = start ? `${formatTime(start)}${end ? `–${formatTime(end)}` : ''}` : '';
  return `
    <div class="public-item-card" style="${cardStyle(item.categoryColor)}${blockingStyle(item)}">
      <span class="mono">${escapeHtml(PUBLIC_ITEM_LABELS[item.category] || '')}</span>
      <span class="muted mono public-item-card-meta">${escapeHtml(range)}</span>
    </div>
  `;
}

// Deliberately just "Lesson" + time + duration — never the actual class
// name, building, room, or professor (see Code.gs's publicClasses_, which
// never sends those fields in the first place).
function classCardHtml(cls) {
  const start = cls.start ? new Date(cls.start) : null;
  const time = start ? formatTime(start) : '';
  const meta = [time, cls.duration ? `${cls.duration}m` : ''].filter(Boolean).join(' · ');
  return `
    <div class="public-item-card" style="${cardStyle(cls.categoryColor)}${blockingStyle(cls)}">
      <span class="mono">Lesson</span>
      <span class="muted mono public-item-card-meta">${escapeHtml(meta)}</span>
    </div>
  `;
}

// Up to 3 item cards — the server already caps at 3 (keeping the earliest),
// this slice is just belt-and-suspenders against a mismatched payload
// rather than something expected to ever actually trim anything. A day
// that's already passed (see isPastDay) gets the same gray/striped
// "done" treatment used elsewhere for a completed task (.is-past below),
// applied to the whole column rather than per-card since there's nothing
// left to distinguish within an already-over day.
function isToday(day) {
  return day === chicagoDay(new Date());
}

function dayCardHtml(day, busyByDay, itemsByDay) {
  const minutes = busyByDay[day] || 0;
  const cards = (itemsByDay[day] || []).slice(0, 3).map(itemCardHtml).join('') || '<p class="muted cal-empty">—</p>';

  return `
    <div class="cal-day-col public-day-col${isPastDay(day) ? ' is-past' : ''}${isToday(day) ? ' is-today' : ''}">
      <div class="home-day-total ${busyLevelClass(minutes)}"><span class="mono">${minutes > 0 ? `${(minutes / 60).toFixed(1)}h` : '—'}</span></div>
      <div class="cal-day-head mono"><span>${weekdayName(day)} <span class="muted">${dateLabel(day)}</span></span></div>
      <div class="cal-day-items public-day-items">${cards}</div>
    </div>
  `;
}

// One 7x2 grid (14 days = two Sun-Sat weeks, see buildWeekDays) — a CSS
// grid of 7 columns auto-wraps 14 children into exactly 2 rows, so each
// weekday's column lines up directly under the one from the week before/
// after it, same way a calendar month view repeats its weekday header.
function gridSectionHtml(days) {
  const busyByDay = Object.fromEntries(state.busy.map((b) => [b.date, b.minutes]));
  const itemsByDay = groupByDay(state.items);

  const cells = days.map((day) => dayCardHtml(day, busyByDay, itemsByDay)).join('');

  return `
    <section class="card">
      <div class="public-grid">${cells}</div>
    </section>
  `;
}

// A second, single Sun-Sat row (just this week — classes repeat weekly, so
// a second identical week would show nothing new) dedicated to classes,
// separate from the items grid above. Same .cal-day-col/.public-day-col
// sizing as the grid above (via the shared .public-grid rules), just one
// row of 7 instead of two.
function classesSectionHtml(weekDays) {
  const classesByDay = groupByDay(state.classes);
  const cells = weekDays.map((day) => {
    const cards = (classesByDay[day] || []).map(classCardHtml).join('') || '<p class="muted cal-empty">—</p>';
    return `
      <div class="cal-day-col public-day-col${isPastDay(day) ? ' is-past' : ''}${isToday(day) ? ' is-today' : ''}">
        <div class="cal-day-head mono"><span>${weekdayName(day)} <span class="muted">${dateLabel(day)}</span></span></div>
        <div class="cal-day-items public-day-items">${cards}</div>
      </div>
    `;
  }).join('');

  return `
    <section class="card">
      <div class="public-grid">${cells}</div>
    </section>
  `;
}

function attachEvents() {
  container.querySelector('[data-action="toggle-tz"]')?.addEventListener('click', () => {
    useLocalTz = !useLocalTz;
    rebuild();
  });
  container.querySelector('[data-action="send-ping"]')?.addEventListener('click', openPingDialog);
}

// For friends/family to reach the owner through DND — see
// js/publicApi.js's sendPublicPing. The password lives only server-side (a
// Sheet cell, see Code.gs's getPingPassword_), never sent to this page, so
// there's no way to pre-validate it locally — every submit is a real
// round-trip. The native method="dialog" auto-close is suppressed
// (preventDefault) so a wrong password can show an inline error and leave
// the dialog open instead of closing either way.
function openPingDialog() {
  const dialog = container.querySelector('#modal-dialog');

  // Three swappable screens inside the one dialog element (same convention
  // js/views/logging.js's openManageCategoryDialog uses) rather than a
  // second native <dialog> — renderForm (the password prompt, optionally
  // pre-filled/showing an error after a failed send) -> renderBusyWarning
  // (only when isBusyNow, see below) -> doSend (Sending… / Ping sent.).
  function renderForm(prefillPassword, error) {
    dialog.innerHTML = `
      <form method="dialog" class="modal-form">
        <h2 class="mono">Ping</h2>
        <label>Password <input type="password" name="password" value="${escapeHtml(prefillPassword || '')}" required autocomplete="off"></label>
        <p class="muted" data-ping-error style="color: var(--red); display: ${error ? '' : 'none'};">${escapeHtml(error || '')}</p>
        <div class="modal-actions">
          <button type="button" data-action="cancel">Cancel</button>
          <button type="submit" class="btn-primary">Send</button>
        </div>
      </form>
    `;
    const form = dialog.querySelector('form');
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const password = new FormData(form).get('password');
      if (isBusyNow(new Date())) {
        renderBusyWarning(password);
        return;
      }
      doSend(password);
    });
  }

  // Shown instead of sending immediately when isBusyNow — an explicit
  // extra confirm step, not a blocker: "Send anyway" still goes through.
  function renderBusyWarning(password) {
    dialog.innerHTML = `
      <div class="modal-form">
        <h2 class="mono">Ping</h2>
        <p>The individual is currently busy. Are you sure?</p>
        <div class="modal-actions">
          <button type="button" data-action="back">Go back</button>
          <button type="button" class="btn-primary" data-action="confirm-busy">Send anyway</button>
        </div>
      </div>
    `;
    dialog.querySelector('[data-action="back"]').addEventListener('click', () => renderForm(password));
    dialog.querySelector('[data-action="confirm-busy"]').addEventListener('click', () => doSend(password));
  }

  async function doSend(password) {
    dialog.innerHTML = `
      <div class="modal-form">
        <h2 class="mono">Ping</h2>
        <p class="muted">Sending…</p>
      </div>
    `;

    const result = await sendPublicPing(password);
    if (result.ok) {
      // Swap for a plain confirmation instead of just silently closing —
      // the request already took a while (five sends, 2s apart, server-side
      // — see Code.gs's doPost 'ping' branch), so the person sending it
      // should see it actually went through. Auto-closes shortly after; the
      // dialog's own 'close' listener (below) still fires either way.
      dialog.innerHTML = `
        <div class="modal-form">
          <h2 class="mono">Ping</h2>
          <p>Ping sent.</p>
        </div>
      `;
      setTimeout(() => dialog.close(), 1500);
      return;
    }
    renderForm(password, result.error || 'Failed');
  }

  renderForm();

  // Catches up on anything load()'s background refresh (or the clock tick)
  // held back while this was open — fires on every close path alike
  // (Cancel, a successful send auto-closing, or Escape).
  dialog.addEventListener('close', () => rebuild(), { once: true });

  dialog.showModal();
}

function rebuild() {
  if (!container) return;

  if (state.loading) {
    container.innerHTML = `${headerHtml()}<p class="muted">Loading…</p>`;
    attachEvents();
    return;
  }

  if (state.error) {
    container.innerHTML = `${headerHtml()}<p class="muted">Couldn't load: ${escapeHtml(state.error)}</p>`;
    attachEvents();
    return;
  }

  const days = buildWeekDays();
  container.innerHTML = `
    ${headerHtml()}
    ${gridSectionHtml(days)}
    ${classesSectionHtml(days.slice(0, 7))}
  `;
  attachEvents();
}
