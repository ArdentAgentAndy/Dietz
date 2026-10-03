// Pure grading engine — no DOM access, no store access. Computes a course's
// current percent/letter from its parsed rubric config and its Items rows.
// See CLAUDE.md §4 for the rules this implements.

function isGraded(item) {
  return item.earned !== '' && item.earned !== null && item.earned !== undefined;
}

// Items for this component, excused ones removed entirely (they don't count
// as graded or ungraded — they're simply not there).
function scorableItems(component, items) {
  return items.filter((i) => i.componentId === component.id && !i.excused);
}

function gradedItems(component, items) {
  return scorableItems(component, items).filter(isGraded);
}

function itemPercent(item) {
  return item.possible ? Number(item.earned) / Number(item.possible) : 0;
}

// dropLowest applies to graded items only, ranked by item percent. Floored
// at gradedCount-1 so a component with too few graded items yet never has
// everything dropped out from under it.
function applyDropRules(component, items) {
  if (items.length < 2 || !component.dropLowest) return items;
  const kept = [...items].sort((a, b) => itemPercent(a) - itemPercent(b));
  return kept.slice(Math.min(component.dropLowest, kept.length - 1));
}

// Fraction (0-1) earned for a weighted-course component, or null if ungraded.
function weightedComponentPercent(component, items) {
  const graded = gradedItems(component, items);
  if (!graded.length) return null;

  const kept = applyDropRules(component, graded);
  let possible = kept.reduce((sum, i) => sum + Number(i.possible), 0);
  if (!possible) return null;
  let earned = kept.reduce((sum, i) => sum + Number(i.earned), 0);
  if (component.cap != null) {
    earned = Math.min(earned, component.cap);
    possible = Math.min(possible, component.cap);
  }
  return earned / possible;
}

// { earned, possible } for a points-course component, or null if ungraded.
function pointsComponentTotals(component, items) {
  const graded = gradedItems(component, items);
  if (!graded.length) return null;

  const kept = applyDropRules(component, graded);
  let earned = kept.reduce((sum, i) => sum + Number(i.earned), 0);
  let possible = kept.reduce((sum, i) => sum + Number(i.possible), 0);
  if (component.cap != null) {
    earned = Math.min(earned, component.cap);
    possible = Math.min(possible, component.cap);
  }
  return { earned, possible };
}

function computeBonus(bonus, courseState) {
  if (!bonus) return 0;
  const raw = Number(courseState[bonus.stateKey]) || 0;
  return bonus.cap != null ? Math.min(raw, bonus.cap) : raw;
}

function computeExtraCredit(extraCredit, courseState) {
  if (!extraCredit) return 0;
  const raw = extraCredit.counter
    ? (Number(courseState[extraCredit.stateKey]) || 0) * (extraCredit.amountPerUnit ?? 1)
    : Number(courseState[extraCredit.stateKey]) || 0;
  return extraCredit.max != null ? Math.min(raw, extraCredit.max) : raw;
}

function computePenalty(penalty, courseState) {
  if (!penalty) return 0;
  const count = Number(courseState[penalty.stateKey]) || 0;
  const chargeable = Math.max(0, count - (penalty.freeUnits || 0));
  return chargeable * (penalty.amountPerUnit || 0);
}

// Percent (0-100) -> letter, cutoffs checked highest first. rounding
// 'half-up' rounds the percent to the nearest whole point before checking.
function letterForPercent(percent, cutoffs, rounding) {
  // Clear float noise (e.g. 71.6/80*100 === 89.49999999999999) before any
  // half-up rounding, so a true .5 boundary rounds the way it looks on paper.
  const clean = Math.round(percent * 1e6) / 1e6;
  const adjusted = rounding === 'half-up' ? Math.round(clean) : clean;
  for (const [letter, min] of cutoffs) {
    if (adjusted >= min) return letter;
  }
  return 'F';
}

// bonus/extraCredit/penalty are expressed directly in percentage points here
// (unlike the points-course version, where they're raw points against that
// course's own total) — they add straight onto the final 0-100 percent.
function computeWeightedGrade(config, items, courseState = {}) {
  let weightedSum = 0;
  let weightTotal = 0;
  const components = config.components.map((component) => {
    const percent = weightedComponentPercent(component, items);
    if (percent !== null) {
      weightedSum += component.weight * percent;
      weightTotal += component.weight;
    }
    return {
      id: component.id,
      name: component.name,
      graded: percent !== null,
      percent: percent === null ? null : percent * 100,
      weight: component.weight,
    };
  });

  const hasGradedWork = weightTotal > 0;
  const bonus = computeBonus(config.bonus, courseState);
  const extraCredit = computeExtraCredit(config.extraCredit, courseState);
  const penalty = computePenalty(config.penalty, courseState);
  const percent = hasGradedWork ? (weightedSum / weightTotal) * 100 + bonus + extraCredit - penalty : null;

  return {
    hasGradedWork,
    percent,
    letter: percent === null ? null : letterForPercent(percent, config.cutoffs, config.rounding),
    components,
    bonus,
    extraCredit,
    penalty,
  };
}

function computePointsGrade(config, items, courseState) {
  let earnedTotal = 0;
  let possibleTotal = 0;
  const components = config.components.map((component) => {
    const totals = pointsComponentTotals(component, items);
    if (totals) {
      earnedTotal += totals.earned;
      possibleTotal += totals.possible;
    }
    return {
      id: component.id,
      name: component.name,
      graded: Boolean(totals),
      earned: totals ? totals.earned : 0,
      possible: totals ? totals.possible : 0,
    };
  });

  const bonus = computeBonus(config.bonus, courseState);
  const extraCredit = computeExtraCredit(config.extraCredit, courseState);
  const penalty = computePenalty(config.penalty, courseState);
  earnedTotal += bonus + extraCredit - penalty;

  const hasGradedWork = possibleTotal > 0;
  const percent = hasGradedWork ? (earnedTotal / possibleTotal) * 100 : null;

  return {
    hasGradedWork,
    percent,
    letter: percent === null ? null : letterForPercent(percent, config.cutoffs, config.rounding),
    components,
    bonus,
    extraCredit,
    penalty,
  };
}

// config: parsed course.configJson. items: this course's Items rows.
// courseState: { [key]: value } from this course's CourseState rows.
export function computeGrade(config, items, courseState = {}) {
  if (config.type === 'weighted') return computeWeightedGrade(config, items, courseState);
  if (config.type === 'points') return computePointsGrade(config, items, courseState);
  throw new Error(`Unknown course type: ${config.type}`);
}

// Map of item.id -> 'excused' | 'ungraded' | 'dropped' | 'counted', for
// rendering the item table (dropped/excused items get grayed out).
export function itemStatus(component, items) {
  const status = new Map();
  const relevant = items.filter((i) => i.componentId === component.id);

  for (const i of relevant) {
    if (i.excused) status.set(i.id, 'excused');
    else if (!isGraded(i)) status.set(i.id, 'ungraded');
    else status.set(i.id, 'counted');
  }

  const graded = relevant.filter((i) => !i.excused && isGraded(i));
  const kept = new Set(applyDropRules(component, graded).map((i) => i.id));
  for (const i of graded) {
    if (!kept.has(i.id)) status.set(i.id, 'dropped');
  }
  return status;
}
