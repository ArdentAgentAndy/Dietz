import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSemesterGPA, computeCumulativeGPA } from '../js/gpa.js';

function assertClose(actual, expected, tolerance = 0.01) {
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('semester GPA: finalLetter overrides skip grade computation entirely', () => {
  const courses = [
    { id: 'a', credits: 4, finalLetter: 'A' },
    { id: 'b', credits: 3, finalLetter: 'B+' },
  ];
  const result = computeSemesterGPA(courses, [], {});
  // (4*4.0 + 3*3.33) / 7 = 25.99/7
  assertClose(result.gpa, 25.99 / 7);
  assert.equal(result.credits, 7);
});

test('semester GPA: ungraded courses (no finalLetter, no graded items) are excluded', () => {
  const courses = [
    { id: 'a', credits: 4, finalLetter: 'A' },
    { id: 'b', credits: 3, finalLetter: '', configJson: JSON.stringify({ type: 'points', rounding: 'none', cutoffs: [['A', 90]], components: [{ id: 'x', possible: 100 }] }) },
  ];
  const result = computeSemesterGPA(courses, [], {});
  // course b has no graded items -> excluded entirely
  assertClose(result.gpa, 4.0);
  assert.equal(result.credits, 4);
});

test('cumulative GPA: past terms + finished courses + current semester combine', () => {
  const pastTerms = [{ credits: 15, gpa: 3.5 }];
  const finishedCourses = [{ credits: 3, finalLetter: 'A-' }];
  const semester = { qualityPoints: 4.0 * 4, credits: 4 }; // one A in a 4-credit course
  const cumulative = computeCumulativeGPA(pastTerms, finishedCourses, semester);
  // (15*3.5 + 3*3.67 + 16) / (15+3+4) = (52.5 + 11.01 + 16) / 22
  assertClose(cumulative, (52.5 + 11.01 + 16) / 22);
});

test('cumulative GPA: no history at all falls back to semester-only', () => {
  const cumulative = computeCumulativeGPA([], [], { qualityPoints: 12, credits: 4 });
  assertClose(cumulative, 3.0);
});
