// Seed data for Fall 2026. Rubric numbers come straight from the syllabi —
// ask before changing them (see CLAUDE.md §5).

export const TERM = 'Fall 2026';

export const STANDARD_CUTOFFS = [
  ['A+', 97], ['A', 93], ['A-', 90],
  ['B+', 87], ['B', 83], ['B-', 80],
  ['C+', 77], ['C', 73], ['C-', 70],
  ['D+', 67], ['D', 63], ['D-', 60],
];

export const courseConfigs = {
  math241: {
    type: 'weighted',
    rounding: 'none',
    cutoffs: STANDARD_CUTOFFS,
    components: [
      { id: 'hw', name: 'Online HW', weight: 8, dropLowest: 4 },
      { id: 'worksheets', name: 'Section worksheets', weight: 7, dropLowest: 3 },
      { id: 'mt1', name: 'Midterm 1', weight: 18, excusable: true },
      { id: 'mt2', name: 'Midterm 2', weight: 18, excusable: true },
      { id: 'mt3', name: 'Midterm 3', weight: 18, excusable: true },
      { id: 'final', name: 'Final exam', weight: 31 },
    ],
  },

  cs124: {
    type: 'weighted',
    rounding: 'none',
    cutoffs: [
      ['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['B-', 80],
      ['C+', 77], ['C', 73], ['C-', 70], ['D', 60],
    ],
    components: [
      { id: 'quizzes', name: 'Quizzes', weight: 60, dropLowest: 2 },
      { id: 'mp', name: 'MP', weight: 20 },
      { id: 'hw', name: 'Homework', weight: 10 },
      {
        id: 'discussion',
        name: 'Discussion attendance',
        weight: 10,
        attendanceCap: { sections: 14, cap: 10 },
      },
    ],
  },

  ae100: {
    type: 'weighted',
    rounding: 'none',
    cutoffs: STANDARD_CUTOFFS,
    components: [
      { id: 'participation', name: 'Participation (lectures + lab)', weight: 15 },
      { id: 'hw', name: 'Homework', weight: 30 },
      { id: 'teammateEval', name: 'Teammate evaluation', weight: 15 },
      { id: 'teamProject', name: 'Team project reports (rocket, glider)', weight: 40 },
    ],
    notes: 'Late policy: -10%/day, max -50%, not accepted after 5 days.',
  },

  eng100: {
    type: 'points',
    rounding: 'none',
    totalPossible: 1000,
    cutoffs: [['A', 90], ['B', 80], ['C', 70], ['D', 60]],
    components: [
      {
        id: 'attendance', name: 'Attendance & participation', possible: 300,
        itemPoints: 20, itemCount: 17, bestOf: 15,
      },
      { id: 'mentorMeetings', name: '1-on-1 mentor meetings (MM1, MM2)', possible: 120 },
      { id: 'homework', name: 'Homework (A01-A10)', possible: 430 },
      { id: 'groupProject', name: 'Group project (GP1-GP7)', possible: 150 },
    ],
    bonus: {
      cap: 40,
      stateKey: 'bonusPoints',
      rules: [
        { label: 'Attended 16 of 17 sessions', amount: 10 },
        { label: 'Attended all 17 sessions', amount: 20 },
      ],
    },
  },

  clcv115: {
    type: 'points',
    rounding: 'none',
    totalPossible: 1000,
    cutoffs: STANDARD_CUTOFFS,
    components: [
      { id: 'exam1', name: 'Exam 1 (CBTF)', possible: 150 },
      { id: 'exam2', name: 'Exam 2 (CBTF)', possible: 150 },
      { id: 'final', name: 'Final exam', possible: 150 },
      { id: 'miniQuizzes', name: 'Canvas mini-quizzes', possible: 200, cap: 130 },
      {
        id: 'preSection', name: 'Pre-section quizzes', possible: 100,
        itemPoints: 10, itemCount: 14, bestOf: 10,
      },
      { id: 'essays', name: 'Essays (2 in-section + 2 prep)', possible: 120 },
      {
        id: 'discussion', name: 'Discussion sections', possible: 200,
        itemPoints: 20, itemCount: 14, bestOf: 10,
      },
    ],
    extraCredit: { max: 20, label: 'Spurlock/Krannert/play assignment', stateKey: 'extraCreditPoints' },
  },

  afst112: {
    type: 'points',
    rounding: 'none',
    totalPossible: 100,
    cutoffs: STANDARD_CUTOFFS,
    components: [
      { id: 'participation', name: 'Class participation', possible: 10 },
      { id: 'guidedResponse1', name: 'Guided response 1 (Things Fall Apart)', possible: 5 },
      { id: 'guidedResponse2', name: "Guided response 2 (God's Bits of Wood)", possible: 5 },
      { id: 'monitorAfricaLab', name: 'Monitor Africa Lab (group)', possible: 10 },
      { id: 'mt1', name: 'Midterm 1', possible: 20 },
      { id: 'mt2', name: 'Midterm 2', possible: 20 },
      { id: 'final', name: 'Final exam', possible: 30 },
    ],
    penalty: {
      label: 'Unexcused absences beyond 3', amountPerUnit: 0.5, freeUnits: 3, counter: true,
      stateKey: 'unexcusedAbsences',
    },
    extraCredit: {
      amountPerUnit: 1, counter: true, label: 'Extra-credit entries',
      stateKey: 'extraCreditEntries',
    },
  },

  te200: {
    type: 'points',
    rounding: 'half-up',
    totalPossible: 1000,
    cutoffs: STANDARD_CUTOFFS,
    components: [
      { id: 'attendance', name: 'Class attendance', possible: 80 },
      { id: 'participation', name: 'Class participation', possible: 55 },
      { id: 'innovatorProject', name: 'You as an Innovator project', possible: 70 },
      { id: 'synthesis', name: 'Idea to Impact synthesis', possible: 60 },
      { id: 'linkedin', name: 'LinkedIn profile', possible: 20 },
      {
        id: 'reflections', name: 'Entrepreneurial activity reflections', possible: 150,
        itemPoints: 75, itemCount: 2,
      },
      { id: 'ideaFair', name: 'Idea Fair project', possible: 390, subItems: true },
      {
        id: 'preClass', name: 'Pre-class activities', possible: 175,
        itemPoints: 35, itemCount: 5,
      },
    ],
  },
};

const courses = [
  { id: 'math241', code: 'MATH 241', name: 'Calculus III', credits: 4, sortOrder: 1 },
  { id: 'cs124', code: 'CS 124', name: 'Intro to Computer Science I', credits: 3, sortOrder: 2 },
  { id: 'ae100', code: 'AE 100', name: 'Intro to Aerospace Engineering', credits: 2, sortOrder: 3 },
  { id: 'eng100', code: 'ENG 100', name: 'Engineering Orientation', credits: 1, sortOrder: 4 },
  { id: 'clcv115', code: 'CLCV 115', name: 'Mythology of Greece and Rome', credits: 3, sortOrder: 5 },
  { id: 'afst112', code: 'AFST 112', name: 'History of Africa from 1800', credits: 3, sortOrder: 6 },
  { id: 'te200', code: 'TE 200', name: 'Introduction to Innovation', credits: 1, sortOrder: 7 },
].map((c) => ({
  ...c,
  term: TERM,
  status: 'active',
  finalLetter: '',
  configJson: JSON.stringify(courseConfigs[c.id]),
}));

const revisionCategories = courses.map((c) => ({
  id: `revision-${c.id}`,
  group: 'revision',
  name: c.code,
  courseId: c.id,
  archived: false,
}));

const otherCategories = [
  { id: 'homework', group: 'homework', name: 'Homework', courseId: '', archived: false },
  { id: 'piano', group: 'piano', name: 'Piano', courseId: '', archived: false },
  { id: 'project-default', group: 'project', name: 'Project work', courseId: '', archived: false },
  { id: 'research-default', group: 'research', name: 'Research', courseId: '', archived: false },
];

export const seedData = {
  Courses: courses,
  Items: [],
  CourseState: [],
  Categories: [...revisionCategories, ...otherCategories],
  Sessions: [],
  PastTerms: [],
  Settings: [],
};
