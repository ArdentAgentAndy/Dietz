# Plan

Running doc for planned-but-not-built features — things discussed/decided
before there's code for them, so they don't get lost. Separate from
`CLAUDE.md` on purpose: that file is the spec for what's built/being built;
this one is for what's next. Fold a section into `CLAUDE.md` once it's
actually being built, and remove it from here.

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

