#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`Missing ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

function assertContains(raw, snippet, label) {
  if (!raw.includes(snippet)) {
    throw new Error(`Missing ${label}: ${snippet}`);
  }
}

function main() {
  const config = read('utils/appConfig.ts');
  const gps = read('utils/gpsService.ts');
  const docs = read('docs/live-tracking-parameter-sheet.md');

  const requiredConfigKeys = [
    'LIVE_TRACKING',
    'RUN',
    'GPS_STATE',
    'LOST_AFTER_SEC',
    'CONFIDENCE_HIGH_ACCURACY_MAX',
    'CONFIDENCE_MEDIUM_ACCURACY_MAX',
    'TELEPORT_MAX_SEGMENT_MILES',
    'OUTLIER_MAX_SPEED_MPS',
    'LOW_CONF_MAX_SPEED_MPS',
    'ACCURACY_REJECT_METERS',
    'GAP_ESTIMATION_MAX_SEC',
    'SMOOTH_WINDOW_ACCURACY',
    'SMOOTH_WINDOW_RESPONSIVE',
    'SMOOTH_ALPHA_ACCURACY',
    'SMOOTH_ALPHA_RESPONSIVE',
    'SAMPLING',
    'PRECISION',
    'BALANCED',
    'ECO',
  ];

  for (const key of requiredConfigKeys) {
    assertContains(config, key, `app config key ${key}`);
  }

  const requiredGpsRefs = [
    'APP_CONFIG.LIVE_TRACKING.RUN.CONFIDENCE_HIGH_ACCURACY_MAX',
    'APP_CONFIG.LIVE_TRACKING.RUN.CONFIDENCE_MEDIUM_ACCURACY_MAX',
    'APP_CONFIG.LIVE_TRACKING.RUN.TELEPORT_MAX_SEGMENT_MILES',
    'APP_CONFIG.LIVE_TRACKING.RUN.OUTLIER_MAX_SPEED_MPS',
    'APP_CONFIG.LIVE_TRACKING.RUN.LOW_CONF_MAX_SPEED_MPS',
    'APP_CONFIG.LIVE_TRACKING.RUN.ACCURACY_REJECT_METERS',
    'APP_CONFIG.LIVE_TRACKING.RUN.GAP_ESTIMATION_MAX_SEC',
    'APP_CONFIG.LIVE_TRACKING.RUN.GPS_STATE.LOST_AFTER_SEC',
    'APP_CONFIG.LIVE_TRACKING.RUN.SMOOTH_WINDOW_ACCURACY',
    'APP_CONFIG.LIVE_TRACKING.RUN.SMOOTH_WINDOW_RESPONSIVE',
    'APP_CONFIG.LIVE_TRACKING.RUN.SMOOTH_ALPHA_ACCURACY',
    'APP_CONFIG.LIVE_TRACKING.RUN.SMOOTH_ALPHA_RESPONSIVE',
    'const sampling = APP_CONFIG.LIVE_TRACKING.RUN.SAMPLING',
    'sampling.PRECISION.TIME_INTERVAL_MS',
    'sampling.BALANCED.TIME_INTERVAL_MS',
    'sampling.ECO.TIME_INTERVAL_MS',
  ];

  for (const ref of requiredGpsRefs) {
    assertContains(gps, ref, `gpsService reference ${ref}`);
  }

  const bannedMagic = [
    'accuracy <= 12',
    'accuracy <= 28',
    'deltaDistanceMiles > 0.18',
    'speedMps > 11.2',
    "state.priority === 'accuracy' ? 7 : 4",
    "state.priority === 'accuracy' ? 0.26 : 0.44",
    'timeInterval: 800',
    'timeInterval: 1400',
    'timeInterval: 2200',
  ];

  const foundMagic = bannedMagic.filter((token) => gps.includes(token));
  if (foundMagic.length) {
    throw new Error(`Found hard-coded calibration constants in gpsService: ${foundMagic.join(', ')}`);
  }

  assertContains(docs, 'Run (Live + Refinement)', 'live tracking docs run section');
  assertContains(docs, 'Sampling profiles', 'live tracking docs sampling section');

  console.log('Live tracking calibration verification passed.');
  console.log('- Config keys present');
  console.log('- gpsService wired to config');
  console.log('- No banned hard-coded calibration constants detected');
  console.log('- Parameter documentation present');
}

main();
