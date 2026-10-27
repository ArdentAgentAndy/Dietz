import { store } from '../store.js?v=65';
import { escapeHtml, hexToRgba } from '../format.js?v=65';
import { COURSES, CATEGORIES, FREE_NOTES, PROGRAM_LABELS, PROGRAM_TOTAL_HOURS } from '../roadmapCourses.js?v=65';

const SEMESTERS = [
  { id: 'Y1F', label: 'Y1 Fall' }, { id: 'Y1S', label: 'Y1 Spring' },
  { id: 'Y2F', label: 'Y2 Fall' }, { id: 'Y2S', label: 'Y2 Spring' },
  { id: 'Y3F', label: 'Y3 Fall' }, { id: 'Y3S', label: 'Y3 Spring' },
  { id: 'Y4F', label: 'Y4 Fall' }, { id: 'Y4S', label: 'Y4 Spring' },
];
// Two extra full-width rows below the 8 regular columns — Summer/Winter
// (off-cycle terms with no column of their own) and Transfer Credit
// (anything, catalog or custom-added, satisfied before enrolling here).
// Both are just another semester value a card can be dragged to/from,
// same [data-semester] drop-zone mechanism as the 8 columns — they just
// render as a single open-ended row instead of a column.
const EXTRA_ROWS = [
  { id: 'SW', label: 'Summer/Winter' },
  { id: 'TRANSFER', label: 'Transfer Credit' },
];
const PROGRAM_ORDER = ['AE', 'ECE', 'MATH', 'CS'];

let container = null;
let view = 'semesters'; // 'semesters' | 'track' | 'possible'
let markMode = null; // null | 'completed' | 'taking'
let activeSubjects = new Set();
let searchQuery = '';
let draggingId = null;
// Set right after creating a new course via the "Add to Track" flow (see
// openAddDialog's placementMode) — while non-null, Track view is in
// "click a box to place [course]" mode (see attachEvents' data-category-drop
// click handler) instead of its normal toggle-status click behavior.
let pendingPlacementId = null;

export function render(rootEl) {
  container = rootEl;
  container.closest('#app')?.classList.add('app-wide');
  rebuild();
}

export function unmount() {
  container?.closest('#app')?.classList.remove('app-wide');
  container = null;
}

// Catalog courses (js/roadmapCourses.js) are fixed reference data — only
// their per-user status/semester lives in the synced RoadmapStatus table,
// keyed by the catalog id. A manually-added (Gen Ed) course is
// self-contained in RoadmapCustom instead, carrying its own name/credits.
// Both normalize to the same shape here so the rest of this file (sorting,
// filtering, card rendering, marking) doesn't need to know which is which
// except where `custom` matters (which table to write back to).
function catalogEntries() {
  const byId = new Map(store.table('RoadmapStatus').map((r) => [r.id, r]));
  return COURSES.map((c) => {
    const row = byId.get(c.id);
    // lockedCategory: "program:category" — which ONE of this course's
    // electivePool-flagged tags (if it has more than one) it currently
    // counts toward; see matchesLock below. Irrelevant (never read) for a
    // course with 0-1 electivePool tags, since those always count
    // everywhere they're tagged.
    return { ...c, status: row?.status || '', semester: row?.semester || '', lockedCategory: row?.lockedCategory || '', custom: false };
  });
}

function customEntries() {
  return store.table('RoadmapCustom').map((r) => ({
    id: r.id,
    subject: r.subject,
    number: Number(r.number),
    name: r.name,
    credits: Number(r.credits) || 0,
    programs: [],
    // A custom (Gen Ed/elective/etc.) addition's main Track placement —
    // set by the "Add to Track" flow or by dragging the card onto a
    // (non-Gen-Ed) category box (see placeInCategory). Blank until placed;
    // shows only in Semesters/Unassigned until then.
    program: r.program || '',
    category: r.category || '',
    // A SEPARATE, second placement specifically for a Gen Ed category (see
    // that CATEGORIES genEd:true note in roadmapCourses.js) — independent
    // of the main program/category above, so a course can hold both at
    // once: its real technical slot AND a Gen Ed one, explicit
    // double-dipping. placeInCategory decides which pair to write to based
    // on whether the target category is genEd-flagged.
    genEdProgram: r.genEdProgram || '',
    genEdCategory: r.genEdCategory || '',
    status: r.status || '',
    semester: r.semester || '',
    custom: true,
  }));
}

function allEntries() {
  return [...catalogEntries(), ...customEntries()];
}

function sortEntries(list) {
  return [...list].sort((a, b) => (a.subject === b.subject ? a.number - b.number : a.subject.localeCompare(b.subject)));
}

function allSubjects() {
  return [...new Set(allEntries().map((e) => e.subject))].sort();
}

// Matches subject+number (e.g. "ae311" or "AE 311") or the course name.
function matchesSearch(entry) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  const code = `${entry.subject}${entry.number}`.toLowerCase();
  const codeSpaced = `${entry.subject} ${entry.number}`.toLowerCase();
  return code.includes(q) || codeSpaced.includes(q) || entry.name.toLowerCase().includes(q);
}

// Diagonal-stripe overlay for a marked card — same inline
// repeating-linear-gradient technique as the gray "done" stripe on
// Calendar/Canvas chips (see taskChipHtml/eventChipHtml there), just a
// tighter period to match this card's much smaller size, and a purple
// sibling (reusing the purple already used elsewhere in this app, e.g.
// canvas.js's UNLINK_COLOR) for "taking".
function stripeStyle(status) {
  if (status === 'completed') {
    return `background-image: repeating-linear-gradient(45deg, ${hexToRgba('#9b9a97', 0.18)} 0 6px, transparent 6px 12px);`;
  }
  if (status === 'taking') {
    return `background-image: repeating-linear-gradient(45deg, ${hexToRgba('#9b59b6', 0.2)} 0 6px, transparent 6px 12px);`;
  }
  return '';
}

// Chronological index into SEMESTERS (not EXTRA_ROWS, which have no defined
// order relative to it) — null for an unassigned semester or either of the
// two EXTRA_ROWS ids, since neither can be compared "before/after".
function semesterIndex(semId) {
  const i = SEMESTERS.findIndex((s) => s.id === semId);
  return i === -1 ? null : i;
}

