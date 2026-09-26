# Dietz — Personal Grades & Hours Tracker

Personal-use web app (single user: me, a UIUC freshman) for logging study hours and tracking grades/GPA. Replaces the current `index.html` in this repo ("Dietz", hosted on GitHub Pages).

**Remove from the old app:** Word Checker, Sight Reading, MCQ Quiz pages, the "Copy for Excel" button, and the old default subject list (HIST 112, PHYS 211, MATH 257 etc.). **Keep:** the visual style (see "Design") and the per-subject start/stop timer card idea.

---

## 1. Architecture

- **Frontend:** static site on GitHub Pages. Vanilla HTML/CSS/JS (ES modules), no build step. Chart.js from a CDN for the graph. Hash-based routing (`#/`, `#/courses`, `#/course/<id>`, `#/settings`).
- **Backend:** Google Apps Script web app bound to one Google Sheet (the Sheet is the database). Manage/deploy it with `clasp` from an `apps-script/` folder in this repo.
- **Auth:** single shared secret. Apps Script checks a `token` stored in Script Properties. The frontend stores the web-app URL + token in `localStorage`, entered once on the Settings page. **Never commit the token.** The repo is public.
- **Local-first (priority: speed).** The app must feel instant:
  - All data is cached in `localStorage`; the UI always renders from the cache immediately on load.
  - Every change is applied to the cache and UI immediately, then pushed to an **outbox queue** (persisted in `localStorage`).
  - A background sync flushes the outbox (batched) and pulls fresh data on load / on focus / every few minutes. Retry with backoff; works fully offline and syncs later.
  - Show a small sync status indicator (synced / syncing / offline, N pending).
  - IDs are generated client-side (`crypto.randomUUID()`) so offline creates work.
- **Apps Script API:**
  - `GET ?action=bootstrap&token=…` → all tables as JSON.
  - `POST` (send body as `Content-Type: text/plain` to avoid CORS preflight) `{ token, ops: [{ op: "upsert" | "delete", table, row | id }] }` → apply batch under `LockService`, return `{ ok, updatedAt }`.
- **Timezone:** America/Chicago.

## 2. Sheet schema (one tab per table, header row = field names)

| Tab | Columns |
|---|---|
| `Courses` | id, code, name, credits, term, status (`active`/`archived`), finalLetter (optional override), configJson, sortOrder |
| `Items` | id, courseId, componentId, name, earned, possible, excused (bool), dueDate, note |
| `CourseState` | courseId, key, value (for things like absence counts, attendance counts) |
| `Categories` | id, group (`revision`/`homework`/`project`/`research`/`piano`), name, courseId (revision only), archived |
| `Sessions` | id, categoryId, date, start, end, minutes, source (`timer`/`manual`), note |
| `PastTerms` | id, term, credits, gpa |
| `Settings` | key, value (e.g. semesterStart, semesterEnd) |

`configJson` holds the course's grading rubric (see §5), so new courses can be added from the UI without code changes.

## 3. Pages

### Main page (`#/`)
1. **Hours logger.** Header with today's date and today's total.
   - **Revision** group: one timer card per *active* course.
   - **Other** group: Homework (single, general, not per subject), Piano, **Project work** (a category group; default entry "Project work"; I can add named projects later), **Research** (same pattern; default entry "Research").
   - Each card: live timer, Start/Stop, today's total for that category. Only one timer runs at a time (starting one stops the other, same as the old app). Stopping logs the session automatically.
   - Running timer state (`categoryId`, `startedAt`) persists in `localStorage` so the timer survives closing the tab/refresh.
   - **Manual entry** button for missed sessions: date, duration (h:mm), category, optional note.
   - Recent sessions list with edit/delete.
   - Button to add a new project or research entry.
2. **Hours graph.** One Chart.js line chart, x = day, y = hours, five series: Revision (sum of all revision categories), Homework, Project work (sum of group), Research (sum of group), Piano. Days with no sessions show 0. Range toggle: **7 days / 30 days / Semester / All**.
3. **Courses + GPA.** Card per active course: code, current %, letter, credits → link to course page. Show **semester GPA** (from current letters) and **cumulative GPA** (see §6).

### Courses (`#/courses`)
List all courses. **Add** (code, name, credits, term, then rubric builder or pick a template), **Archive** (hides from main page and removes its revision timer, keeps all data and session history), **Unarchive**, **Delete** (confirm dialog; deletes items; keep past sessions but mark category archived).

