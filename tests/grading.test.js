import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGrade } from '../js/grading.js';
import { courseConfigs } from '../js/seed.js';

function item(componentId, earned, possible, excused = false) {
  return { componentId, earned, possible, excused };
}

function assertClose(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

// ---- No graded work at all --------------------------------------------

test('no items graded -> null percent/letter, all components ungraded', () => {
  const result = computeGrade(courseConfigs.math241, []);
  assert.equal(result.hasGradedWork, false);
  assert.equal(result.percent, null);
  assert.equal(result.letter, null);
  assert.ok(result.components.every((c) => !c.graded));
});

// ---- MATH 241 (weighted, dropLowest, excusable) ------------------------

test('MATH 241: dropLowest keeps the top scores', () => {
  const items = [10, 9, 8, 7, 6, 5].map((e) => item('hw', e, 10));
  const result = computeGrade(courseConfigs.math241, items);
  // drop 4 lowest (5,6,7,8), keep (9,10) -> 19/20 = 95%
  assertClose(result.percent, 95);
  assert.equal(result.letter, 'A');
});

test('MATH 241: dropLowest never drops the only graded item (floor at gradedCount-1)', () => {
  const items = [8, 6, 4].map((e) => item('hw', e, 10));
  const result = computeGrade(courseConfigs.math241, items);
  // dropLowest 4, but only 3 items -> drop min(4,2)=2, keep the best 1 -> 8/10 = 80%
  assertClose(result.percent, 80);
  assert.equal(result.letter, 'B-');
});

test('MATH 241: an excused midterm drops out of the weight denominator entirely', () => {
  const items = [item('mt1', 0, 100, true), item('final', 90, 100)];
  const result = computeGrade(courseConfigs.math241, items);
  // only final (weight 31) counts: 31*0.9 / 31 = 90%
  assertClose(result.percent, 90);
  assert.equal(result.letter, 'A-');
  const mt1 = result.components.find((c) => c.id === 'mt1');
  assert.equal(mt1.graded, false);
});

// ---- CS 124 (weighted, dropLowest) --------------------------------------

test('CS 124: quizzes dropLowest', () => {
  const items = [20, 18, 16, 14, 12].map((e) => item('quizzes', e, 20));
  const result = computeGrade(courseConfigs.cs124, items);
  // drop 2 lowest (12,14), keep (16,18,20) -> 54/60 = 90%
  assertClose(result.percent, 90);
  assert.equal(result.letter, 'A-'); // CS124 has no A+, A needs >=93
});

test('CS 124: discussion dropLowest discards absences even before all 14 sections have happened', () => {
  const items = [
    ...Array.from({ length: 5 }, () => item('discussion', 1, 1)),
    ...Array.from({ length: 2 }, () => item('discussion', 0, 1)),
  ];
  const result = computeGrade(courseConfigs.cs124, items);
  // dropLowest 4 of only 7 graded drops the 2 absences right away (plus 2 of
  // the attended ones, tied at the same percent) -> 3/3 = 100%
  assertClose(result.percent, 100);
  assert.equal(result.letter, 'A');
});

test('CS 124: discussion dropLowest only forgives up to 4 absences, not unlimited', () => {
  const items = [
    ...Array.from({ length: 2 }, () => item('discussion', 1, 1)),
    ...Array.from({ length: 5 }, () => item('discussion', 0, 1)),
  ];
  const result = computeGrade(courseConfigs.cs124, items);
  // 5 absences, but dropLowest is a fixed 4 -> 1 absence stays counted
  // alongside the 2 attended -> 2/3 = 66.67%
  assertClose(result.percent, 66.67);
  assert.equal(result.letter, 'D');
});

// ---- AE 100 (weighted, no drop/cap rules) -------------------------------

test('AE 100: plain weighted average across partially-graded components', () => {
  const items = [item('hw', 27, 30), item('teamProject', 34, 40)];
  const result = computeGrade(courseConfigs.ae100, items);
  // (30*0.9 + 40*0.85) / (30+40) = 61/70 = 87.14%
  assertClose(result.percent, 87.14);
  assert.equal(result.letter, 'B+');
});

// ---- ENG 100 (points, dropLowest, bonus cap) ----------------------------

test('ENG 100: attendance dropLowest drops its worst scores even with only a few sessions graded', () => {
  const items = [
    ...Array.from({ length: 3 }, () => item('attendance', 20, 20)),
    ...Array.from({ length: 2 }, () => item('attendance', 0, 20)),
  ];
  const result = computeGrade(courseConfigs.eng100, items);
  // dropLowest 2 of only 5 graded still drops the 2 zeros right away (unlike
  // a "best of" rule, which would wait until more than 15 were graded) ->
  // keep the 3 full-credit sessions: 60/60 = 100%
  assertClose(result.percent, 100);
  assert.equal(result.letter, 'A');
});

test('ENG 100: bonus is clamped at its cap', () => {
  const items = [item('homework', 390, 430)];
  const result = computeGrade(courseConfigs.eng100, items, { bonusPoints: 999 });
  // bonus clamped to 40: (390+40)/430 = 100%
  assertClose(result.percent, 100);
  assert.equal(result.letter, 'A');
});

// ---- CLCV 115 (weighted, cap on a weighted component, dropLowest) -------

test('CLCV 115: mini-quiz cap caps possible too, once you bank enough points, capping that 13% component at 100%', () => {
  const items = [
    ...Array.from({ length: 18 }, () => item('miniQuizzes', 8, 8)),
    ...Array.from({ length: 2 }, () => item('miniQuizzes', 3, 8)),
  ];
  // raw: earned 150 / possible 160, cap 130 -> both clamped to 130/130 = 100%
  // of the 13%-weight component, and it's the only one graded.
  const result = computeGrade(courseConfigs.clcv115, items);
  assertClose(result.percent, 100);
  assert.equal(result.letter, 'A+');
});

test('CLCV 115: components combine by their assigned weight, not by raw point totals', () => {
  const items = [
    item('exam1', 135, 150), // 90%, weight 15
    ...Array.from({ length: 10 }, () => item('discussion', 20, 20)), // 100% each
    ...Array.from({ length: 4 }, () => item('discussion', 0, 20)), // dropped as the 4 lowest
  ];
  const result = computeGrade(courseConfigs.clcv115, items);
  // discussion: dropLowest 4 of 14 drops the four 0s -> 200/200 = 100%, weight 20
  // (15*0.9 + 20*1.0) / (15+20) = 33.5/35 = 95.71%
  assertClose(result.percent, 95.71);
  assert.equal(result.letter, 'A');
});

test('CLCV 115: extra credit is in percentage points now, clamped at its (rescaled) max', () => {
  const items = [item('exam1', 150, 150)];
  const result = computeGrade(courseConfigs.clcv115, items, { extraCreditPoints: 25 });
  // exam1 alone -> 100%; extra credit clamped to 2 percentage points (not 20
  // raw points, now that this course is weighted) -> 102%
  assertClose(result.percent, 102);
  assert.equal(result.letter, 'A+');
});

// ---- AFST 112 (points, penalty with free units, uncapped extra credit) --

test('AFST 112: penalty only charges absences beyond the free allotment', () => {
  const items = [item('participation', 9, 10), item('guidedResponse1', 4, 5)];
  const result = computeGrade(courseConfigs.afst112, items, {
    unexcusedAbsences: 5,
    extraCreditEntries: 3,
  });
  // penalty: (5-3)*0.5 = 1; extra credit: 3*1 = 3
  // (9+4+3-1)/(10+5) = 15/15 = 100%
  assertClose(result.percent, 100);
  assert.equal(result.letter, 'A+');
});

test('AFST 112: absences within the free allotment charge no penalty', () => {
  const items = [item('participation', 9, 10), item('guidedResponse1', 4, 5)];
  const result = computeGrade(courseConfigs.afst112, items, { unexcusedAbsences: 2 });
  // 2 <= freeUnits 3 -> no penalty: (9+4)/(10+5) = 13/15 = 86.67%
  assertClose(result.percent, 86.67);
  assert.equal(result.letter, 'B');
});

// ---- TE 200 (points, rounding: half-up) ---------------------------------

test('TE 200: half-up rounding can push a borderline percent into the next letter', () => {
  const items = [item('attendance', 71.6, 80)];
  const result = computeGrade(courseConfigs.te200, items);
  // raw 89.5% rounds up to 90 -> A- instead of B+
  assertClose(result.percent, 89.5);
  assert.equal(result.letter, 'A-');
});
