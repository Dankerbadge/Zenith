#!/usr/bin/env node
/* eslint-disable no-console */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readPlistAsJson(plistPath) {
  const jsonText = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8' });
  return JSON.parse(jsonText);
}

function readEntitlementsAsText(appPath) {
  try {
    return execFileSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', appPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    throw new Error(`Failed to read entitlements for ${appPath}: ${String(e?.message || e)}`);
  }
}

function main() {
  const archivePath = process.argv[2];
  if (!archivePath) {
    console.error('Usage: node scripts/verify-xcarchive-healthkit.js <path-to.xcarchive>');
    process.exit(2);
  }

  const absArchivePath = path.resolve(process.cwd(), archivePath);
  assert(fs.existsSync(absArchivePath), `Archive not found: ${absArchivePath}`);

  const zenithAppPath = path.join(absArchivePath, 'Products', 'Applications', 'Zenith.app');
  const watchAppPath = path.join(zenithAppPath, 'Watch', 'ZenithWatch Watch App.app');

  assert(fs.existsSync(zenithAppPath), `Missing iOS app in archive: ${zenithAppPath}`);
  assert(fs.existsSync(watchAppPath), `Missing Watch app in archive: ${watchAppPath}`);

  const iosInfo = readPlistAsJson(path.join(zenithAppPath, 'Info.plist'));
  const watchInfo = readPlistAsJson(path.join(watchAppPath, 'Info.plist'));

  const iosVersion = String(iosInfo.CFBundleShortVersionString || '');
  const iosBuild = String(iosInfo.CFBundleVersion || '');
  const watchVersion = String(watchInfo.CFBundleShortVersionString || '');
  const watchBuild = String(watchInfo.CFBundleVersion || '');

  assert(iosVersion.length > 0 && iosBuild.length > 0, 'iOS app missing CFBundleShortVersionString/CFBundleVersion');
  assert(watchVersion.length > 0 && watchBuild.length > 0, 'Watch app missing CFBundleShortVersionString/CFBundleVersion');

  assert(
    watchInfo.WKApplication === true || (watchInfo.WKApplication && typeof watchInfo.WKApplication === 'object'),
    'Watch Info.plist must include WKApplication (standalone watchOS app marker).'
  );
  assert(!('WKWatchKitApp' in watchInfo), 'Watch Info.plist must not include WKWatchKitApp.');

  assert(
    typeof watchInfo.NSHealthShareUsageDescription === 'string' && watchInfo.NSHealthShareUsageDescription.trim().length > 0,
    'Watch Info.plist missing NSHealthShareUsageDescription.'
  );
  assert(
    typeof watchInfo.NSHealthUpdateUsageDescription === 'string' && watchInfo.NSHealthUpdateUsageDescription.trim().length > 0,
    'Watch Info.plist missing NSHealthUpdateUsageDescription.'
  );

  // Version/build parity reduces App Store Connect validation weirdness.
  assert(iosVersion === watchVersion, `Version mismatch: iOS=${iosVersion} Watch=${watchVersion}`);
  assert(iosBuild === watchBuild, `Build mismatch: iOS=${iosBuild} Watch=${watchBuild}`);

  const iosEnt = readEntitlementsAsText(zenithAppPath);
  const watchEnt = readEntitlementsAsText(watchAppPath);

  assert(/com\\.apple\\.developer\\.healthkit/.test(iosEnt), 'iOS app entitlements missing com.apple.developer.healthkit');
  assert(/com\\.apple\\.developer\\.healthkit/.test(watchEnt), 'Watch app entitlements missing com.apple.developer.healthkit');

  console.log('XCArchive HealthKit verification passed.');
  console.log(`- iOS: v${iosVersion} (${iosBuild})`);
  console.log(`- Watch: v${watchVersion} (${watchBuild})`);
  console.log('- WKApplication present; WKWatchKitApp absent');
  console.log('- HealthKit entitlements present in iOS + Watch');
}

main();