// Unmet prereqs for `entry` — a listed prereq is satisfied if it's marked
// completed, OR both courses have a semester inside SEMESTERS and the
// prereq's index is strictly before entry's own (planned out ahead of time,
// even if not actually done yet). Custom (Gen Ed) rows have no catalog
// identity to carry prereqs and never reference one, so they're always
// clear. Returns the unmet prereqs' own entries (for name/code display),
// not just their ids.
function prereqStatus(entry, full) {
  if (entry.custom || !entry.prereqs?.length) return [];
  const myIdx = semesterIndex(entry.semester);
  return entry.prereqs
    .map((id) => full.find((e) => e.id === id))
    .filter((p) => p && p.status !== 'completed'
      && !(myIdx != null && semesterIndex(p.semester) != null && semesterIndex(p.semester) < myIdx));
}

// A 300+ course tagged to more than one program is, by Grainger policy,
// never "distinct" enough to count toward a minor's own requirements (it
// may still count fully toward AE — see isExcludedForProgram). Reused by
// both the real category/credit math below and the card's own "shared"
// badge, so the two always agree on the same courses.
function isDoubleCounted(entry) {
  return entry.number >= 300 && entry.programs.length > 1;
}

// The restriction only ever applies to a minor's own totals, never AE's —
// the rule is "the minor needs hours distinct from the major (and other
// minors)", not the other way around, so AE always counts a tagged
// completed course in full regardless of how many other programs share it.
function isExcludedForProgram(entry, program) {
  return program !== 'AE' && isDoubleCounted(entry);
}

// electivePool-flagged categories (see CATEGORIES in roadmapCourses.js) are
// genuine elective CHOICE slots — a course tagged to 2+ of them (counting
// across every program it's tagged to, AE's own two Tech-Electives
// categories included) can only ever count toward ONE at a time, and has
// to be explicitly locked there (dragging its card onto a Track category
// box — see placeInCategory) before Track shows or counts it in ANY of
// them. This is separate from (and supersedes, for Track's own counting/
// display) isExcludedForProgram above, which only ever protected a minor
// from AE's "free" courses, not elective-vs-elective contention — see the
// CATEGORIES comment for the full reasoning (why MATH241/Calc III, a
// REQUIRED course in two places, is exempt but MATH461, an ELECTIVE choice
// in two/three places, is not).
function isElectivePoolCategory(program, category) {
  return CATEGORIES.some((c) => c.program === program && c.category === category && c.electivePool);
}

// Gen Ed boxes (roadmapCourses.js's CATEGORIES genEd:true) get their own
// separate placement slot on a custom entry (genEdProgram/genEdCategory,
// alongside its main program/category) instead of overwriting it — see
// placeInCategory — which is what actually lets a course double-dip into
// Gen Ed while still holding a real technical placement too.
function isGenEdCategory(program, category) {
  return CATEGORIES.some((c) => c.program === program && c.category === category && c.genEd);
}

function electivePoolTagCount(entry) {
  return entry.programs.filter((p) => isElectivePoolCategory(p.program, p.category)).length;
}

// true = this entry counts/displays for (program, category); a custom
// entry already matched exactly by its own program/category (see
// customEntries), so it's always true once "tagged" already included it.
function matchesLock(entry, program, category) {
  if (entry.custom) return true;
  if (electivePoolTagCount(entry) <= 1) return true;
  return entry.lockedCategory === `${program}:${category}`;
}

// `ctx.program`, when given, is whichever program's box this card is being
// rendered inside (Track's fixed boxes, Possible's per-program list) — used
// only to decide whether THIS course counts toward THIS program's totals
// (see isExcludedForProgram) and to show the "shared" badge accordingly.
// Omitted in Semesters view/Unassigned, where a card isn't inside any single
// category's context (it might exclude differently per program it's tagged
// to), so it renders plain there rather than showing a potentially
// misleading badge.
function cardHtml(entry, full, ctx = {}) {
  const numStr = String(entry.number);
  const level = numStr.slice(0, 1);
  const rest = numStr.slice(1);
  const programs = [...new Set(entry.programs.map((p) => p.program))];
  const unmetPrereqs = prereqStatus(entry, full);
  const excluded = ctx.program ? isExcludedForProgram(entry, ctx.program) : false;

  const excludedBadge = excluded
    ? `<span class="rm-badge rm-badge-excluded" title="Shared with AE/another program — doesn't count toward ${escapeHtml(ctx.program)}'s totals (300+ level, 2+ programs)">shared</span>`
    : '';
  const prereqWarnHtml = unmetPrereqs.length
    ? `<span class="rm-prereq-warn" title="Needs first: ${escapeHtml(unmetPrereqs.map((p) => `${p.subject}${p.number}`).join(', '))}">!</span>`
    : '';

  return `
    <div class="rm-card${entry.status ? ` is-${entry.status}` : ''}${excluded ? ' is-excluded' : ''}" style="${stripeStyle(entry.status)}" draggable="true" data-id="${escapeHtml(entry.id)}" title="${escapeHtml(entry.name)}">
      <div class="rm-card-top">
        <span class="rm-subject">${escapeHtml(entry.subject)}</span><span class="rm-level">${escapeHtml(level)}</span><span class="rm-num">${escapeHtml(rest)}</span>
        <span class="rm-credits mono">${entry.credits}cr</span>
        ${prereqWarnHtml}
      </div>
      <div class="rm-card-name">${escapeHtml(entry.name)}</div>
      ${programs.length || excludedBadge ? `<div class="rm-badges">${programs.map((p) => `<span class="rm-badge">${escapeHtml(p)}</span>`).join('')}${excludedBadge}</div>` : ''}
    </div>
  `;
}

function toggleStatus(entry) {
  if (!entry || !markMode) return;
  const next = entry.status === markMode ? '' : markMode;
  if (entry.custom) store.upsert('RoadmapCustom', { id: entry.id, status: next });
  else store.upsert('RoadmapStatus', { id: entry.id, status: next });
  rebuild();
}

function assignSemester(id, semester) {
  const entry = allEntries().find((e) => e.id === id);
  if (!entry) return;
  if (entry.custom) store.upsert('RoadmapCustom', { id, semester });
  else store.upsert('RoadmapStatus', { id, semester });
  rebuild();
}

