#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function fail(message) {
  console.error(`[garmin-verify] FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`[garmin-verify] PASS: ${message}`);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

const requiredFiles = [
  'utils/garminProtocol.ts',
  'utils/garminCompanionService.ts',
  'utils/garminBackendService.ts',
  'utils/garminNativeBridge.ts',
  'app/wearables/index.tsx',
  'app/wearables/garmin.tsx',
  'supabase/functions/garmin-entitlement/index.ts',
  'supabase/functions/garmin-link-token/index.ts',
  'supabase/functions/garmin-link-confirm/index.ts',
  'supabase/functions/garmin-workout-upsert/index.ts',
  'ios/Zenith/GarminCompanionManager.swift',
  'ios/Zenith/GarminCompanionEventEmitter.swift',
  'ios/Zenith/GarminCompanionNativeBridge.swift',
  'ios/Zenith/GarminCompanionNativeBridge.m',
];

const requiredResourceQualifiers = [
  'garmin-watch/zenith-garmin-watch/resources-round-208x208',
  'garmin-watch/zenith-garmin-watch/resources-round-218x218',
  'garmin-watch/zenith-garmin-watch/resources-round-240x240',
  'garmin-watch/zenith-garmin-watch/resources-round-260x260',
  'garmin-watch/zenith-garmin-watch/resources-round-280x280',
  'garmin-watch/zenith-garmin-watch/resources-round-360x360',
  'garmin-watch/zenith-garmin-watch/resources-round-390x390',
  'garmin-watch/zenith-garmin-watch/resources-round-416x416',
  'garmin-watch/zenith-garmin-watch/resources-round-454x454',
  'garmin-watch/zenith-garmin-watch/resources-rectangle-240x240',
  'garmin-watch/zenith-garmin-watch/resources-rectangle-320x360',
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    fail(`Missing required file: ${file}`);
  } else {
    pass(`Found ${file}`);
  }
}

for (const dir of requiredResourceQualifiers) {
  const abs = path.join(root, dir);
  const resourcesXml = path.join(abs, 'resources.xml');
  if (!fs.existsSync(abs)) {
    fail(`Missing Garmin resource qualifier: ${dir}`);
    continue;
  }
  if (!fs.existsSync(resourcesXml)) {
    fail(`Missing resources.xml in qualifier: ${dir}`);
    continue;
  }
  pass(`Found Garmin resource qualifier ${dir}`);
}

try {
  const appConfig = read('utils/appConfig.ts');
  const hasGarminFlag = appConfig.includes('GARMIN_CONNECT_ENABLED');
  const hasCompanionFlags =
    appConfig.includes('GARMIN_IOS_COMPANION_ENABLED') && appConfig.includes('GARMIN_ANDROID_COMPANION_ENABLED');

  if (!hasGarminFlag) fail('Missing GARMIN_CONNECT_ENABLED feature flag in appConfig.');
  else pass('GARMIN_CONNECT_ENABLED feature flag present.');

  if (!hasCompanionFlags) fail('Missing companion bridge flags in appConfig.');
  else pass('Garmin companion bridge flags present.');
} catch (error) {
  fail(`Could not parse utils/appConfig.ts (${error.message})`);
}

try {
  const profile = read('app/(tabs)/profile.tsx');
  if (!profile.includes('/wearables/garmin')) {
    fail('Profile screen does not expose Garmin companion route.');
  } else {
    pass('Profile exposes Garmin companion route.');
  }
} catch (error) {
  fail(`Could not inspect profile route wiring (${error.message})`);
}

try {
  const project = read('ios/Zenith.xcodeproj/project.pbxproj');
  const hasNativeFiles =
    project.includes('GarminCompanionManager.swift') &&
    project.includes('GarminCompanionEventEmitter.swift') &&
    project.includes('GarminCompanionNativeBridge.swift') &&
    project.includes('GarminCompanionNativeBridge.m');

  if (!hasNativeFiles) fail('Garmin native iOS files are not linked in project.pbxproj.');
  else pass('Garmin native iOS files are linked in project.pbxproj.');
} catch (error) {
  fail(`Could not inspect iOS project linkage (${error.message})`);
}

if (process.exitCode && process.exitCode !== 0) {
  console.error('[garmin-verify] Garmin readiness verification failed.');
  process.exit(process.exitCode);
}

console.log('[garmin-verify] Garmin readiness verification passed.');
