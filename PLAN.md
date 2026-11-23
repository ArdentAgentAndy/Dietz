# Plan

Running doc for planned-but-not-built features — things discussed/decided
before there's code for them, so they don't get lost. Separate from
`CLAUDE.md` on purpose: that file is the spec for what's built/being built;
this one is for what's next. Fold a section into `CLAUDE.md` once it's
actually being built, and remove it from here.

---

## Version roadmap

- **v71 — Today and Agenda subchannel updates.** Scope not yet written.
- **v72 — Mobile mode fixes.** Mobile is badly broken right now. Whole
  version is dedicated to getting the app usable on a phone again.
  Today's pass (2026-11-23) covers only **Today, Agenda and Canvas**;
  every other page's mobile layout waits for v75.
- **v73 — Academics overhaul (in progress, stashed as "academics
  overhaul").** Its full section lives in the stashed copy of this file.
- **v74 — Menu overhaul 2.** Scope not yet written.
- **v75 — Mobile mode fixes, the rest.** Every page v72 didn't cover
  (v72 did Today, Agenda and Canvas).
- **v76 — Overdue page.** Scope not yet written.

---

## Practice channel

### What this is

The new tracker (this repo) has a **Practice** channel in the top nav
(`js/channels.js` — `id: 'practice'`, 🎹). It's the home for the
practice/quiz tooling that used to live in the old Dietz app, which is
still live at:

https://ardentagentandy.github.io/ArdentAgentAndy.github.io-apps/

That old app has three practice modes, all driven by `.xlsx` uploads:

- **Flashcards** — vocab terms, mastery = 5 correct answers per term,
  randomization, "2-Part Mode" (splits a definition on `;` or `/` so each
  half can be tested separately).
- **Sight Reading** — ✅ **built**, see `CLAUDE.md` §3 "Practice > Sight
  Reading". No backend needed — it generates questions, doesn't author
  them.
- **Quiz** — MCQ-style, mastery = customizable correct-answer threshold,
  progress/completion tracking.

`CLAUDE.md` §"Remove from the old app" explicitly dropped all three pages
from the rewrite (along with "Copy for Excel" and the old subject list) —
they weren't abandoned, just deferred until the Practice channel got
built.

### Still to do: Flashcards + Quiz, and the backend they need

Unlike Sight Reading, these two are driven by authored question sets, so
porting them means replacing the `.xlsx` upload with a real backend first
— matching how the rest of this app works (local-first cache + outbox
sync, see `CLAUDE.md` §1), not just re-adding a file-upload button.

Options, not yet decided:

- **Reuse the existing Apps Script + Google Sheet backend** (same `token`
  auth, same `bootstrap`/batch-op API shape as `Courses`/`Items`/etc.). Add
  tables like `Decks`, `Cards`, `QuizSets`, `QuizQuestions`. Pro: one
  backend, one auth story, already deployed. Con: Sheets as a DB for
  potentially large card/question sets is already a known constraint
  elsewhere in this app (see compaction.js's reason for existing).
- **Firebase** (Firestore) as a second backend just for Practice data.
  Pro: better fit for larger/structured question sets, no row-count
  pressure. Con: second auth/sync story, second thing to deploy and pay
  for conceptually, breaks the "one Sheet is the database" architecture
  rule in `CLAUDE.md` §1.

**Open decision — ask before building:** which backend. Leaning Sheets
first for consistency unless question-set volume makes that painful.

### Shape carried over from the old app (assume yes unless told otherwise)

- Flashcards: per-term mastery count (5 correct), randomize order, 2-Part
  Mode split on `;`/`/`.
- Quiz: configurable mastery threshold, progress/completion state.
- Both: a way to author/edit question sets *without* re-uploading a whole
  spreadsheet each time (the actual point of the overhaul) — some in-app
  editor or bulk-paste, backed by the chosen database instead of a file.

### Open questions

- Backend choice (above).
- Does old data (existing `.xlsx` sets) need a one-time import path into
  the new backend, or starting fresh is fine?
- Flashcards and Quiz both carry over, or either gets cut/merged? See the
  merge idea directly below — may answer this one.

### Idea: merge Flashcards + Quiz into one SRS-style review queue

Instead of porting them as two separate modes, consider merging into a
single spaced-repetition-style review queue. The old app's "mastery"
concept (N correct answers in a row) already overlaps heavily between the
two — Flashcards and Quiz differ mainly in *answer format* (free recall vs.
MCQ), not in how mastery is tracked or how a question set is authored.
A merged model could be:

- One `Cards`/`Questions` table per set, each item flagged with an answer
  mode (`recall` or `mcq`) instead of living in two separate tables.
- One review queue/scheduler shared across both modes, instead of
  duplicating mastery-count logic twice.
- Still worth deciding: whether "due again" spacing should be real SRS
  (increasing intervals, like Anki) rather than the old app's flat
  "N-in-a-row" mastery — a bigger behavior change than a pure port, so
  flag it explicitly before building rather than deciding implicitly.

This only matters once the backend (above) is picked, since it changes
the schema either way.

### Build order (draft, revisit once decisions above are made)

1. Pick backend, define schema (tables/collections for decks/cards and
   quiz sets/questions).
2. Build the question-set editor (the Excel-replacement) first — nothing
   else works without a way to get questions in.
3. Port Flashcards mode onto the new data source.
4. Port Quiz mode.
5. Wire both up as Practice subchannels in `js/channels.js` (alongside
   Sight Reading, already there).

---

## Menu page — visual redesign (round 2) — done (v65)

v64 rewrote the Menu page's layout/interaction model: a hand-authored
node-web/skill-tree (`js/channels.js`'s `pos`, `js/views/menu.js`, Menu-hub
section of `css/styles.css`) replacing the old radial-ring constellation —
click/arrow-key a channel to zoom in on it (siblings dim but stay visible,
not fully hidden), drilling into a subchannel zooms further, Escape (or
tapping empty background, on touch) zooms back out. Full keyboard parity
(arrows/number keys/H) carried over unchanged. Each channel got a color via
`hexForLabel` (`js/notionColors.js`).

v65 built the deferred visual pass on top of that, once reference sketches
were in hand:

- Organic "pebble" node shape (shared asymmetric `border-radius`) for
  channel/subchannel nodes, dashed "chem-bond" edges from Home to the outer
  ring.
- **Solo channels** (`channels.js`'s `solo: true` — Contacts, Public):
  one-page channels with no zoom state, demoted to a small inner-ring node
  near Home, reachable by their own first-letter keybind (`P`/`C`) instead
  of being mixed into the outer ring's Left/Right cycling order. Scoped
  entirely to the Menu page — the top-nav channel row (`nav.js`) is
  unaffected.
- Two `???` placeholder nodes filling the outer ring's now-8-but-only-6-real
  slots (`channels.js`'s `placeholder-1`/`placeholder-2`) — inert until
  something real takes those spots.
- On-screen corner prev/next triangle buttons (`.menu-nav-arrow`) — touch
  equivalent of the existing ArrowLeft/ArrowRight channel cycling, visible
  only while a channel is selected/zoomed.

---

## Projects page (planned — v67?)

### What this is

The Inner menu layer's **Projects** pebble (`js/channels.js`'s
`INNER_LAYER_CHANNELS`, currently inert) opens a Projects page. That page is
a field of pebbles, one per project (current and archived), and each one opens
that project's own page with a set of features.

### Where project data already lives (reuse, don't duplicate)

A "project" already exists in four places, all keyed by the same project name:

- **Notion's `Project` select property.** Agenda tasks with category
  `Project` carry `task.project` + `task.projectColor`. The option list and
  colors come from the cached Notion schema (`schema.project` /
  `schema.projectColors`, see `js/notion.js`, `js/views/logging.js`'s
  `liveCategoriesByGroup`).
- **`Categories` table rows with `group: 'project'`.** These already have
  `name` and **`archived`**, which is the current/archived split for free.
  `js/todaySessions.js` already matches tasks to these by name.
- **`Sessions`.** Time logged against a project category (Logging page),
  i.e. hours spent per project.
- **`Contacts` with category `Projects`** (`js/views/contacts.js`), i.e. the
  people tied to a project.

**Decision (default):** the project list is the `Categories` rows with
`group: 'project'`. Name, archived and color (Notion's `projectColors`, same
lookup Logging already uses) come from there. No new table is needed for the
list itself.

### Themes: tier projects vs. skills projects

Projects fall into two themes. ("Tier" is the yearly group; "phase" is
reserved for a project's own lettered milestone phases, A/B/C, below.)

- **Tier projects**: one tier per college year, about 3 projects each,
  done in order.
  1. **Learning** (year 1): Decay, Flightstack, + one pending. These pick up
     the tools.
  2. **Building** (year 2): combine what was learned into a larger, end-to-end
     system (e.g. software + hardware, or Learning projects feeding each other).
  3. **Researching** (year 3): depth over breadth. One real question, ideally
     alongside a lab or professor, ending in a write-up. Follows the Roadmap's
     specialization/tech electives.
  4. **Leading** (year 4): running a team, mentoring, or the portfolio-defining
     project (overlaps capstone/competition teams).
  Names 2–4 are suggestions, not decided.
- **Skills projects**: standalone abilities, not tied to a year, open-ended
  and expected to grow large. Spaceshot is the first.

Theme/tier/tag come from a hand-edited static file (`js/projectThemes.js`,
like `js/roadmapCourses.js`), keyed by project name:
`{ theme: 'tier' | 'skills', tier: 1–4, slot: 0–2, tag }`. These are planning choices,
not Notion data, so no backend change. Name, color and tasks still come from
`Categories`/Notion as above.

### Page 1 — Projects index (`#/projects`)

- Pebbles in the same visual language as the Menu (same `menu-blob-*` shapes,
  `channelColorVars`-style tinting, first-letter watermark).
- **Tier track**: 4 columns, one per tier, each with 3 pebbles joined by the
  menu's dashed bond edges, plus a link from each tier to the next, so it reads
  as a timeline. Current tier full-strength, past tiers dimmed (a finished
  tier effectively *is* the archive), future/empty slots as `???` outlines
  (also covers Learning's pending third).
- **Skills field**: separate area, an open growing cluster/grid rather than
  fixed slots, grouped by domain `tag` (e.g. software / hardware /
  aero-analysis) so a long list stays readable. Smaller pebbles than tier
  ones.
- Keys: 1–4 jump to a tier, S to the skills field, a pebble's letter opens it.
  Esc or M goes back to Menu (same as everywhere else in the menu system).
- A **Whiteboard** button (see "Whiteboard" below).
- Entering a project could reuse `zoomTransition`'s zoom-onto-the-pebble feel.
  That function is menu.js-internal right now, so it would need extracting if
  wanted outside the menu.

### Page 2 — Project page (`#/projects/<id>`)

Where each project's **real plan** lives (the Whiteboard is only for
brainstorming). Brainstormed sections, top to bottom:

1. **Header**: name, color, theme/tier badge (e.g. "Learning · 1/3"),
   target semester. Instead of a status, it shows **where you are in the
   plan**: the current milestone position (e.g. `B · 3.2`, the first unchecked
   step) plus overall progress (steps done / total, as a thin bar).
2. **Brief**: the pitch. What you'd say to a professor (or put on a
   résumé/application), so it's written to be sold, not to be a to-do:
   - One-line hook: what it is, in plain words.
   - Problem / motivation: why it matters, what's hard about it.
   - Approach: what you're building/doing, and what tools or methods.
   - What's interesting / novel: the part worth a professor's time.
   - Results so far: concrete numbers, demos, figures (updated as it
     progresses, pulled from completed checkpoints where possible).
   - Ask (optional): what you'd want from them (advice, lab access,
     research position, a course connection).
   Shown as a clean read-only card by default, edit on click, so it can be
   pulled up mid-conversation.
3. **Milestones**: the plan itself, three levels:
   - **Phases**, lettered: `A`, `B`, `C`, …
   - **Checkpoints**, numbered, continuing across phases (A has 1–2, B has
     3–5, …), so a number is unique within the project.
   - **Steps**, `checkpoint.step`: `3.1`, `3.2`, …
   Full reference reads `B · 3.1`, but `3.1` alone is unambiguous. Drawn as
   a path of small connected pebbles (same visual language as the menu):
   phases as groups, checkpoints as pebbles, steps as a checklist under the
   selected checkpoint. Current checkpoint highlighted. No default template:
   every project's plan is authored from scratch.
   - **Linked to tasks**: a step can link to one or more Agenda (Notion)
     tasks of that project. Default mechanism: the step stores the Notion
     task id(s), and a "make task" action on a step creates the Notion task
     (category `Project`, project = this one, title prefixed with the step
     code, e.g. `3.1 Mesh solver`). A step auto-checks when all its linked
     tasks are done, and can still be checked by hand if it has none.
     Unlinked Project tasks show in Activity (below) with a "link to step"
     action.
   - Checkpoints can have an optional target date. Steps don't (dates live
     on their linked tasks).
4. **Connections**:
   - Builds on / leads to: links to other projects, e.g. a Learning project
     feeding a Building one. Shows the tier chain as a real dependency.
   - Skills used/gained: links to Skills-project pebbles.
5. **Activity**: hours logged (Today / This week / All time) sit next to
   the title. The Tasks list and weekly Hours chart cards were built in
   Stage 2 and then removed (v67). The page platform is now being designed
   on **Spindock** (the third Learning project) first, then applied to every project.
6. **Log**: dated short entries (progress notes, decisions, blockers). Doubles
   as raw material for the write-up.
7. **Resources**: links (repo, docs, drive folder, papers) and people
   (`Contacts` in the `Projects` category, once contacts can be linked to a
   project, see open questions).

Data: 5 reads existing tables. Everything else needs new synced table(s),
e.g. `Projects` (brief, target, connections), `ProjectMilestones` (one row
per phase/checkpoint/step: project, kind, code, title, order, done, target,
linked task ids), `ProjectLog`, added to the `TABLES` lists in
`store.js`/`sync.js`/`settings.js`.

### Whiteboard (`#/projects/board`)

A planning canvas reached from a button on the Projects index. It is saved
(synced like everything else) and split into sections. This absorbs the older
"Brainstorm page, snap to grid, boxes self add" idea from Upcoming ideas.

- **Sections**: named frames, e.g. one per tier, one for Skills, one
  scratch area. Either tabs (one section on screen at a time) or frames on one
  pannable canvas (default: frames, with a key to jump/zoom to each).
- **Saved**: a new synced table (e.g. `BoardItems`, one row per box/edge with
  section, x/y, w/h, text, color, kind), added to the `TABLES` lists in
  `store.js`/`sync.js`/`settings.js`. Goes through the normal local-first +
  outbox sync, so it works offline.
- Candidate functions are listed in the open questions below. Pick before
  building.

### Build order (draft)

1. ✅ Done (v67). `#/projects` (`js/views/projects.js`): tier track, skills
   field. Only projects placed in `js/projectThemes.js` show (no Unsorted
   group). The list comes from `js/projects.js` (Categories ∪
   Notion options ∪ `js/projectThemes.js`). Pebble helpers are shared via
   `js/pebbles.js`. Inner layer's Projects pebble opens it (click, `P`, or
   Enter in the slot). `#/projects/<slug>` is a placeholder shell
   (`js/views/project.js`). Projects are click-only (no per-project or per-tier
   keybinds); Esc → Menu.