// A custom entry can go in any Track box (it has no fixed tags of its own
// yet — this IS how it gets one). A catalog entry can only go where it's
// actually tagged — dropping it anywhere else is a no-op, same as dropping
// a card on a semester column it makes no sense in isn't blocked elsewhere
// in this file either; this one small guard just prevents silently
// fabricating a tag/lock pair the course was never eligible for.
function canPlaceInCategory(entry, program, category) {
  if (entry.custom) return true;
  return entry.programs.some((p) => p.program === program && p.category === category);
}

// The single "move this course's Track placement" action — shared by
// dragging a card onto a category box and by the Add-to-Track pending-
// placement click (see attachEvents). For a custom entry this IS its one
// Track placement (program/category, independent of its semester). For a
// catalog entry already tagged to this exact category, it just records
// which one of its (possibly several) electivePool tags it's locked to —
// see matchesLock in categoryFulfillment/categoryBoxHtml.
function placeInCategory(id, program, category) {
  const entry = allEntries().find((e) => e.id === id);
  if (!entry || !canPlaceInCategory(entry, program, category)) return;
  if (entry.custom) {
    // A Gen Ed target writes to its own separate slot, leaving the main
    // program/category (if any) untouched — that's the whole mechanism
    // behind Gen Ed's explicit double-dipping (see isGenEdCategory).
    // Anything else is this entry's one main placement, same as before.
    if (isGenEdCategory(program, category)) store.upsert('RoadmapCustom', { id, genEdProgram: program, genEdCategory: category });
    else store.upsert('RoadmapCustom', { id, program, category });
  } else {
    store.upsert('RoadmapStatus', { id, lockedCategory: `${program}:${category}` });
  }
  pendingPlacementId = null;
  rebuild();
}

function semestersViewHtml(entries, full, filterBar) {
  const bySemester = {};
  SEMESTERS.forEach((s) => (bySemester[s.id] = []));
  EXTRA_ROWS.forEach((s) => (bySemester[s.id] = []));
  const unassigned = [];
  entries.forEach((e) => {
    if (e.semester && bySemester[e.semester]) bySemester[e.semester].push(e);
    else unassigned.push(e);
  });

  const columns = SEMESTERS.map((s) => {
    const list = sortEntries(bySemester[s.id]);
    const credits = list.reduce((sum, e) => sum + (e.credits || 0), 0);
    // Red border once a semester's actually been planned out (credits > 0 —
    // an untouched future semester sitting at 0 isn't "underloaded", it's
    // just not filled in yet) and its total falls outside the normal
    // full-time course-load range: over 18 (needs advisor sign-off at most
    // schools) or under 12 (below full-time status).
    const isOffLoad = credits > 18 || (credits > 0 && credits < 12);
    return `
      <div class="rm-semester-col${isOffLoad ? ' is-off-load' : ''}" data-semester="${s.id}">
        <div class="rm-semester-head"><span class="mono">${s.label}</span><span class="muted mono">${credits}cr</span></div>
        <div class="rm-card-grid">${list.map((e) => cardHtml(e, full)).join('')}</div>
      </div>
    `;
  }).join('');

  const extraRows = EXTRA_ROWS.map((s) => {
    const list = sortEntries(bySemester[s.id]);
    const credits = list.reduce((sum, e) => sum + (e.credits || 0), 0);
    return `
      <div class="rm-semester-fullrow" data-semester="${s.id}">
        <div class="rm-semester-head"><span class="mono">${s.label}</span><span class="muted mono">${credits}cr</span></div>
        <div class="rm-card-grid">${list.map((e) => cardHtml(e, full)).join('')}</div>
      </div>
    `;
  }).join('');

  return `
    <section class="card">
      <div class="rm-semesters-grid">${columns}</div>
      ${extraRows}
    </section>
    ${filterBar}
    <section class="card rm-pool" data-semester="">
      <h2 class="mono">Unassigned</h2>
      <div class="rm-card-grid">${sortEntries(unassigned).map((e) => cardHtml(e, full)).join('')}</div>
    </section>
  `;
}

// `full` (every entry, ignoring the subject filter) drives the fulfillment
// math — a category's green/not-green state must never change just
// because the subject filter happens to be hiding some of its courses.
function categoryFulfillment(program, category, full) {
  const def = CATEGORIES.find((c) => c.program === program && c.category === category);
  const tagged = full.filter((e) =>
    e.programs.some((p) => p.program === program && p.category === category) ||
    (e.custom && e.program === program && e.category === category) ||
    (e.custom && e.genEdProgram === program && e.genEdCategory === category));
  // tagged stays everything tagged to this category (Possible view wants
  // every real option, including ones excluded from counting here) —
  // `completed` is what actually satisfies it: an electivePool category
  // only counts a course that's either unambiguous (0-1 electivePool tags
  // total across every program it's tagged to) or explicitly locked to
  // THIS exact (program, category) — see matchesLock. A non-electivePool
  // (core/required) category never excludes anything — isExcludedForProgram
  // is no longer consulted here, only by cardHtml's informational "shared"
  // badge on Possible view.
  const completed = tagged.filter((e) => e.status === 'completed' && matchesLock(e, program, category));

  if (def.requiredCredits != null) {
    const completedCredits = completed.reduce((sum, e) => sum + (e.credits || 0), 0);
    return {
      tagged,
      def,
      met: completedCredits >= def.requiredCredits,
      // Clamped so a slot that's been over-filled (e.g. two electives whose
      // credits add up past what's needed) still reads as "met", not as a
      // confusing numerator past the denominator.
      progressText: `${Math.min(completedCredits, def.requiredCredits)}/${def.requiredCredits}cr`,
    };
  }
  return {
    tagged,
    def,
    met: completed.length >= def.required,
    progressText: `${Math.min(completed.length, def.required)}/${def.required}`,
  };
}

