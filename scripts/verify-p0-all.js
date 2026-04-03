#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`Missing ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

function mustInclude(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`Missing ${label}: ${needle}`);
  }
}

function mustMatch(haystack, regex, label) {
  if (!regex.test(haystack)) {
    throw new Error(`Missing ${label}: ${String(regex)}`);
  }
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function main() {
  console.log('P0 ALL: static checks');

  const home = read('app/(tabs)/index.tsx');
  mustInclude(home, "label: 'Log Walk'", 'Home quick action label');

  const actionCard = read('components/ui/ActionCard.tsx');
  mustInclude(actionCard, 'pressRetentionOffset', 'ActionCard press retention offset');

  const chip = read('components/ui/Chip.tsx');
  mustInclude(chip, 'pressRetentionOffset', 'Chip press retention offset');
  mustInclude(chip, "style={({ pressed }) =>", 'Chip pressed style is local');

  const metricCard = read('components/ui/MetricCard.tsx');
  mustInclude(metricCard, 'pressRetentionOffset', 'MetricCard press retention offset');

  // Stats is no longer a main tab. Ensure the old tab route is removed and deep-links route to Progress hub.
  const tabsStats = path.join(ROOT, 'app/(tabs)/stats.tsx');
  if (fs.existsSync(tabsStats)) {
    throw new Error('Stats must not be in the main tab bar (app/(tabs)/stats.tsx should not exist)');
  }
  const statsIndex = read('app/stats/index.tsx');
  mustInclude(statsIndex, '/account/progress', 'Stats route redirects to Progress hub');
  const tabLayout = read('app/(tabs)/_layout.tsx');
  if (tabLayout.includes('name="stats"') || tabLayout.includes("name='stats'")) {
    throw new Error('Stats must not be registered as a Tabs.Screen');
  }

  const community = read('app/(tabs)/community/index.tsx');
  mustMatch(
    community,
    /type\s+CommunityTopTab\s*=\s*'friends'\s*\|\s*'groups'/,
    'Community Friends/Groups segmented tabs'
  );
  mustInclude(community, 'SOCIAL_FEATURES_ENABLED', 'Community socialEnabled gating');

  const health = read('app/health-permissions.tsx');
  mustInclude(health, 'actionStack', 'Health action stack layout');
  mustInclude(health, 'pressRetentionOffset', 'Health buttons press retention offset');
  mustInclude(health, "style={({ pressed }) =>", 'Health buttons pressed style function');

  const gps = read('utils/gpsService.ts');
  mustInclude(gps, 'APP_CONFIG.LIVE_TRACKING.RUN.ACCURACY_REJECT_METERS', 'GPS accuracy hard reject');
  mustInclude(gps, 'APP_CONFIG.LIVE_TRACKING.RUN.GAP_ESTIMATION_MAX_SEC', 'GPS stale sample guard');
  mustInclude(gps, 'APP_CONFIG.LIVE_TRACKING.RUN.GPS_STATE.LOST_AFTER_SEC', 'GPS lost-stream guard');
  mustInclude(gps, 'const sensorWeight', 'GPS Doppler/sensor speed weighting');

  console.log('P0 ALL: run gates');
  run('node', [path.join(ROOT, 'scripts/verify-live-tracking-calibration.js')]);
  run('node', [path.join(ROOT, 'scripts/verify-watch-plist.js')]);

  // Optional native build gate.
  // In this repo, CocoaPods/Xcode project compatibility can break local xcodebuild even when
  // the JS/TS + Watch Swift sources are correct. Only run this if explicitly enabled.
  if (process.env.ZENITH_VERIFY_XCODEBUILD === '1') {
    run(
      'xcodebuild',
      [
        '-workspace',
        path.join(ROOT, 'ios/Zenith.xcworkspace'),
        '-scheme',
        'ZenithWatch Watch App',
        '-configuration',
        'Debug',
        '-destination',
        'generic/platform=watchOS Simulator',
        'ARCHS=arm64',
        'ONLY_ACTIVE_ARCH=YES',
        'build',
      ],
      { cwd: path.join(ROOT, 'ios') }
    );
  } else {
    console.log('P0 ALL: skipping xcodebuild (set ZENITH_VERIFY_XCODEBUILD=1 to enable)');
  }

  run('npm', ['run', '-s', 'verify:ship-lock'], { cwd: ROOT });
  console.log('P0 ALL PASSED');
}

main();