2. ✅ Done (v67). Project page (`js/views/project.js`): header with hours
   (Today / This week / All time; the Tasks and weekly chart cards were
   later removed). Hours come from `js/projectHours.js`. Compaction drops which project a session
   was for, so `js/compaction.js` now adds each project session's minutes to a
   per-week tally (CourseState, owner `project:<category id>`) before
   deleting it, same idea as Revision's per-course total. Hours compacted
   before this shipped are lost, so tallies start from v67.
3. ✅ Done (v67, needs Code.gs redeploy). New synced tables `Projects` (id =
   slug; pitch fields) and `ProjectMilestones` (kind phase/checkpoint/step,
   parentId, sortOrder, done, targetDate, taskIds), data in
   `js/projectPlan.js`. Pitch card (Hook, Problem, Approach, What's new,
   Results so far, Ask; read view + Edit form). Milestones: phases A, B…,
   checkpoints numbered continuously across phases, steps `3.1`; codes come
   from order, never stored. Inline add/rename (click title; Enter saves, Esc
   cancels and discards an empty new one), ↑/↓ within siblings, delete with
   children, step checkboxes, optional checkpoint target date. Header shows
   "At B · 3.2" (first undone step) and a steps-done bar. `js/sync.js`'s
   pull now keeps local rows for any table the backend doesn't return yet.