// Once a slot's requirement is already met by the cards before it (in sort
// order), any further card for that same category is redundant — e.g. a
// choose-1 category with two courses marked complete only needs the first;
// a 6cr elective slot stops once cumulative credits reach 6, even if that
// last card's own credits tip the running total past it. Track view only
// (see call sites) — Possible must keep showing every real catalog option.
function capShown(sortedShown, def, program) {
  const capped = [];
  let count = 0;
  let credits = 0;
  for (const e of sortedShown) {
    if (def.requiredCredits != null ? credits >= def.requiredCredits : count >= def.required) break;
    capped.push(e);
    // A double-counted entry stays visible (pushed above) but doesn't
    // advance the running total that triggers the cutoff — otherwise a
    // shared, non-counting card could cap off cards that would actually
    // satisfy the requirement.
    if (!isExcludedForProgram(e, program)) {
      count += 1;
      credits += e.credits || 0;
    }
  }
  return capped;
}

// Category keys carry a "(choose N)" suffix internally (it has to match the
// exact string js/roadmapCourses.js tags each course with), but that's
// redundant once the box also shows "1/N" progress right next to it — strip
// it for display only.
function categoryDisplayName(category) {
  return category
    .replace(/\s*\(choose \d+\)\s*$/i, '')
    .replace(/^Intro Computing$/, 'Intro CS')
    .replace(/^Technical Electives/, 'Tech Electives')
    .replace(/ — AE$/, ' (AE)')
    .replace(/ — Open$/, ' (Open)')
    // Kept to 10 chars so a 1x1 box's header never wraps to a 2nd line,
    // which would make that box taller than its same-size siblings.
    .replace(/^Programming$/, 'Coding')
    .replace(/^Probability\/Stats$/, 'Prob/Stats')
    .replace(/^Foundational Math and Science$/, 'Foundational Theory');
}

// One category box with an explicit (not auto-fit) grid of `cols` x `rows`
// card slots — unlike the generic shrink-to-content boxes below, these
// slots are reserved whether or not they're actually filled, which is what
// lets AE Major's layout stay in the same fixed arrangement on Track even
// when nothing's marked yet. Sized per category to how many you'd actually
// ever need there (e.g. Orientation 2, the two Technical Electives groups
// ~2 each since each only needs 6cr worth) — Possible can still show more
// than that for an elective category with many real options (e.g. all ~20
// Technical Electives — AE choices); the box just grows past its preset
// instead of clipping or needing its own internal scroll.
function categoryBoxHtml(program, categoryKey, cols, rows, full, visibleIds, statusFilter, opts = {}) {
  const { tagged, met, progressText, def } = categoryFulfillment(program, categoryKey, full);
  // matchesLock here too, not just in categoryFulfillment's own completed
  // count — this function is Track-only (see call sites), and an
  // electivePool-ambiguous, not-yet-locked course should be fully absent
  // from every box it could go in, not just excluded from the progress
  // count while still shown as a dead card.
  let shown = tagged.filter((e) => visibleIds.has(e.id) && matchesLock(e, program, categoryKey));
  shown = statusFilter ? capShown(sortEntries(shown.filter((e) => statusFilter.includes(e.status))), def, program) : sortEntries(shown);

  // Every box's width is the grid's native N-column width (cols*cardW +
  // (cols-1)*6, the shared 6px card gap) — same formula Foundational
  // Theory's own 2-column box uses, so any 2x1 box (Orientation, Tech
  // Electives, a minor's Core/Upper Electives, etc.) reads exactly as wide
  // as Foundational Theory instead of a wider "N separate 1x1 boxes side
  // by side" proportional width.
  const nativeWidthOf = (n) => `calc(${n} * var(--rm-card-w) + ${Math.max(n - 1, 0)} * 6px)`;
  const gridWidth = nativeWidthOf(cols);

  // flex-wrap, not CSS Grid's explicit column tracks — a grid with
  // grid-template-columns:repeat(cols,...) reserves `cols` cells on every
  // row even when fewer cards are shown, leaving a dead gap between the
  // last real card and the box's right border whenever the shown count
  // isn't a clean multiple of `cols`. Flex just packs cards left-to-right
  // and wraps, so a partial last row has no reserved empty cell. The box's
  // overall footprint (width above, min-height here) still reserves the
  // full `cols` x `rows` slots up front so the layout doesn't jump around
  // as cards get marked — align-content:flex-start keeps any leftover
  // reserved space trailing at the bottom instead of spreading between
  // rows. `opts.center` is the one exception to that left-packed
  // convention — Foundational Theory centers each row instead, so a
  // partial row (e.g. one lone card) gets equal blank space on both sides
  // rather than all of it trailing on the right.
  const minHeight = `calc(${rows} * 72px + ${Math.max(rows - 1, 0)} * 6px)`;
  const justify = opts.center ? 'center' : 'flex-start';

  return `
    <div class="rm-category${met ? ' is-met' : ''}${pendingPlacementId ? ' is-placeable' : ''}" data-category-drop data-program="${escapeHtml(program)}" data-category="${escapeHtml(categoryKey)}">
      <div class="rm-category-head"><span class="mono">${escapeHtml(categoryDisplayName(categoryKey))}</span><span class="muted mono">${escapeHtml(progressText)}</span></div>
      <div class="rm-card-grid" style="display:flex; flex-wrap:wrap; justify-content:${justify}; align-content:flex-start; width:${gridWidth}; min-height:${minHeight};">${shown.map((e) => cardHtml(e, full, { program, category: categoryKey })).join('')}</div>
    </div>
  `;
}

// Sum of `credits` across every entry tagged to `program` (any category)
// with status 'completed' — used by the 4 tally boxes below, not tied to
// any single CATEGORIES entry the way a category box's progress is.
function programCreditSum(program, full) {
  return full
    .filter((e) => e.status === 'completed' && e.programs.some((p) => p.program === program) && !isExcludedForProgram(e, program))
    .reduce((sum, e) => sum + (e.credits || 0), 0);
}

function tallyBoxHtml(label, value, total) {
  return `
    <div class="rm-tally">
      <div class="rm-tally-label">${escapeHtml(label)}</div>
      <div class="rm-tally-value">${value}/${total}cr</div>
    </div>
  `;
}

// No single credit total is tracked for Gen Ed as a whole (it's broken
// out into the per-minor-row requirement boxes instead) — just a
// placeholder slot under the other 4 tallies, not a live tally.
function placeholderTallyHtml(label) {
  return `
    <div class="rm-tally">
      <div class="rm-tally-label">${escapeHtml(label)}</div>
      <div class="rm-tally-value is-placeholder">—</div>
    </div>
  `;
}

