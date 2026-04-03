#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function assertMatch(source, pattern, label, failures) {
  if (!pattern.test(source)) failures.push(`Missing ${label}`);
}

function main() {
  const failures = [];

  const runReviewService = read('utils/runReviewService.ts');
  const winningSystem = read('utils/winningSystem.ts');
  const behavioralCore = read('utils/behavioralCore.ts');
  const canonicalRunService = read('utils/canonicalRunService.ts');
  const runReview = read('app/run-review.tsx');
  const runSummary = read('app/run-summary.tsx');

  assertMatch(
    runReviewService,
    /function\s+isXpEligibleBySettlement\s*\(/,
    'runReviewService time-policy helper',
    failures
  );
  assertMatch(
    runReviewService,
    /const\s+awardedXP\s*=\s*xpEligibleByTime\s*\?\s*awardedBeforeTimePolicy\s*:\s*0\s*;/,
    'XP award gated by 24h eligibility',
    failures
  );
  assertMatch(
    runReviewService,
    /loggedAtUtc:\s*finalizedAt/,
    'loggedAtUtc persisted on save',
    failures
  );
  assertMatch(
    runReviewService,
    /lateLoggedNoXP\s*=\s*!xpEligibleByTime/,
    'lateLoggedNoXP derived from eligibility',
    failures
  );
  assertMatch(
    runReviewService,
    /const\s+lockActive\s*=\s*run\?\.metricsLock\?\.metricsImmutable\s*!==\s*false/,
    'run history patch defaults to metric lock',
    failures
  );

  // Doctrine: XP can be time-gated, but streaks/winning-day continuity must not "truth leak".
  // A late/no-xp workout still counts as a real workout for "active day" and streak purposes.
  assertMatch(
    winningSystem,
    /workoutDone:\s*workoutDone\s*\|\|\s*signals\.workoutLogged/,
    'winning system counts workouts regardless of XP eligibility',
    failures
  );
  if (/lateLoggedNoXP\s*===\s*true\s*\|\|\s*workout\?\.xpEligibleByTime\s*===\s*false/.test(winningSystem)) {
    failures.push('Winning system excludes late/no-xp workouts');
  }

  assertMatch(
    behavioralCore,
    /if\s*\(\(workout\s+as\s+any\)\.lateLoggedNoXP\s*===\s*true\s*\|\|\s*\(workout\s+as\s+any\)\.xpEligibleByTime\s*===\s*false\)/,
    'behavioral core authority guard for late/no-xp workouts',
    failures
  );
  assertMatch(
    canonicalRunService,
    /const\s+lockActive\s*=\s*target\.metricsLock\?\.metricsImmutable\s*!==\s*false/,
    'canonical run patch defaults to metric lock',
    failures
  );

  assertMatch(
    runReview,
    /outside the 24-hour XP window/,
    'run review policy hint copy',
    failures
  );

  assertMatch(
    runSummary,
    /Timing policy applied/,
    'run summary policy card copy',
    failures
  );

  if (failures.length > 0) {
    console.error('Run time policy verification failed.\n');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log('Run time policy verification passed.');
  console.log('- Late logs still save, but XP is correctly time-gated.');
  console.log('- Winning Day counts late/no-xp workouts to protect streak continuity.');
  console.log('- Behavioral authority can still treat late/no-xp as non-authoritative for anti-exploit controls.');
  console.log('- User-facing policy transparency is present in review + summary.');
}

main();
