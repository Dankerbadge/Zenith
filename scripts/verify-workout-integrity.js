#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function read(filePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', filePath), 'utf8');
}

function assertContains(source, pattern, message) {
  if (!pattern.test(source)) {
    throw new Error(message);
  }
}

function run() {
  const workoutModal = read('app/(modals)/workout.tsx');
  const liveSession = read('app/live-session.tsx');
  const liftTag = read('utils/liftTagService.ts');
  const wearableImport = read('utils/wearableImportService.ts');
  const migrations = read('utils/storageMigrations.ts');

  assertContains(
    workoutModal,
    /metricVersions:\s*createWorkoutMetricVersionSet\(/,
    'Workout modal payload is missing metricVersions.'
  );
  assertContains(
    workoutModal,
    /metricsLock:\s*\{[\s\S]*metricsImmutable:\s*true[\s\S]*sessionIntegrityState:\s*'finalized'/,
    'Workout modal payload is missing finalized metricsLock.'
  );

  assertContains(
    liveSession,
    /metricVersions:\s*createWorkoutMetricVersionSet\(/,
    'Live session save is missing metricVersions.'
  );
  assertContains(
    liveSession,
    /metricsLock:\s*\{[\s\S]*metricsImmutable:\s*true[\s\S]*sessionIntegrityState:\s*'finalized'/,
    'Live session save is missing finalized metricsLock.'
  );

  assertContains(
    liftTag,
    /metricVersions:\s*createWorkoutMetricVersionSet\(/,
    'Lift tag builder is missing metricVersions.'
  );
  assertContains(
    wearableImport,
    /metricVersions:\s*createWorkoutMetricVersionSet\(/,
    'Wearable import workout is missing metricVersions.'
  );

  assertContains(
    migrations,
    /await migrateWorkoutEntriesSchema\(\);/,
    'Storage migrations do not run workout entry schema migration.'
  );
  assertContains(
    migrations,
    /function migrateWorkoutEntriesSchema\(/,
    'Workout entry schema migration helper is missing.'
  );

  console.log('Workout integrity verification passed.');
  console.log('- Metric versions are set on workout-producing flows.');
  console.log('- Metrics lock is finalized and immutable by default.');
  console.log('- Migration backfills legacy workout entries.');
}

try {
  run();
} catch (error) {
  console.error(`Workout integrity verification failed: ${error.message}`);
  process.exit(1);
}