// AE Major's own fixed layout for Track only (Possible reverts to the
// generic flex-wrap rendering below) — Technical Core on the right; on the
// left, Orientation/Intro CS/Propulsion stacked in a column next to
// Foundational Math and Science, bottom-aligned via align-items:stretch on
// .rm-ae-grid, then Technical Electives (AE)/(Open) in a row below. The 4
// tally boxes sit in the same left-pinned slot the old AERO ENG. label
// used (see .rm-tally-stack's margin-right:auto) so nothing else in the
// row has to move. The 3 groups (To Graduate | the 3 minors | Gen Ed) are
// spread via justify-content:space-between (see .rm-tally-stack) so the
// last group's bottom edge always lands on the row's bottom, same as
// Foundational Theory's and every other column's.
function aeMajorHtml(full, visibleIds, statusFilter) {
  const box = (key, cols, rows, opts) => categoryBoxHtml('AE', key, cols, rows, full, visibleIds, statusFilter, opts);

  const tallies = [
    tallyBoxHtml('To Graduate', programCreditSum('AE', full), PROGRAM_TOTAL_HOURS.AE),
    tallyBoxHtml('CS Minor', programCreditSum('CS', full), PROGRAM_TOTAL_HOURS.CS),
    tallyBoxHtml('ECE Minor', programCreditSum('ECE', full), PROGRAM_TOTAL_HOURS.ECE),
    tallyBoxHtml('Math Minor', programCreditSum('MATH', full), PROGRAM_TOTAL_HOURS.MATH),
    placeholderTallyHtml('Gen Ed Req.'),
  ].join('');

  return `
    <div class="rm-ae-grid">
      <div class="rm-tally-stack">
        <h2 class="rm-ae-title">AE Major</h2>
        ${tallies}
      </div>
      <div class="rm-ae-middle">
        ${box('Foundational Math and Science', 2, 4, { center: true })}
      </div>
      <div class="rm-ae-left">
        <div class="rm-ae-row">
          ${box('Calculus I (choose 1)', 1, 1)}
          ${box('Orientation', 2, 1)}
        </div>
        <div class="rm-ae-row">
          ${box('Intro Computing (choose 1)', 1, 1)}
          ${box('Technical Electives — AE', 2, 1)}
        </div>
        <div class="rm-ae-row">
          ${box('Propulsion (choose 1)', 1, 1)}
          ${box('Technical Electives — Open', 2, 1)}
        </div>
      </div>
      <div class="rm-ae-right">
        ${box('AE Technical Core', 5, 4)}
      </div>
    </div>
  `;
}

// One row per minor (ECE, Math, CS), Track-only like AE Major above — each
// a single .rm-ae-row of fixed-size boxes (1x1s height-matched with any
// wider siblings via align-items:stretch, same as AE's rows). Every minor
// follows the same 4-box shape: Core (the minor's own required courses) →
// 2 intermediate 1x1s → Upper Electives — so all three rows are built from
// the same 2x1/1x1/1x1/2x1 unit sequence and land on the same total width.
const MINOR_ROW_BOXES = {
  ECE: [
    { key: 'ECE Core', cols: 2, rows: 1 },
    { key: 'Circuits (choose 1)', cols: 1, rows: 1 },
    { key: 'Probability/Stats (choose 1)', cols: 1, rows: 1 },
    { key: 'ECE Upper Electives (choose 2)', cols: 2, rows: 1 },
  ],
  MATH: [
    { key: 'MATH Core', cols: 2, rows: 1 },
    { key: 'Calculus', cols: 1, rows: 1 },
    { key: 'Extra', cols: 1, rows: 1 },
    { key: 'MATH Upper Electives', cols: 2, rows: 1 },
  ],
  CS: [
    { key: 'CS Core', cols: 2, rows: 1 },
    { key: 'Discrete', cols: 1, rows: 1 },
    { key: 'Data', cols: 1, rows: 1 },
    { key: 'CS Upper Electives', cols: 2, rows: 1 },
  ],
};

const MINOR_ROW_LABELS = { ECE: 'ECE Minor', MATH: 'MATH Minor', CS: 'CS Minor' };

// Gen Ed has no fixed course list (same out-of-scope reason as FREE_NOTES
// above), so these are plain label boxes, not real tallied categories —
// just reserving where each requirement will eventually live (a manual
// "+ add" button for these is planned separately). Right-aligned in each
// minor's row via .rm-genEd-group's margin-left:auto. CS's row carries an
// extra "Gen Ed" section-title box (bold, no progress) since it has one
// fewer real requirement than ECE's/Math's — squashed to 88px (the exact
// leftover: ECE/Math's total 2*108+204+2*8=436, minus WCC/US-M/Non-W's
// 3*108+3*8=348) so WCC still lines up under A. Rhet/Rhet and
// all three groups land on the same width/right edge.
const GEN_ED_GROUPS = {
  ECE: [['A. Rhet', 1], ['F. Lang', 1], ['Humanities & Arts', 2]],
  MATH: [['Rhet', 1], ['Entrp', 1], ['Social Sci', 2]],
  CS: [['WCC', 1], ['US-M', 1], ['Non-W', 1]],
};

// Real category box now (placeable via Add to Track/drag, same
// data-category-drop mechanism every other box uses) — these categories
// are never electivePool (see roadmapCourses.js), so matchesLock always
// lets a course show/count here regardless of what else it's tagged or
// locked to elsewhere: explicit double-dipping, Gen Ed only. The "Gen Ed"
// box itself is a plain section title, not a requirement, so it skips all
// of that and just gets the squashed leftover width.
function genEdBoxHtml(program, label, cols, isTitle, full, visibleIds, statusFilter) {
  const width = isTitle ? 88 : (cols === 2 ? 204 : 108);
  if (isTitle) {
    return `
      <div class="rm-category" style="width:${width}px;">
        <div class="rm-category-head"><span class="mono rm-genEd-title">${escapeHtml(label)}</span></div>
      </div>
    `;
  }

  const { tagged, met, progressText, def } = categoryFulfillment(program, label, full);
  let shown = tagged.filter((e) => visibleIds.has(e.id) && matchesLock(e, program, label));
  shown = capShown(sortEntries(shown.filter((e) => statusFilter.includes(e.status))), def, program);

  return `
    <div class="rm-category${met ? ' is-met' : ''}${pendingPlacementId ? ' is-placeable' : ''}" style="width:${width}px;" data-category-drop data-program="${escapeHtml(program)}" data-category="${escapeHtml(label)}">
      <div class="rm-category-head"><span class="mono">${escapeHtml(label)}</span><span class="muted mono">${escapeHtml(progressText)}</span></div>
      <div class="rm-card-grid" style="display:flex; flex-wrap:wrap; gap:6px;">${shown.map((e) => cardHtml(e, full, { program, category: label })).join('')}</div>
    </div>
  `;
}

