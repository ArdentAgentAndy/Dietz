// Pure GPA math — no DOM/store access. See CLAUDE.md §6.
import { computeGrade } from './grading.js?v=49';

export const GRADE_POINTS = {
  'A+': 4.0, 'A': 4.0, 'A-': 3.67,
  'B+': 3.33, 'B': 3.0, 'B-': 2.67,
  'C+': 2.33, 'C': 2.0, 'C-': 1.67,
  'D+': 1.33, 'D': 1.0, 'D-': 0.67,
  'F': 0,
};

function gradePointsFor(letter) {
  return GRADE_POINTS[letter] ?? 0;
}

// courses: this semester's courses. allItems: every Items row (filtered internally
// per course). courseStateByCourseId: { [courseId]: { [key]: value } }.
// Courses with no graded items and no finalLetter override are excluded.
export function computeSemesterGPA(courses, allItems, courseStateByCourseId) {
  let qualityPoints = 0;
  let credits = 0;

  for (const course of courses) {
    let letter = course.finalLetter;
    if (!letter) {
      const config = JSON.parse(course.configJson);
      const items = allItems.filter((i) => i.courseId === course.id);
      const state = courseStateByCourseId[course.id] || {};
      const grade = computeGrade(config, items, state);
      if (!grade.hasGradedWork) continue;
      letter = grade.letter;
    }
    qualityPoints += gradePointsFor(letter) * course.credits;
    credits += course.credits;
  }

  return { gpa: credits > 0 ? qualityPoints / credits : null, credits, qualityPoints };
}

// pastTerms: [{ credits, gpa }] from Settings (pre-app history).
// finishedCourses: earlier-term courses with a finalLetter set.
// semester: this semester's { qualityPoints, credits } from computeSemesterGPA.
export function computeCumulativeGPA(pastTerms, finishedCourses, semester) {
  let qualityPoints = pastTerms.reduce((sum, t) => sum + t.gpa * t.credits, 0);
  let credits = pastTerms.reduce((sum, t) => sum + t.credits, 0);

  for (const course of finishedCourses) {
    qualityPoints += gradePointsFor(course.finalLetter) * course.credits;
    credits += course.credits;
  }

  qualityPoints += semester.qualityPoints;
  credits += semester.credits;

  return credits > 0 ? qualityPoints / credits : null;
}