### Course page (`#/course/<id>`)
- Header: code, name, credits, current %, letter, points needed info not required.
- One section per grading component showing weight or points, a table of individual items (name, earned / possible, %, due date), an add-item button, and a **bulk add** helper (e.g. "add 14 items named Quiz 1…14 out of 10").
- **Dropped items are grayed out** with a "dropped" tag, recalculated live as scores are entered. Excused items show "excused" and are excluded.
- Component subtotal and contribution to final grade.
- Course-specific extras (absence counter, attendance count, extra credit) rendered from config.
- Syllabus notes (key dates, late policy) as a collapsible text block.

### Settings (`#/settings`)
Apps Script URL + token, semester start/end dates, past terms (add/edit/delete term, credits, GPA), force sync, export JSON backup.

## 4. Grading engine (pure JS module, unit-tested)

Put it in `js/grading.js` with no DOM access. Write tests (Node, `node --test`) with hand-computed cases for every course below, including drop and cap edge cases.

**Course types:**
- `weighted`: final % = Σ(weight × component %) / Σ(weights of components that have ≥1 graded item). Ungraded components are excluded so the grade reflects work so far.
- `points`: final % = (Σ earned + bonus − penalties) / (Σ possible of graded items). Caps and best-of rules apply to graded items only.

**Component rules (all optional):**
- `dropLowest: k`: drop the lowest `min(k, gradedCount − 1)` items by percentage.
- `bestOf: n`: keep the best `n`, i.e. drop `max(0, gradedCount − n)` lowest.
- `cap: x`: component points earned are capped at `x`; possible is capped at `x` too.
- `excusable: true`: items can be flagged excused and are removed; for weighted courses that component's weight is reduced accordingly.
- Item score % = earned / possible. Ungraded = earned is empty.

**Letter cutoffs** are per course (config), checked from highest down, with a `rounding` flag (`none` or `half-up`).

## 5. Seed courses (Fall 2026). Credit hours confirmed correct.

Default cutoffs ("standard"): A+ 97, A 93, A− 90, B+ 87, B 83, B− 80, C+ 77, C 73, C− 70, D+ 67, D 63, D− 60, else F.

