// Static reference data for the Roadmap page (#/roadmap) — the AE major
// plus the ECE (EE option), Mathematics, and Computer Science minors.
// Pulled from the official 2026-2027 UIUC catalog (catalog.illinois.edu).
// This is fixed curriculum data, the same for any user of this app, so it
// lives here as a hardcoded module rather than a synced Sheet table — same
// spirit as the seed courses in js/seed.js. What DOES vary per user (which
// of these a student has completed/is taking, and which semester it's
// slotted into) is tracked separately in the synced RoadmapStatus table
// (see js/views/roadmap.js), keyed by this file's course `id`s.
//
// Deliberate scope cuts (see CLAUDE.md/plan discussion, not re-litigated
// here): Gen Ed requirements are excluded entirely (added ad hoc via the
// Roadmap's "+ Add course" flow instead, since Gen Eds have no fixed
// major/minor course list). AE's open-ended "any approved department"
// half of its Technical Electives isn't fully enumerated — only the named
// AE-specific electives, plus the specific non-AE courses confirmed to
// double-count with the three minors, are included. AE's 10-hr Free
// Electives category has no fixed list at all (literally any course), so
// it isn't represented as cards — see FREE_NOTES below.
//
// A course that counts toward more than one program (e.g. MATH257 is both
// an AE requirement and a valid Math-minor elective) lists every program
// it applies to — Track view sums fulfillment per program independently,
// so marking it complete counts toward both at once.