// Plain text (no border, unlike genEdBoxHtml's boxes) — a section marker
// for the whole Gen Ed breakdown, not a requirement itself, so it sits
// before CS's first box rather than being one of the counted boxes.
function genEdSectionTitleHtml() {
  return `<div class="rm-genEd-section-title"><div>Gen</div><div>Ed</div></div>`;
}

function genEdGroupHtml(program, full, visibleIds, statusFilter) {
  const boxes = GEN_ED_GROUPS[program]
    .map(([label, cols, isTitle]) => genEdBoxHtml(program, label, cols, isTitle, full, visibleIds, statusFilter))
    .join('');
  const title = program === 'CS' ? genEdSectionTitleHtml() : '';
  return `<div class="rm-genEd-group">${title}${boxes}</div>`;
}

function minorRowHtml(program, full, visibleIds, statusFilter) {
  const boxesHtml = MINOR_ROW_BOXES[program]
    .map(({ key, cols, rows, opts }) => categoryBoxHtml(program, key, cols, rows, full, visibleIds, statusFilter, opts))
    .join('');

  return `
    <div class="rm-ae-row rm-minor-row">
      <div class="rm-row-label">${escapeHtml(MINOR_ROW_LABELS[program])}</div>
      ${boxesHtml}
      ${genEdGroupHtml(program, full, visibleIds, statusFilter)}
    </div>
  `;
}

// Shared by both "Track" (filtered to status taking/completed — the
// grow-as-you-go dashboard) and "Possible" (unfiltered — the full
// reference catalog). `statusFilter` is null for Possible, or
// ['taking','completed'] for Track; either way the fulfillment math
// (met/progressText) always runs against the FULL unfiltered data, since a
// category's green/not-green state must never depend on which cards
// happen to be displayed — only which cards get *shown as cards* changes.
function categoryViewHtml(full, visible, statusFilter) {
  const visibleIds = new Set(visible.map((e) => e.id));

  const programsHtml = PROGRAM_ORDER.map((program) => {
    // AE's fixed box layout and the minors' bespoke rows are Track-only
    // (statusFilter truthy) — Possible uses the generic flex-wrap
    // rendering here for every program. The Track versions are built
    // below instead, all inside one shared card (see aeAndMinorsHtml).
    if (statusFilter) return '';

    const categoriesHtml = CATEGORIES.filter((c) => c.program === program).map((cat) => {
      const { tagged, met, progressText, def } = categoryFulfillment(program, cat.category, full);
      let shown = tagged.filter((e) => visibleIds.has(e.id));
      shown = statusFilter ? capShown(sortEntries(shown.filter((e) => statusFilter.includes(e.status))), def, program) : sortEntries(shown);
      if (!shown.length) return ''; // nothing to show — skip the whole category block

      return `
        <div class="rm-category${met ? ' is-met' : ''}">
          <div class="rm-category-head"><span class="mono">${escapeHtml(categoryDisplayName(cat.category))}</span><span class="muted mono">${escapeHtml(progressText)}</span></div>
          <div class="rm-card-grid">${shown.map((e) => cardHtml(e, full, { program })).join('')}</div>
        </div>
      `;
    }).join('');

    // Free Electives etc. have no cards to filter, so they're only shown
    // on the unfiltered Possible view — Track only ever shows things
    // that actually got marked.
    const notesHtml = statusFilter ? '' : FREE_NOTES.filter((n) => n.program === program)
      .map((n) => `<p class="muted">${escapeHtml(n.label)} — ${n.credits} hrs (any eligible course; not tracked here)</p>`)
      .join('');

    if (!categoriesHtml && !notesHtml) return ''; // whole program has nothing to show

    return `
      <section class="card">
        <h2 class="mono">${escapeHtml(PROGRAM_LABELS[program])}</h2>
        <div class="rm-categories">${categoriesHtml}</div>
        ${notesHtml}
      </section>
    `;
  }).join('');

  const aeAndMinorsHtml = statusFilter ? aeAndMinorsSectionHtml(full, visibleIds, statusFilter) : '';
  const needsPlacement = statusFilter ? needsPlacementHtml(full, statusFilter) : '';
  return needsPlacement + programsHtml + aeAndMinorsHtml;
}