### MATH 241, Calculus III (4 cr). Weighted
- Online HW (WebAssign) 8%, `dropLowest: 4`, about 1 per lecture
- Section worksheets 7%, `dropLowest: 3`
- Midterm 1 18% (Sep 22), Midterm 2 18% (Oct 20), Midterm 3 18% (Nov 17). Each is its own component, `excusable` (excused midterm doesn't count)
- Final exam 31% (date TBA, don't leave before Dec 18)
- Cutoffs: standard (syllabus: never stricter than 90 for A−, 80 for B−, etc.). No rounding.

### CS 124 (3 cr). Weighted
- Quizzes 60%, 14 weekly CBTF quizzes, `dropLowest: 2`
- My Project (MP) 20%, weekly checkpoints
- Homework 10%, about 68 daily problems (each is full credit or zero; use bulk add)
- Discussion attendance 10%, 14 graded sections, 1 point each, **counted up to 10**: component % = min(attended, 10) / 10. Model as a checkbox list of 14 sections.
- No final exam.
- Cutoffs: A 93, A− 90, B+ 87, B 83, B− 80, C+ 77, C 73, C− 70, D 60, else F. **No A+, no D+/D−.** No rounding.

### AE 100, Intro to Aerospace Engineering (2 cr). Weighted
- Participation (lectures + lab) 15%
- Homework 30%
- Teammate evaluation 15%
- Team project reports 40% (rocket, glider)
- Cutoffs: standard +/−. Late policy note: −10%/day, max −50%, not accepted after 5 days.

### ENG 100, Engineering Orientation (1 cr). Points (1000)
- Attendance & participation: 17 sessions × 20 pts, `bestOf: 15` → 300. Bonus: +10 if 16 attended, +20 if all 17 attended.
- 1-on-1 mentor meetings: MM1, MM2 → 120 total
- Homework: 12 assignments (A01, A02.1, A02.2, A03, A04, A05.1, A05.2, A06, A07, A08, A09, A10), points vary → 430 total
- Group project: GP1–GP7 → 150 total
- Extra credit: total bonus (incl. attendance bonus) capped at 40
- Cutoffs: A 90, B 80, C 70, D 60, else F. **No +/−.**

### CLCV 115, Mythology of Greece and Rome (3 cr). Points (1000)
- Exam 1: 150 (CBTF, Sep 24–27)
- Exam 2: 150 (CBTF, Oct 29–Nov 1)
- Final exam: 150 (Dec 11, 8–11am, Foellinger)
- Canvas mini-quizzes: up to 8 pts/class, 25 classes (200 possible), `cap: 130`
- Pre-section quizzes (first is the syllabus quiz): 14 × 10, `bestOf: 10` → 100
- Essays: 2 in-section essays × 50 + 2 essay prep exercises × 10 → 120
- Discussion sections: 14 × 20, `bestOf: 10` → 200
- Extra credit: Spurlock/Krannert/play assignment, up to 20
- Cutoffs: standard. **Not rounded.**

### AFST 112, History of Africa from 1800 (cross-listed HIST 112) (3 cr). Points (100)
- Class participation: 10
- Guided response 1 (Things Fall Apart, ~Sep 23–25): 5
- Guided response 2 (God's Bits of Wood, ~Oct 28–30): 5
- Monitor Africa Lab (group): 10
- Midterm 1 (Sep 28): 20
- Midterm 2 (Nov 2): 20
- Final exam (Dec 9): 30
- Penalty: unexcused absences counter; −0.5 pt each beyond 3
- Extra credit: +1 pt per extra-credit entry (counter)
- Cutoffs: standard.

### TE 200, Introduction to Innovation (1 cr). Points (1000)
- Class attendance: 80 (up to 2 absences allowed)
- Class participation: 55
- You as an Innovator project: 70
- Idea to Impact synthesis: 60
- LinkedIn profile: 20
- Entrepreneurial activity reflections: 2 × 75 → 150
- Idea Fair project: 390 (sub-items per Canvas; add as I go)
- Pre-class activities: 5 × 35 → 175
- Cutoffs: standard. **Rounded half-up.**

## 6. GPA

- Grade points (UIUC): A+ 4.0, A 4.0, A− 3.67, B+ 3.33, B 3.0, B− 2.67, C+ 2.33, C 2.0, C− 1.67, D+ 1.33, D 1.0, D− 0.67, F 0.
- **Semester GPA:** credit-weighted, current term's courses, using `finalLetter` if set, otherwise the current computed letter. Courses with no graded items are excluded.
- **Cumulative GPA:** (Σ past-term GPA × credits + current semester quality points) / total credits. Past terms come from `PastTerms` (entered in Settings). Archived courses from earlier terms with a `finalLetter` also count.

## 7. Design (carry over from the old Dietz app)

Dark, minimal, monospace-accented. Sticky top nav with brand `// Dietz` and uppercase mono tabs: **Home, Courses, Settings**.

```css
--bg: #0e0e10; --surface: #16161a; --surface2: #1e1e24;
--border: rgba(255,255,255,0.08); --border-strong: rgba(255,255,255,0.15);
--text: #f0eff4; --muted: rgba(240,239,244,0.45);
--accent: #c3dee8; --accent-dim: rgba(195,222,232,0.12);
--red: #ff6b6b; --green: #5bc87a;
--radius: 12px; --radius-sm: 8px;
```

Fonts: Space Mono (labels, numbers, timers, buttons), DM Sans (body). Timer cards, modals, toasts, and buttons should look like the old app's. Give each of the 5 graph series a distinct but muted color that works on the dark background. Must work well on phone widths.

## 8. Build order

1. Scaffold: routing, nav, styles, `localStorage` store, seed data (§5).
2. Hours logger: timers (persistent), manual entry, session list, graph with range toggle. Fully working offline with no backend.
3. Grading engine + tests for all 7 courses.
4. Courses page (add/archive/delete) and course pages with item entry, bulk add, grayed-out drops.
5. GPA (semester + cumulative) and Settings.
6. Apps Script backend (`apps-script/`, clasp), outbox sync, bootstrap pull, status indicator. Include a short `SETUP.md`: create Sheet, `clasp` login/push, set token in Script Properties, deploy as web app (execute as me, access anyone), paste URL + token into Settings.
7. Deploy to GitHub Pages and test on phone.

Ask me before changing any rubric numbers above. Those come straight from the syllabi.