export const COURSES = [
  // --- AE: Orientation (choose-all, 2 of 2) ------------------------------
  { id: 'AE100', subject: 'AE', number: 100, name: 'Intro to Aerospace Engineering', credits: 2,
    programs: [{ program: 'AE', category: 'Orientation' }] },
  { id: 'ENG100', subject: 'ENG', number: 100, name: 'Grainger Engineering Orientation Seminar', credits: 1,
    programs: [{ program: 'AE', category: 'Orientation' }] },

  // --- AE + ECE: Intro Computing (choose 1 of 2) -------------------------
  { id: 'CS101', subject: 'CS', number: 101, name: 'Intro Computing: Engrg & Sci', credits: 3,
    programs: [{ program: 'AE', category: 'Intro Computing (choose 1)' },
               { program: 'ECE', category: 'ECE Core' }] },
  { id: 'CS124', subject: 'CS', number: 124, name: 'Intro to Computer Science I', credits: 3,
    programs: [{ program: 'AE', category: 'Intro Computing (choose 1)' },
               { program: 'ECE', category: 'ECE Core' },
               { program: 'CS', category: 'CS Core' }] },

  // --- AE: Calculus I (choose 1 of 2) ------------------------------------
  { id: 'MATH220', subject: 'MATH', number: 220, name: 'Calculus', credits: 5,
    programs: [{ program: 'AE', category: 'Calculus I (choose 1)' }] },
  { id: 'MATH221', subject: 'MATH', number: 221, name: 'Calculus I', credits: 4,
    programs: [{ program: 'AE', category: 'Calculus I (choose 1)' }] },

  // --- AE: Foundational Math and Science (choose-all, 8 of 8) -----------
  { id: 'CHEM102', subject: 'CHEM', number: 102, name: 'General Chemistry I', credits: 3,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' }] },
  { id: 'CHEM103', subject: 'CHEM', number: 103, name: 'General Chemistry Lab I', credits: 1,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' }] },
  { id: 'MATH231', subject: 'MATH', number: 231, name: 'Calculus II', credits: 3,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' }] },
  { id: 'MATH241', subject: 'MATH', number: 241, name: 'Calculus III', credits: 4,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' },
               { program: 'MATH', category: 'MATH Core' }] },
  { id: 'MATH257', subject: 'MATH', number: 257, name: 'Linear Algebra w/ Computational Applications', credits: 3,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' },
               { program: 'MATH', category: 'Linalg' }] },
  { id: 'MATH285', subject: 'MATH', number: 285, name: 'Intro Differential Equations', credits: 3,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' },
               { program: 'MATH', category: 'DFQ' }] },
  { id: 'PHYS211', subject: 'PHYS', number: 211, name: 'University Physics: Mechanics', credits: 4,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' }] },
  { id: 'PHYS212', subject: 'PHYS', number: 212, name: 'University Physics: Elec & Mag', credits: 4,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' }] },

  // --- AE + ECE: Technical Core (choose-all, 19 of 19) -------------------
  { id: 'AE140', subject: 'AE', number: 140, name: 'Aerospace CAD', credits: 2,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE202', subject: 'AE', number: 202, name: 'Aerospace Flight Mechanics', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE311', subject: 'AE', number: 311, name: 'Incompressible Flow', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE312', subject: 'AE', number: 312, name: 'Compressible Flow', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE321', subject: 'AE', number: 321, name: 'Mechanics of Aerospace Structures', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE323', subject: 'AE', number: 323, name: 'Applied Aerospace Structures', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE352', subject: 'AE', number: 352, name: 'Aerospace Dynamical Systems', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE353', subject: 'AE', number: 353, name: 'Aerospace Control Systems', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE370', subject: 'AE', number: 370, name: 'Aerospace Numerical Methods', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE442', subject: 'AE', number: 442, name: 'Aerospace Systems Design I', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE443', subject: 'AE', number: 443, name: 'Aerospace Systems Design II', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE460', subject: 'AE', number: 460, name: 'Aerodynamics & Propulsion Lab', credits: 2,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE461', subject: 'AE', number: 461, name: 'Structures & Control Lab', credits: 2,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'AE483', subject: 'AE', number: 483, name: 'Autonomous Systems Lab', credits: 2,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'ECE205', subject: 'ECE', number: 205, name: 'Electrical and Electronic Circuits', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' },
               { program: 'ECE', category: 'Circuits (choose 1)' }] },
  { id: 'ME200', subject: 'ME', number: 200, name: 'Thermodynamics', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'MSE280', subject: 'MSE', number: 280, name: 'Engineering Materials', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'TAM210', subject: 'TAM', number: 210, name: 'Introduction to Statics', credits: 2,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },
  { id: 'TAM212', subject: 'TAM', number: 212, name: 'Introductory Dynamics', credits: 3,
    programs: [{ program: 'AE', category: 'AE Technical Core' }] },

  // --- AE: Propulsion (choose 1 of 2) ------------------------------------
  { id: 'AE433', subject: 'AE', number: 433, name: 'Aerospace Propulsion', credits: 3,
    programs: [{ program: 'AE', category: 'Propulsion (choose 1)' }] },
  { id: 'AE434', subject: 'AE', number: 434, name: 'Rocket Propulsion', credits: 3,
    programs: [{ program: 'AE', category: 'Propulsion (choose 1)' }] },

  // --- AE: Technical Electives — AE-specific half (6 of 12 hrs) ---------
  // 18 entries removed here (and ENG491 below) after catalog verification
  // found their stored titles didn't match the real course at that number
  // (e.g. this file's old "AE420 Aeroelasticity" is really AE420 Finite
  // Element Analysis; real Aeroelasticity is AE451) — fabricated/misattached
  // data, not a current-catalog-edition drift. Needs a fresh research pass
  // to repopulate with the real elective list; only AE497/AE498 (generic
  // Advanced/Special Topics, title not tied to a specific real syllabus so
  // nothing to mismatch) survived verification.
  { id: 'AE497', subject: 'AE', number: 497, name: 'Advanced Topics in AE', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE498', subject: 'AE', number: 498, name: 'Special Topics in AE', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },

  // --- AE: Technical Electives — open half (6 of 12 hrs), confirmed to --
  // --- also count toward a minor ----------------------------------------
  { id: 'ECE210', subject: 'ECE', number: 210, name: 'Analog Signal Processing', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'ECE Core' }] },
  { id: 'ECE310', subject: 'ECE', number: 310, name: 'Digital Signal Processing', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'ECE Upper Electives (choose 2)' }] },
  { id: 'ECE329', subject: 'ECE', number: 329, name: 'Fields and Waves I', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'ECE Upper Electives (choose 2)' }] },
  { id: 'ECE330', subject: 'ECE', number: 330, name: 'Power Circuits and Electromechanics', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'ECE Upper Electives (choose 2)' }] },
  { id: 'ECE342', subject: 'ECE', number: 342, name: 'Electronic Circuits (+ ECE 343 Lab)', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'ECE Upper Electives (choose 2)' }] },
  { id: 'ECE385', subject: 'ECE', number: 385, name: 'Digital Systems Laboratory', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' }] },
  { id: 'MATH402', subject: 'MATH', number: 402, name: 'Non-Euclidean Geometry', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH416', subject: 'MATH', number: 416, name: 'Abstract Linear Algebra', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH442', subject: 'MATH', number: 442, name: 'Intro Partial Differential Equations', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH446', subject: 'MATH', number: 446, name: 'Applied Complex Analysis', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH461', subject: 'MATH', number: 461, name: 'Probability Theory', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'Probability/Stats (choose 1)' },
               { program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH484', subject: 'MATH', number: 484, name: 'Nonlinear Programming', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'CS225', subject: 'CS', number: 225, name: 'Data Structures', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'CS', category: 'Data' }] },
  // CS420 (titled "Embedded Systems" — real course is Parallel Progrmg:
  // Sci & Engrg) and CS461 (prereqs CS241/341/233+340/ECE391, none of which
  // are tracked in this catalog) removed — see js/roadmapCourses.js top
  // note. CS's former Required/Upper-Electives split is now Coding (2
  // courses)/Structures (2 courses)/Upper (CS465, the one surviving upper-
  // level elective) — see CATEGORIES below.
  { id: 'CS465', subject: 'CS', number: 465, name: 'User Interface Design', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'CS', category: 'CS Upper Electives' }] },

  // --- ECE minor only: remaining required/elective slots -----------------
  { id: 'ECE110', subject: 'ECE', number: 110, name: 'Introduction to Electronics', credits: 4,
    programs: [{ program: 'ECE', category: 'Circuits (choose 1)' }] },
  { id: 'ECE313', subject: 'ECE', number: 313, name: 'Probability with Engineering Applications', credits: 4,
    programs: [{ program: 'ECE', category: 'Probability/Stats (choose 1)' }] },
  { id: 'IE300', subject: 'IE', number: 300, name: 'Analysis of Data', credits: 3,
    programs: [{ program: 'ECE', category: 'Probability/Stats (choose 1)' }] },
  { id: 'MATH463', subject: 'MATH', number: 463, name: 'Statistics and Probability I', credits: 3,
    programs: [{ program: 'ECE', category: 'Probability/Stats (choose 1)' }] },
  { id: 'CS361', subject: 'CS', number: 361, name: 'Probability and Statistics for Computer Science', credits: 3,
    programs: [{ program: 'ECE', category: 'Probability/Stats (choose 1)' }] },
  { id: 'ECE340', subject: 'ECE', number: 340, name: 'Semiconductor Electronics', credits: 3,
    programs: [{ program: 'ECE', category: 'ECE Upper Electives (choose 2)' }] },

  // --- Math minor only: remaining elective options ------------------------
  // ASRM406, MATH417/418/427/453/412/414/425/487/403/428/432 removed —
  // ASRM406 title fabricated ("Mathematical Statistics II" doesn't exist in
  // ASRM's catalog); 418/427/453/414/425/487/403/428/432 had mismatched
  // titles (see top-of-file note); 417/412 had no catalog-listed prereq
  // still present in this file. The former "Electives" category is now
  // split into 200s/Transition/Upper (see CATEGORIES below) — 200s is
  // MATH257/285 (genuinely 200-level, tagged above in the Foundational
  // block, free overlap credit), Transition is MATH314 (re-added here with
  // its real title, not the fabricated one it had before — a 300-level
  // "intro to proofs" course), everything else here is Upper (400-level).
  { id: 'MATH314', subject: 'MATH', number: 314, name: 'Introduction to Higher Mathematics', credits: 3, programs: [{ program: 'MATH', category: 'MATH Core' }] },
  { id: 'MATH415', subject: 'MATH', number: 415, name: 'Applied Linear Algebra', credits: 3, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH441', subject: 'MATH', number: 441, name: 'Differential Equations', credits: 3, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH424', subject: 'MATH', number: 424, name: 'Honors Real Analysis', credits: 3, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH444', subject: 'MATH', number: 444, name: 'Elementary Real Analysis', credits: 3, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH447', subject: 'MATH', number: 447, name: 'Real Variables', credits: 4, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH448', subject: 'MATH', number: 448, name: 'Complex Analysis', credits: 3, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'CS450', subject: 'CS', number: 450, name: 'Numerical Analysis', credits: 3, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH423', subject: 'MATH', number: 423, name: 'Differential Geometry', credits: 3, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'MATH481', subject: 'MATH', number: 481, name: 'Vector and Tensor Analysis', credits: 3, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'STAT400', subject: 'STAT', number: 400, name: 'Statistics and Probability I', credits: 4, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'STAT410', subject: 'STAT', number: 410, name: 'Statistics and Probability II', credits: 3, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },
  { id: 'STAT420', subject: 'STAT', number: 420, name: 'Methods of Applied Statistics', credits: 4, programs: [{ program: 'MATH', category: 'MATH Upper Electives' }] },

  // --- CS minor only: remaining required courses --------------------------
  { id: 'CS128', subject: 'CS', number: 128, name: 'Introduction to Computer Science II', credits: 3,
    programs: [{ program: 'CS', category: 'CS Core' }] },
  { id: 'CS173', subject: 'CS', number: 173, name: 'Discrete Structures', credits: 3,
    programs: [{ program: 'CS', category: 'Discrete' }] },
];