// A completed/taking course tagged to 2+ electivePool categories but not
// yet locked to one (see matchesLock) is, by design, shown in NONE of
// Track's fixed boxes — but that leaves no card anywhere to drag onto one,
// a real chicken-and-egg gap for the very first lock. This small list is
// the way out of it: one row per such course, with a plain button per
// eligible category — clicking one locks it there immediately (same
// placeInCategory a drag/drop uses), after which the course appears as a
// normal card in that box and (being locked now) drops out of this list.
function needsPlacementHtml(full, statusFilter) {
  const entries = full.filter((e) => !e.custom && statusFilter.includes(e.status) && !e.lockedCategory && electivePoolTagCount(e) > 1);
  if (!entries.length) return '';
  return `
    <section class="card rm-needs-placement">
      <h2 class="mono">Needs placement</h2>
      <p class="muted">Tagged for more than one elective slot — pick which one each counts toward (it won't show in any of them until you do).</p>
      ${entries.map((e) => `
        <div class="rm-needs-row">
          <span class="rm-needs-name mono">${escapeHtml(e.subject)}${escapeHtml(String(e.number))} — ${escapeHtml(e.name)}</span>
          <div class="rm-needs-options">
            ${e.programs.filter((p) => isElectivePoolCategory(p.program, p.category)).map((p) => `
              <button type="button" data-action="lock" data-id="${escapeHtml(e.id)}" data-program="${escapeHtml(p.program)}" data-category="${escapeHtml(p.category)}">${escapeHtml(p.program)}: ${escapeHtml(categoryDisplayName(p.category))}</button>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </section>
  `;
}

// AE Major + the 3 minor rows, all inside one shared card instead of each
// getting its own — ECE/Math/CS rows follow right after AE's grid, each
// marked off with .rm-minor-row's own top margin.
function aeAndMinorsSectionHtml(full, visibleIds, statusFilter) {
  const ae = aeMajorHtml(full, visibleIds, statusFilter);
  const minors = ['ECE', 'MATH', 'CS'].map((program) => minorRowHtml(program, full, visibleIds, statusFilter)).join('');
  return `<section class="card">${ae}${minors}</section>`;
}

// Exported for the Home dashboard's read-only mirror of the Track view —
// pure function of store state (via allEntries()/categoryViewHtml, neither
// of which reads this module's UI state like view/markMode/searchQuery), so
// it's safe to call from anywhere. Unfiltered (no subject/search filter)
// since the mirror has no filter UI of its own to apply one with.
export function trackViewHtml() {
  const full = allEntries();
  return categoryViewHtml(full, full, ['taking', 'completed']);
}

function headerHtml(full) {
  const pending = pendingPlacementId ? full.find((e) => e.id === pendingPlacementId) : null;
  // Only shows once pendingPlacementId is actually set (right after
  // submitting the Add-to-Track dialog — see openAddDialog) — the button
  // itself just starts that flow, it doesn't toggle a standing mode on its
  // own, so there's nothing to show beforehand.
  const pendingBannerHtml = pending ? `
    <div class="rm-pending-banner">
      <span>Click a box below in Track to place <strong>${escapeHtml(pending.subject)}${escapeHtml(String(pending.number))}</strong> — ${escapeHtml(pending.name)}</span>
      <button type="button" data-action="cancel-placement">Cancel</button>
    </div>
  ` : '';

  return `
    <section class="card">
      <div class="row-between">
        <h1 class="mono">Roadmap</h1>
        <div class="range-toggle">
          <button data-action="view" data-view="semesters" class="${view === 'semesters' ? 'active' : ''}">Semesters</button>
          <button data-action="view" data-view="track" class="${view === 'track' ? 'active' : ''}">Track</button>
          <button data-action="view" data-view="possible" class="${view === 'possible' ? 'active' : ''}">Possible</button>
        </div>
      </div>
      <div class="range-toggle" style="margin-top:8px;">
        <button data-action="mark" data-mark="completed" class="${markMode === 'completed' ? 'active' : ''}">Mark Complete</button>
        <button data-action="mark" data-mark="taking" class="${markMode === 'taking' ? 'active' : ''}">Mark Taking</button>
        ${view === 'semesters' ? '<button data-action="add-to-track">+ Add to Track</button>' : ''}
      </div>
      ${pendingBannerHtml}
    </section>
  `;
}

function filterBarHtml() {
  const subjects = allSubjects();
  return `
    <section class="card">
      <div class="row-between">
        <h2 class="mono">Filter</h2>
        <button data-action="add-course">+ Add course</button>
      </div>
      <input type="text" class="cal-search-input mono" data-action="search" placeholder="Search courses…" value="${escapeHtml(searchQuery)}" style="width:100%; margin-top:8px;">
      <div class="range-toggle" style="flex-wrap:wrap; gap:6px; margin-top:8px;">
        <button data-action="subject-filter" data-subject="" class="${activeSubjects.size === 0 ? 'active' : ''}">All</button>
        ${subjects.map((s) => `<button data-action="subject-filter" data-subject="${escapeHtml(s)}" class="${activeSubjects.has(s) ? 'active' : ''}">${escapeHtml(s)}</button>`).join('')}
      </div>
    </section>
    <dialog id="modal-dialog"></dialog>
  `;
}

function rebuild() {
  // rebuild() replaces the whole DOM tree, including the search input
  // itself, on every keystroke — capture focus/cursor beforehand so typing
  // doesn't kick focus out of the box after each character (same pattern
  // as Canvas/Calendar's own search boxes).
  const searchEl = container.querySelector('[data-action="search"]');
  const searchWasFocused = document.activeElement === searchEl;
  const searchSelection = searchWasFocused ? [searchEl.selectionStart, searchEl.selectionEnd] : null;

  const full = allEntries();
  const visible = sortEntries(full.filter((e) => (!activeSubjects.size || activeSubjects.has(e.subject)) && matchesSearch(e)));
  // Track has no Filter box at all — its fixed-size boxes are meant to be
  // read as a whole dashboard, not filtered down (Semesters and Possible
  // still get it).
  const filterBar = view === 'track' ? '' : filterBarHtml();

  const bodyHtml = view === 'semesters'
    ? semestersViewHtml(visible, full, filterBar)
    : filterBar + (view === 'track'
      ? categoryViewHtml(full, visible, ['taking', 'completed'])
      : categoryViewHtml(full, visible, null));

  container.innerHTML = `
    ${headerHtml(full)}
    ${bodyHtml}
  `;

  attachEvents(full);

  if (searchWasFocused) {
    const newSearchEl = container.querySelector('[data-action="search"]');
    if (newSearchEl) {
      newSearchEl.focus();
      newSearchEl.setSelectionRange(...searchSelection);
    }
  }
}

// A custom course already added (Semesters' "+ Add course", or an earlier
// "Add to Track" that only got as far as creation) but never placed on
// Track yet — e.g. a Gen Ed entered while filling out Semesters, with no
// reason at the time to also pick a category. Only offered in
// placementMode: picking one here skips creating anything and jumps
// straight to placing the course that already exists.
function unplacedCustomEntries() {
  return store.table('RoadmapCustom')
    .filter((r) => !r.program && !r.category)
    .map((r) => ({ id: r.id, subject: r.subject, number: Number(r.number), name: r.name }));
}

// placementMode (the "+ Add to Track" button, only offered on Semesters —
// see headerHtml) skips the plain rebuild() after creating/picking the
// course and instead switches to Track view with pendingPlacementId set,
// so the next click on a category box there (see attachEvents'
// data-category-drop handler) finishes the job by calling placeInCategory.
// A course added this way still has no semester yet either — same as the
// plain flow, it just also needs this one extra step before it's placed.
function openAddDialog(placementMode = false) {
  const dialog = container.querySelector('#modal-dialog');
  const existing = placementMode ? sortEntries(unplacedCustomEntries()) : [];

  dialog.innerHTML = `
    <div class="modal-form">
      <h2 class="mono">${placementMode ? 'Add to Track' : 'Add course'}</h2>
      ${existing.length ? `
        <p class="muted">Pick one already on your roadmap that isn't placed yet —</p>
        <div class="rm-existing-list">
          ${existing.map((e) => `
            <button type="button" class="rm-existing-row" data-action="pick-existing" data-id="${escapeHtml(e.id)}">
              <span class="mono">${escapeHtml(e.subject)}${escapeHtml(String(e.number))}</span>
              <span>${escapeHtml(e.name)}</span>
            </button>
          `).join('')}
        </div>
        <p class="muted" style="margin-top:12px;">— or add a brand new one:</p>
      ` : ''}
      <form method="dialog" class="modal-form">
        <p class="muted">For anything outside the AE/ECE/Math/CS catalog this page already knows — Gen Eds, free electives, etc.${placementMode ? ' Next you\'ll pick where it goes on the Track page.' : ''}</p>
        <div class="field-row">
          <label>Subject <input type="text" name="subject" placeholder="RHET" required></label>
          <label>Number <input type="number" name="number" placeholder="105" required></label>
        </div>
        <label>Name <input type="text" name="name" placeholder="Composition I" required></label>
        <label>Credits <input type="number" name="credits" step="any" min="0" value="3" required></label>
        <div class="modal-actions">
          <button type="button" data-action="cancel">Cancel</button>
          <button type="submit" class="btn-primary">${placementMode ? 'Next' : 'Add'}</button>
        </div>
      </form>
    </div>
  `;

  function startPlacement(id) {
    pendingPlacementId = id;
    view = 'track';
    dialog.close();
    rebuild();
  }

  dialog.querySelectorAll('[data-action="pick-existing"]').forEach((btn) => {
    btn.addEventListener('click', () => startPlacement(btn.dataset.id));
  });

  const form = dialog.querySelector('form');
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', () => {
    const data = new FormData(form);
    const subject = String(data.get('subject')).toUpperCase().trim();
    const number = Number(data.get('number'));
    const id = `CUSTOM_${subject}${number}_${Date.now().toString(36)}`;
    store.upsert('RoadmapCustom', {
      id,
      subject,
      number,
      name: data.get('name'),
      credits: Number(data.get('credits')),
      status: '',
      semester: '',
      program: '',
      category: '',
    });
    if (placementMode) startPlacement(id);
    else rebuild();
  });

  dialog.showModal();
}

