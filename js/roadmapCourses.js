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

  // --- AE: Calculus I (choose 1 of 2) ------------------------------------
  { id: 'MATH220', subject: 'MATH', number: 220, name: 'Calculus', credits: 5,
    programs: [{ program: 'AE', category: 'Calculus I (choose 1)' }] },
  { id: 'MATH221', subject: 'MATH', number: 221, name: 'Calculus I', credits: 4,
    programs: [{ program: 'AE', category: 'Calculus I (choose 1)' }] },

  // --- AE + ECE: Intro Computing (choose 1 of 2) -------------------------
  { id: 'CS101', subject: 'CS', number: 101, name: 'Intro Computing: Engrg & Sci', credits: 3,
    programs: [{ program: 'AE', category: 'Intro Computing (choose 1)' },
               { program: 'ECE', category: 'Programming (choose 1)' }] },
  { id: 'CS124', subject: 'CS', number: 124, name: 'Intro to Computer Science I', credits: 3,
    programs: [{ program: 'AE', category: 'Intro Computing (choose 1)' },
               { program: 'ECE', category: 'Programming (choose 1)' },
               { program: 'CS', category: 'Required' }] },

  // --- AE: Foundational Math and Science (choose-all, 8 of 8) -----------
  { id: 'CHEM102', subject: 'CHEM', number: 102, name: 'General Chemistry I', credits: 3,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' }] },
  { id: 'CHEM103', subject: 'CHEM', number: 103, name: 'General Chemistry Lab I', credits: 1,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' }] },
  { id: 'MATH231', subject: 'MATH', number: 231, name: 'Calculus II', credits: 3,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' }] },
  { id: 'MATH241', subject: 'MATH', number: 241, name: 'Calculus III', credits: 4,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' },
               { program: 'MATH', category: 'Required' }] },
  { id: 'MATH257', subject: 'MATH', number: 257, name: 'Linear Algebra w/ Computational Applications', credits: 3,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' },
               { program: 'MATH', category: 'Electives' }] },
  { id: 'MATH285', subject: 'MATH', number: 285, name: 'Intro Differential Equations', credits: 3,
    programs: [{ program: 'AE', category: 'Foundational Math and Science' },
               { program: 'MATH', category: 'Electives' }] },
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
  { id: 'AE402', subject: 'AE', number: 402, name: 'Aerodynamics', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE403', subject: 'AE', number: 403, name: 'Mechanics of Flight Vehicles', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE410', subject: 'AE', number: 410, name: 'Experimental Aerodynamics', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE412', subject: 'AE', number: 412, name: 'Rotorcraft Engineering', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE416', subject: 'AE', number: 416, name: 'Aerospace Component Design', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE419', subject: 'AE', number: 419, name: 'Flight Vehicle Performance', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE420', subject: 'AE', number: 420, name: 'Aeroelasticity', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE428', subject: 'AE', number: 428, name: 'Aerospace Structural Vibrations', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE435', subject: 'AE', number: 435, name: 'Hypersonic Aerothermodynamics', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE445', subject: 'AE', number: 445, name: 'Intro to Space Flight', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE451', subject: 'AE', number: 451, name: 'Aerospace Vehicle Vibrations', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE454', subject: 'AE', number: 454, name: 'Intelligent Flight Control Systems', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE456', subject: 'AE', number: 456, name: 'Optimal Control of Aerospace Systems', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE462', subject: 'AE', number: 462, name: 'Aerospace Plasmadynamics', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE468', subject: 'AE', number: 468, name: 'Applied Orbital Mechanics', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE482', subject: 'AE', number: 482, name: 'Intro to Flight Testing of Aircraft', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE484', subject: 'AE', number: 484, name: 'Intro to Air Traffic Management', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE485', subject: 'AE', number: 485, name: 'Intro to Air Transportation', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE497', subject: 'AE', number: 497, name: 'Advanced Topics in AE', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'AE498', subject: 'AE', number: 498, name: 'Special Topics in AE', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },
  { id: 'ENG491', subject: 'ENG', number: 491, name: 'Topics in Engineering', credits: 3, programs: [{ program: 'AE', category: 'Technical Electives — AE' }] },

  // --- AE: Technical Electives — open half (6 of 12 hrs), confirmed to --
  // --- also count toward a minor ----------------------------------------
  { id: 'ECE210', subject: 'ECE', number: 210, name: 'Analog Signal Processing', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'EE Core' }] },
  { id: 'ECE310', subject: 'ECE', number: 310, name: 'Digital Signal Processing', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'EE Electives (choose 2)' }] },
  { id: 'ECE329', subject: 'ECE', number: 329, name: 'Fields and Waves I', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'EE Electives (choose 2)' }] },
  { id: 'ECE330', subject: 'ECE', number: 330, name: 'Power Circuits and Electromechanics', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'EE Electives (choose 2)' }] },
  { id: 'ECE342', subject: 'ECE', number: 342, name: 'Electronic Circuits (+ ECE 343 Lab)', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'EE Electives (choose 2)' }] },
  { id: 'ECE385', subject: 'ECE', number: 385, name: 'Digital Systems Laboratory', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' }] },
  { id: 'MATH402', subject: 'MATH', number: 402, name: 'Non-Euclidean Geometry', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'Electives' }] },
  { id: 'MATH413', subject: 'MATH', number: 413, name: 'Intro to Combinatorics', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'Electives' }] },
  { id: 'MATH416', subject: 'MATH', number: 416, name: 'Abstract Linear Algebra', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'Electives' }] },
  { id: 'MATH442', subject: 'MATH', number: 442, name: 'Intro Partial Differential Equations', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'Electives' }] },
  { id: 'MATH446', subject: 'MATH', number: 446, name: 'Applied Complex Analysis', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'Electives' }] },
  { id: 'MATH461', subject: 'MATH', number: 461, name: 'Probability Theory', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'ECE', category: 'Probability/Stats (choose 1)' },
               { program: 'MATH', category: 'Electives' }] },
  { id: 'MATH482', subject: 'MATH', number: 482, name: 'Discrete Mathematics', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'Electives' }] },
  { id: 'MATH484', subject: 'MATH', number: 484, name: 'Nonlinear Programming', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'Electives' }] },
  { id: 'MATH489', subject: 'MATH', number: 489, name: 'Mathematical Theory of Optimization', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'MATH', category: 'Electives' }] },
  { id: 'CS225', subject: 'CS', number: 225, name: 'Data Structures', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'CS', category: 'Required' }] },
  { id: 'CS420', subject: 'CS', number: 420, name: 'Embedded Systems', credits: 4,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'CS', category: 'Upper Electives (choose 2)' }] },
  { id: 'CS461', subject: 'CS', number: 461, name: 'Computer Security I', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'CS', category: 'Upper Electives (choose 2)' }] },
  { id: 'CS465', subject: 'CS', number: 465, name: 'User Interface Design', credits: 3,
    programs: [{ program: 'AE', category: 'Technical Electives — Open' },
               { program: 'CS', category: 'Upper Electives (choose 2)' }] },

  // --- ECE minor only: remaining required/elective slots -----------------
  { id: 'ECE110', subject: 'ECE', number: 110, name: 'Introduction to Electronics', credits: 4,
    programs: [{ program: 'ECE', category: 'Circuits (choose 1)' }] },
  { id: 'ECE313', subject: 'ECE', number: 313, name: 'Probability with Engineering Applications', credits: 4,
    programs: [{ program: 'ECE', category: 'Probability/Stats (choose 1)' }] },
  { id: 'IE300', subject: 'IE', number: 300, name: 'Analysis of Data', credits: 3,
    programs: [{ program: 'ECE', category: 'Probability/Stats (choose 1)' }] },
  { id: 'BIOE310', subject: 'BIOE', number: 310, name: 'Biomedical Data Analysis', credits: 3,
    programs: [{ program: 'ECE', category: 'Probability/Stats (choose 1)' }] },
  { id: 'MATH463', subject: 'MATH', number: 463, name: 'Statistics and Probability I', credits: 3,
    programs: [{ program: 'ECE', category: 'Probability/Stats (choose 1)' }] },
  { id: 'CEE202', subject: 'CEE', number: 202, name: 'Probability and Statistics for Civil Engineers', credits: 3,
    programs: [{ program: 'ECE', category: 'Probability/Stats (choose 1)' }] },
  { id: 'CS361', subject: 'CS', number: 361, name: 'Probability and Statistics for Computer Science', credits: 3,
    programs: [{ program: 'ECE', category: 'Probability/Stats (choose 1)' }] },
  { id: 'ECE340', subject: 'ECE', number: 340, name: 'Semiconductor Electronics', credits: 3,
    programs: [{ program: 'ECE', category: 'EE Electives (choose 2)' }] },

  // --- Math minor only: remaining elective options ------------------------
  { id: 'ASRM406', subject: 'ASRM', number: 406, name: 'Mathematical Statistics II', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH415', subject: 'MATH', number: 415, name: 'Applied Linear Algebra', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH417', subject: 'MATH', number: 417, name: 'Intro to Abstract Algebra', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH418', subject: 'MATH', number: 418, name: 'Abstract Algebra', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH427', subject: 'MATH', number: 427, name: 'Number Theory', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH453', subject: 'MATH', number: 453, name: 'Elementary Theory of Numbers', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH412', subject: 'MATH', number: 412, name: 'Graph Theory', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH414', subject: 'MATH', number: 414, name: 'Theory of Games', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH424', subject: 'MATH', number: 424, name: 'Honors Real Analysis', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH425', subject: 'MATH', number: 425, name: 'Intro to Probability', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH441', subject: 'MATH', number: 441, name: 'Differential Equations', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH444', subject: 'MATH', number: 444, name: 'Elementary Real Analysis', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH447', subject: 'MATH', number: 447, name: 'Real Variables', credits: 4, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH448', subject: 'MATH', number: 448, name: 'Complex Analysis', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'CS450', subject: 'CS', number: 450, name: 'Numerical Analysis', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH487', subject: 'MATH', number: 487, name: 'Real Analysis', credits: 4, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH314', subject: 'MATH', number: 314, name: 'Theory of Numbers', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH403', subject: 'MATH', number: 403, name: 'Projective Geometry', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH423', subject: 'MATH', number: 423, name: 'Differential Geometry', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH428', subject: 'MATH', number: 428, name: 'Introductory Topology', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH432', subject: 'MATH', number: 432, name: 'Introductory Topology II', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'MATH481', subject: 'MATH', number: 481, name: 'Vector and Tensor Analysis', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'STAT400', subject: 'STAT', number: 400, name: 'Statistics and Probability I', credits: 4, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'STAT410', subject: 'STAT', number: 410, name: 'Statistics and Probability II', credits: 3, programs: [{ program: 'MATH', category: 'Electives' }] },
  { id: 'STAT420', subject: 'STAT', number: 420, name: 'Methods of Applied Statistics', credits: 4, programs: [{ program: 'MATH', category: 'Electives' }] },

  // --- CS minor only: remaining required courses --------------------------
  { id: 'CS128', subject: 'CS', number: 128, name: 'Introduction to Computer Science II', credits: 3,
    programs: [{ program: 'CS', category: 'Required' }] },
  { id: 'CS173', subject: 'CS', number: 173, name: 'Discrete Structures', credits: 3,
    programs: [{ program: 'CS', category: 'Required' }] },
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
  { program: 'AE', category: 'Technical Electives — AE', requiredCredits: 6 },
  { program: 'AE', category: 'Technical Electives — Open', requiredCredits: 6 },

  { program: 'ECE', category: 'Circuits (choose 1)', required: 1 },
  { program: 'ECE', category: 'Programming (choose 1)', required: 1 },
  { program: 'ECE', category: 'Probability/Stats (choose 1)', required: 1 },
  { program: 'ECE', category: 'EE Core', required: 1 },
  { program: 'ECE', category: 'EE Electives (choose 2)', required: 2 },

  { program: 'MATH', category: 'Required', required: 1 },
  { program: 'MATH', category: 'Electives', required: 5 },

  { program: 'CS', category: 'Required', required: 4 },
  { program: 'CS', category: 'Upper Electives (choose 2)', required: 2 },
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