// Category definitions: how many of that category's tagged courses need to
// be status: 'completed' for Track view to show it as met. `required` is a
// course count; `requiredCredits` (used only for AE's two Technical
// Electives halves, which are defined in credit hours, not a flat course
// count) sums each completed course's `credits` instead.
export const CATEGORIES = [
  { program: 'AE', category: 'Orientation', required: 2 },
  { program: 'AE', category: 'Calculus I (choose 1)', required: 1 },
  { program: 'AE', category: 'Intro Computing (choose 1)', required: 1 },
  { program: 'AE', category: 'Foundational Math and Science', required: 8 },
  { program: 'AE', category: 'AE Technical Core', required: 19 },
  { program: 'AE', category: 'Propulsion (choose 1)', required: 1 },
  // TODO: Technical Electives — AE only has AE497/AE498 left after the
  // title-mismatch cleanup above (see that note) — technically still
  // satisfiable (3+3=6cr) but with zero real choice. Needs a fresh
  // research pass for the real elective list.
  { program: 'AE', category: 'Technical Electives — AE', requiredCredits: 6 },
  { program: 'AE', category: 'Technical Electives — Open', requiredCredits: 6 },

  // ECE Core merges the former Programming (choose 1, CS101/CS124) and EE
  // Core (ECE210) categories — need your 1 programming pick plus ECE210,
  // so required: 2 out of the 3 tagged courses.
  { program: 'ECE', category: 'ECE Core', required: 2 },
  { program: 'ECE', category: 'Circuits (choose 1)', required: 1 },
  { program: 'ECE', category: 'Probability/Stats (choose 1)', required: 1 },
  { program: 'ECE', category: 'ECE Upper Electives (choose 2)', required: 2 },

  // MATH Core merges the former Required (MATH241) and Transition
  // (MATH314) categories — both mandatory, required: 2 of 2. Linalg/DFQ
  // split out of the old "200s" (each exactly 1 real course); Upper is
  // the wide (16-option) elective pool.
  { program: 'MATH', category: 'MATH Core', required: 2 },
  { program: 'MATH', category: 'Linalg', required: 1 },
  { program: 'MATH', category: 'DFQ', required: 1 },
  { program: 'MATH', category: 'MATH Upper Electives', required: 2 },

  // CS Core renamed from the former "Coding" (CS124, CS128, both
  // required). Discrete/Data split out of the old "Structures" (each
  // exactly 1 real course); Upper is CS465, the one surviving real
  // upper-level elective (needs a fresh research pass to add real choices
  // back — see the note by CS465 above).
  { program: 'CS', category: 'CS Core', required: 2 },
  { program: 'CS', category: 'Discrete', required: 1 },
  { program: 'CS', category: 'Data', required: 1 },
  { program: 'CS', category: 'CS Upper Electives', required: 1 },
];

// Credit-hour-only notes for open-ended slots with no fixed course list to
// enumerate — shown in Track view as plain text, never as cards.
export const FREE_NOTES = [
  { program: 'AE', label: 'Free Electives', credits: 10 },
];

export const PROGRAM_LABELS = {
  AE: 'AE Major',
  ECE: 'ECE Minor (EE)',
  MATH: 'Math Minor',
  CS: 'CS Minor',
};

// Total credit hours for the full degree/minor (catalog.illinois.edu,
// 2026-2027 edition — same research pass that produced this file's course
// list). AE's 128 includes Gen Ed and Free Electives, neither of which is
// tracked as cards here (see the scope note up top), so its live tally
// will always read lower than 128 even at true completion.
export const PROGRAM_TOTAL_HOURS = {
  AE: 128,
  ECE: 18,
  MATH: 19,
  CS: 19,
};