function attachEvents(full) {
  container.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      view = btn.dataset.view;
      rebuild();
    });
  });

  container.querySelectorAll('[data-action="mark"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      markMode = markMode === btn.dataset.mark ? null : btn.dataset.mark;
      rebuild();
    });
  });

  container.querySelectorAll('[data-action="subject-filter"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const subject = btn.dataset.subject;
      if (!subject) activeSubjects = new Set();
      else if (activeSubjects.has(subject)) activeSubjects.delete(subject);
      else activeSubjects.add(subject);
      rebuild();
    });
  });

  container.querySelectorAll('[data-action="lock"]').forEach((btn) => {
    btn.addEventListener('click', () => placeInCategory(btn.dataset.id, btn.dataset.program, btn.dataset.category));
  });

  container.querySelector('[data-action="add-course"]')?.addEventListener('click', () => openAddDialog(false));
  container.querySelector('[data-action="add-to-track"]')?.addEventListener('click', () => openAddDialog(true));
  container.querySelector('[data-action="cancel-placement"]')?.addEventListener('click', () => {
    pendingPlacementId = null;
    rebuild();
  });

  container.querySelector('[data-action="search"]')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    rebuild();
  });

  container.querySelectorAll('.rm-card').forEach((el) => {
    const entry = full.find((e) => e.id === el.dataset.id);
    el.addEventListener('click', (e) => {
      // In placement mode (see headerHtml's banner), clicking an existing
      // card still just does its normal thing below — only a click that
      // reaches the surrounding box itself (see the data-category-drop
      // handler below, which this stopPropagation lets fire or not) places
      // the pending course. Without this, clicking a card inside a box
      // while placing would do both at once.
      e.stopPropagation();
      if (markMode) {
        toggleStatus(entry);
        return;
      }
      // No mark mode active — this used to be a dead click (toggleStatus's
      // own early-return). Repurposed as the click (not drag) path onto
      // Track: jump there with this card pending placement, same banner/
      // click-a-box flow "Add to Track" already uses — the point being any
      // card already sitting in a Semesters column (a Gen Ed entry like
      // CLCV115, say) can be placed (or re-placed/moved, including into a
      // second Gen Ed box alongside its existing placement — see
      // isGenEdCategory) without needing a drag gesture or the Add-to-
      // Track dialog's picker at all.
      pendingPlacementId = entry.id;
      view = 'track';
      rebuild();
    });
    el.addEventListener('dragstart', (e) => {
      draggingId = el.dataset.id;
      e.dataTransfer.setData('text/plain', el.dataset.id);
    });
  });

  container.querySelectorAll('[data-semester]').forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-drag-over');
      const id = e.dataTransfer.getData('text/plain') || draggingId;
      if (id) assignSemester(id, zone.dataset.semester);
      draggingId = null;
    });
  });

  // Track's category boxes double as both a drag-drop target (any card,
  // dragged from anywhere) and, while a course is pending placement (see
  // headerHtml's banner), a click target — clicking a box places the
  // pending course there and exits placement mode; the per-card click
  // handler above stops its own clicks from reaching here, so clicking an
  // existing card never accidentally also places the pending one.
  container.querySelectorAll('[data-category-drop]').forEach((zone) => {
    const { program, category } = zone.dataset;
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-drag-over');
      const id = e.dataTransfer.getData('text/plain') || draggingId;
      if (id) placeInCategory(id, program, category);
      draggingId = null;
    });
    zone.addEventListener('click', () => {
      if (pendingPlacementId) placeInCategory(pendingPlacementId, program, category);
    });
  });
}