4. ✅ Done (v67). Step ↔ task linking, from the step side (the page has no
   task list any more): "+ task" creates a Notion task (category Project,
   this project, named "<code> <title>", e.g. "1.1 CAD the shaft"; the code
   is a snapshot) and links it; "link" picks one of this project's tasks not
   already linked to a step. Linked tasks show under their step (✕ unlinks,
   the task stays in Notion). A step with linked tasks is done when all are
   `mark`ed; ticking it marks them in Notion (optimistic, reverted with an
   error on failure). Steps with none use their own checkbox.
5. ✅ Done (v67, needs Code.gs redeploy). Whiteboard at `#/projects/board`
   (`js/views/whiteboard.js`), one board for all projects, synced table
   `BoardItems` (kind box/section/edge, x/y/w/h, text, color, fromId/toId).
   Boxes (text, Notion colors, drag, resize, 20px snap), sections (titled
   dashed frames; dragging the title carries the boxes inside), dashed
   connectors (drag a box's ● onto another box; click a line to select).
   Drag empty space to pan, wheel to zoom (view remembered per browser).
   Keys: N box, Enter connected box to the right, E edit, Del delete,
   arrows nudge (Shift ×5), Tab next box, 1–9 jump to section, 0 fit, Esc
   deselect then back. Not built yet: undo/redo, project cards, checklist
   boxes, collapsing sections, search, PNG export, pinch-zoom.
6. ✅ Done (v67, needs Code.gs redeploy). Project page gets Log (dated
   notes, new synced table `ProjectLog`, newest first), Connections
   (`Projects.buildsOn` / `Projects.skills`, comma-joined slugs; "Leads to"
   and a Skills project's "Used in" are the same links read in reverse; only
   projects placed in `projectThemes.js` are offered) and Resources
   (`Projects.links`, JSON list of { label, url }; http(s) only, bare
   domains get https://). No contacts per project (decided against).

Full staged outline (data model, files, verification per stage):
`~/.claude/plans/melodic-coalescing-flute.md`. Fold the relevant parts into
`CLAUDE.md` when a stage starts.

### Open questions

- Is `Categories` (group `project`) really the full list, or are there Notion
  `Project` options with no matching category row? If so, should the list be
  the union of both?
- How does a contact link to a project: a new `project` field on the contact,
  or matching by name/notes?
- Archived layout: dimmed second group (default above) vs. a toggle vs. its
  own outer ring?
- Which features matter most beyond tasks and hours? The list above is a
  guess. Notes/links/milestones are the ones that need a backend change.
- Should the index pebbles rotate/cycle like the hub (Q/E, Enter), or just be
  click/letter? Default: click/letter only.
- Tier names 2–4 (Building / Researching / Leading are suggestions).
- Current tier: a constant in `projectThemes.js` (default) or derived from
  finished projects?
- Step ↔ task link: store the Notion task id on the step (default), or match
  by the step-code prefix in the task title (survives edits made in Notion,
  but breaks if the title is retyped)?
- Whiteboard functions to pick from:
  - Core: boxes (sticky notes), snap to grid, drag/resize, connectors (dashed
    bonds, same look as the menu), colors from the Notion palette, pan/zoom,
    undo/redo, keyboard-first (N new box, arrows nudge, Del, Tab to next box).
  - Boxes self add: Enter on a box spawns the next one beside it, already
    connected (mind-map style).
  - Project-aware: drop a project's pebble onto the board as a live card
    (name, color, open-task count); **promote a box to a project** (adds it to
    the theme/tier file's slots); empty tier slots show as `???` drop targets.
  - Checklist boxes, section jump keys, collapse a section, search across
    boxes, export a section as PNG.
  - Deliberately left out: box → Agenda task, semester lanes. The board is
    only for brainstorming. Each project's real plan lives on its own page.

---

## Upcoming ideas

Short list of channels/features pulled back out to a `???` placeholder
(`js/channels.js`) for now, not because they're cut — just not scoped/built
yet.

- **Application.** Was its own outer-ring channel (routed to a Roadmap
  subchannel); demoted to a `???` placeholder. Probably becomes its own
  separate thing again in a later version — nothing decided yet on scope.
- **Practice.** Was its own outer-ring channel (Sight Reading subchannel);
  demoted to a `???` placeholder. Unlike Application, this one isn't headed
  back to another outer-ring slot — it's getting its own separate place in
  the app instead. Nothing decided yet on where/how; Sight Reading itself
  is unaffected and still reachable directly at `#/sight-reading` in the
  meantime.

Other small fixes/ideas, not yet scoped:

- Main menu upgrade (v66, in progress). Done: I/O keybinds zoom between menu
  layers (Inner / hub / Outer, `js/views/menu.js`'s `goToLayer`), with a `???`
  placeholder circle on the two new layers. Going into a channel uses the same
  zoom animation (I/O themselves don't apply inside a channel). Top-left up/down
  triangles are the touch equivalent of O/I. The Inner layer's Application
  pebble opens Roadmap (click, `A`, or Enter in the bottom-right slot). Still to do: diagonal singlers,
  orthogonal mainers, singler channel mainer.
- Brainstorm page, snap to grid, boxes self add. Folded into the Projects
  page's Whiteboard plan above.

