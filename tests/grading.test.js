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

// ---- CS 124 (weighted, dropLowest, attendanceCap) -----------------------

test('CS 124: quizzes dropLowest', () => {
  const items = [20, 18, 16, 14, 12].map((e) => item('quizzes', e, 20));
  const result = computeGrade(courseConfigs.cs124, items);
  // drop 2 lowest (12,14), keep (16,18,20) -> 54/60 = 90%
  assertClose(result.percent, 90);
  assert.equal(result.letter, 'A-'); // CS124 has no A+, A needs >=93
});

test('CS 124: discussion attendanceCap caps beyond the cap even if more sections attended', () => {
  const items = Array.from({ length: 12 }, () => item('discussion', 1, 1));
  const result = computeGrade(courseConfigs.cs124, items);
  // 12 attended, capped at 10/10 = 100%
  assertClose(result.percent, 100);
  assert.equal(result.letter, 'A');
});

test('CS 124: discussion attendanceCap with some absences recorded', () => {
  const items = [
    ...Array.from({ length: 8 }, () => item('discussion', 1, 1)),
    ...Array.from({ length: 2 }, () => item('discussion', 0, 1)),
  ];
  const result = computeGrade(courseConfigs.cs124, items);
  // 8 attended / cap 10 = 80%
  assertClose(result.percent, 80);
  assert.equal(result.letter, 'B-');
});

// ---- AE 100 (weighted, no drop/cap rules) -------------------------------

test('AE 100: plain weighted average across partially-graded components', () => {
  const items = [item('hw', 27, 30), item('teamProject', 34, 40)];
  const result = computeGrade(courseConfigs.ae100, items);
  // (30*0.9 + 40*0.85) / (30+40) = 61/70 = 87.14%
  assertClose(result.percent, 87.14);
  assert.equal(result.letter, 'B+');
});

// ---- ENG 100 (points, bestOf, bonus cap) --------------------------------

test('ENG 100: attendance bestOf is a no-op while under the graded count, plus bonus', () => {
  const items = [
    ...Array.from({ length: 8 }, () => item('attendance', 20, 20)),
    ...Array.from({ length: 2 }, () => item('attendance', 0, 20)),
  ];
  const result = computeGrade(courseConfigs.eng100, items, { bonusPoints: 15 });
  // bestOf 15 with only 10 graded keeps all: 160/200 earned, +15 bonus -> 175/200 = 87.5%
  assertClose(result.percent, 87.5);
  assert.equal(result.letter, 'B');
});

test('ENG 100: bonus is clamped at its cap', () => {
  const items = [
    ...Array.from({ length: 8 }, () => item('attendance', 20, 20)),
    ...Array.from({ length: 2 }, () => item('attendance', 0, 20)),
  ];
  const result = computeGrade(courseConfigs.eng100, items, { bonusPoints: 999 });
  // bonus clamped to 40, but only 40 needed to reach 200/200 = 100%
  assertClose(result.percent, 100);
  assert.equal(result.letter, 'A');
});

// ---- CLCV 115 (points, cap on both earned and possible) -----------------

test('CLCV 115: mini-quiz cap caps possible too, once you bank enough points', () => {
  const items = [
    ...Array.from({ length: 18 }, () => item('miniQuizzes', 8, 8)),
    ...Array.from({ length: 2 }, () => item('miniQuizzes', 3, 8)),
  ];
  // raw: earned 150 / possible 160, cap 130 -> both clamped to 130/130
  const result = computeGrade(courseConfigs.clcv115, items);
  assertClose(result.percent, 100);
  assert.equal(result.letter, 'A+');
});

test('CLCV 115: mini-quiz totals are untouched below the cap', () => {
  const items = [
    ...Array.from({ length: 15 }, () => item('miniQuizzes', 6, 8)),
    item('exam1', 140, 150),
  ];
  const result = computeGrade(courseConfigs.clcv115, items);
  // miniQuizzes: 90/120 (under cap 130, no clamp); exam1: 140/150
  // total: (90+140)/(120+150) = 230/270 = 85.19%
  assertClose(result.percent, 85.19);
  assert.equal(result.letter, 'B');
});

test('CLCV 115: extra credit is clamped at its max and can push a component over 100%', () => {
  const items = [item('exam1', 140, 150)];
  const result = computeGrade(courseConfigs.clcv115, items, { extraCreditPoints: 25 });
  // extra credit clamped to 20: (140+20)/150 = 106.67%
  assertClose(result.percent, 106.67);
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
