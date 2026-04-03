#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function assertMatch(source, pattern, label, failures) {
  if (!pattern.test(source)) {
    failures.push(`Missing ${label}`);
  }
}

function main() {
  const failures = [];

  const appConfig = read('utils/appConfig.ts');
  const winningSystem = read('utils/winningSystem.ts');
  const winningThresholds = read('utils/winningThresholds.ts');
  const behavioralCore = read('utils/behavioralCore.ts');
  const tabsLayout = read('app/(tabs)/_layout.tsx');
  const profile = read('app/(tabs)/profile.tsx');

  // Doctrine lock: social ships enabled, but must never ship seeded/mock social content.
  assertMatch(appConfig, /SOCIAL_FEATURES_ENABLED:\s*true/, 'SOCIAL_FEATURES_ENABLED: true in appConfig', failures);

  const friendsService = read('utils/friendsService.ts');
  assertMatch(
    friendsService,
    /return\s*{\s*schemaVersion:\s*FRIENDS_SCHEMA_VERSION,\s*profiles:\s*\[\],\s*socialSettings:\s*\[\],\s*relationships:\s*\[\]\s*};/,
    'friendsService seedState is empty (no fake people/relationships)',
    failures
  );

  // Doctrine lock: notifications are opt-in off by default.
  assertMatch(
    appConfig,
    /DEFAULT_PREFERENCES\s*=\s*{[\s\S]*notifications:\s*{[\s\S]*enabled:\s*false/,
    'DEFAULT_PREFERENCES.notifications.enabled: false',
    failures
  );
  assertMatch(appConfig, /streakReminders:\s*false/, 'streakReminders default false', failures);
  assertMatch(appConfig, /winningDayPrompts:\s*false/, 'winningDayPrompts default false', failures);
  assertMatch(appConfig, /waterReminders:\s*false/, 'waterReminders default false', failures);

  // Doctrine lock: "winning day" must not truth-leak.
  // Any meaningful daily logging action should count as an active day for streak continuity.
  assertMatch(
    winningSystem,
    /const\s+caloriesInWindow\s*=\s*false\s*;/,
    'winningSystem caloriesInWindow hard-disabled',
    failures
  );
  assertMatch(
    winningSystem,
    /import\s+{\s*WINNING_THRESHOLDS\s*}\s+from\s+'\.\/winningThresholds';/,
    'winningSystem imports canonical winning thresholds',
    failures
  );
  assertMatch(
    behavioralCore,
    /import\s+{\s*WINNING_SETTLEMENT_VERSION,\s*WINNING_THRESHOLDS\s*}\s+from\s+'\.\/winningThresholds';/,
    'behavioralCore imports canonical winning thresholds',
    failures
  );
  assertMatch(
    winningThresholds,
    /minDurationMin:\s*20/,
    'training min duration threshold (20 min)',
    failures
  );
  assertMatch(
    winningThresholds,
    /minActiveEnergyKcal:\s*100/,
    'training min active energy threshold (100 kcal)',
    failures
  );
  assertMatch(
    winningThresholds,
    /minHrRatio:\s*0\.6/,
    'training min HR ratio threshold (0.6)',
    failures
  );
  assertMatch(
    winningThresholds,
    /minMetMinutes:\s*150/,
    'training min MET-min threshold (150)',
    failures
  );
  assertMatch(
    winningThresholds,
    /minDurationMin:\s*10/,
    'recovery min duration threshold (10 min)',
    failures
  );
  assertMatch(
    winningThresholds,
    /maxDurationMin:\s*30/,
    'recovery max duration threshold (30 min)',
    failures
  );
  assertMatch(
    winningThresholds,
    /maxHrRatio:\s*0\.5/,
    'recovery max HR ratio threshold (0.5)',
    failures
  );
  assertMatch(
    winningThresholds,
    /maxMets:\s*3\.0/,
    'recovery max MET threshold (3.0)',
    failures
  );
  assertMatch(
    winningThresholds,
    /maxWinningDaysPerRollingWeek:\s*2/,
    'recovery weekly cap (2)',
    failures
  );
  assertMatch(
    winningSystem,
    /winningDay:\s*activeDay/,
    'winningDay derived from activeDay (truth-leak guard)',
    failures
  );

  // Community surfaces are hard-gated; production must not render fake/seed social data.

  // Profile challenge surface must be gated.
  assertMatch(
    profile,
    /socialEnabled\s*\?\s*\([\s\S]*SectionHeader title='CHALLENGES'/,
    'profile challenges section gated behind socialEnabled',
    failures
  );

  // Deep-link guards for social routes.
  const guardedRoutes = [
    'app/community/manage-friends.tsx',
    'app/friends/find.tsx',
    'app/friends/invite.tsx',
    'app/messages/index.tsx',
    'app/messages/[threadId].tsx',
    'app/clubs/index.tsx',
    'app/clubs/[clubId].tsx',
    'app/challenges/index.tsx',
    'app/challenges/[id].tsx',
  ];

  guardedRoutes.forEach((relPath) => {
    const src = read(relPath);
    assertMatch(
      src,
      /APP_CONFIG\.FEATURES\.SOCIAL_FEATURES_ENABLED/,
      `${relPath} social flag read`,
      failures
    );
    assertMatch(
      src,
      /Redirect href='\/\(tabs\)\/profile'/,
      `${relPath} redirect guard`,
      failures
    );
  });

  if (failures.length > 0) {
    console.error('Doctrine check failed.\n');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log('Doctrine check passed.');
  console.log('- Social is enabled (Supabase-backed).');
  console.log('- Community does not ship seeded/mock social data.');
  console.log('- Notification defaults are opt-in.');
  console.log('- Winning day is active-day based to protect streak continuity.');
}

main();
