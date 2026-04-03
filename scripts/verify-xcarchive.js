#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function usage() {
  console.log('Usage: node scripts/verify-xcarchive.js /path/to/Zenith.xcarchive');
  process.exit(2);
}

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readPlistAsJson(plistPath) {
  const jsonText = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8' });
  return JSON.parse(jsonText);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runOrThrow(bin, args, options = {}) {
  const res = spawnSync(bin, args, { encoding: 'utf8', ...options });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const stderr = (res.stderr || '').trim();
    const stdout = (res.stdout || '').trim();
    const tail = stderr || stdout || '';
    throw new Error(`${bin} failed (exit=${res.status})${tail ? `: ${tail}` : ''}`);
  }
  return res;
}

function codesignEntitlements(appPath) {
  try {
    const out = execFileSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', appPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out;
  } catch (error) {
    const stderr = (error && error.stderr ? String(error.stderr) : '').trim();
    throw new Error(`codesign entitlements failed for ${appPath}${stderr ? `: ${stderr}` : ''}`);
  }
}

function codesignDetails(appPath) {
  // `codesign -dvv` writes details to stderr on success.
  const res = runOrThrow('/usr/bin/codesign', ['-dvv', appPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  return `${res.stdout || ''}${res.stderr || ''}`.trim();
}

function plistJsonFromXml(xmlText) {
  const jsonText = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
    input: xmlText,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(jsonText);
}

function exportAppStoreIpa({ archivePath, expectedVersion, expectedBuild }) {
  const root = path.resolve(__dirname, '..');
  const exportOptionsPlist = path.join(root, 'ios', 'build', 'ExportOptions-appstore.plist');
  assert(exists(exportOptionsPlist), `Missing export options plist: ${exportOptionsPlist}`);

  const exportDir = path.join(root, 'ios', 'build', `export-appstore-${expectedVersion}-${expectedBuild}`);
  fs.rmSync(exportDir, { recursive: true, force: true });
  fs.mkdirSync(exportDir, { recursive: true });

  // Export may use Cloud Managed Apple Distribution certs even when no Apple Distribution identity exists in the login keychain.
  runOrThrow('/usr/bin/xcodebuild', [
    '-exportArchive',
    '-archivePath',
    archivePath,
    '-exportPath',
    exportDir,
    '-exportOptionsPlist',
    exportOptionsPlist,
    '-allowProvisioningUpdates',
  ]);

  const ipaFiles = fs.readdirSync(exportDir).filter((f) => f.toLowerCase().endsWith('.ipa'));
  assert(ipaFiles.length === 1, `Expected exactly 1 .ipa in export dir, found ${ipaFiles.length}: ${exportDir}`);
  const ipaPath = path.join(exportDir, ipaFiles[0]);

  const unzipDir = path.join(exportDir, 'unzipped');
  fs.rmSync(unzipDir, { recursive: true, force: true });
  fs.mkdirSync(unzipDir, { recursive: true });
  runOrThrow('/usr/bin/unzip', ['-q', ipaPath, '-d', unzipDir]);

  const iosAppPath = path.join(unzipDir, 'Payload', 'Zenith.app');
  const watchAppPath = path.join(iosAppPath, 'Watch', 'ZenithWatch Watch App.app');
  const widgetsAppexPath = path.join(iosAppPath, 'PlugIns', 'ZenithWidgetsExtension.appex');

  assert(exists(iosAppPath), `Missing iOS app in exported IPA: ${iosAppPath}`);
  assert(exists(watchAppPath), `Missing Watch app in exported IPA: ${watchAppPath}`);
  assert(exists(widgetsAppexPath), `Missing Widgets extension in exported IPA: ${widgetsAppexPath}`);

  return { exportDir, ipaPath, unzipDir, iosAppPath, watchAppPath, widgetsAppexPath };
}

function lipoInfo(binaryPath) {
  try {
    return execFileSync('/usr/bin/lipo', ['-info', binaryPath], { encoding: 'utf8' }).trim();
  } catch (error) {
    const stderr = (error && error.stderr ? String(error.stderr) : '').trim();
    return `lipo failed${stderr ? `: ${stderr}` : ''}`;
  }
}

function main() {
  const archivePath = process.argv[2];
  if (!archivePath || archivePath === '-h' || archivePath === '--help') usage();

  const absArchive = path.resolve(process.cwd(), archivePath);
  assert(exists(absArchive), `Archive not found: ${absArchive}`);
  assert(absArchive.endsWith('.xcarchive'), `Expected a .xcarchive path, got: ${absArchive}`);

  const root = path.resolve(__dirname, '..');
  const appConfig = readJson(path.join(root, 'app.json'));
  const expectedVersion = String(appConfig?.expo?.version || '');
  const expectedBuild = String(appConfig?.expo?.ios?.buildNumber || '');

  const iosAppPath = path.join(absArchive, 'Products', 'Applications', 'Zenith.app');
  const iosInfoPath = path.join(iosAppPath, 'Info.plist');
  assert(exists(iosInfoPath), `Missing iOS Info.plist in archive: ${iosInfoPath}`);

  const watchAppPath = path.join(iosAppPath, 'Watch', 'ZenithWatch Watch App.app');
  const watchInfoPath = path.join(watchAppPath, 'Info.plist');
  assert(exists(watchInfoPath), `Missing Watch app Info.plist in archive: ${watchInfoPath}`);

  const iosInfo = readPlistAsJson(iosInfoPath);
  const watchInfo = readPlistAsJson(watchInfoPath);

  const iosVersion = String(iosInfo.CFBundleShortVersionString || '');
  const iosBuild = String(iosInfo.CFBundleVersion || '');
  const watchVersion = String(watchInfo.CFBundleShortVersionString || '');
  const watchBuild = String(watchInfo.CFBundleVersion || '');

  assert(iosVersion === expectedVersion, `iOS version mismatch. archive=${iosVersion} expected=${expectedVersion}`);
  assert(iosBuild === expectedBuild, `iOS build mismatch. archive=${iosBuild} expected=${expectedBuild}`);
  assert(watchVersion === expectedVersion, `Watch version mismatch. archive=${watchVersion} expected=${expectedVersion}`);
  assert(watchBuild === expectedBuild, `Watch build mismatch. archive=${watchBuild} expected=${expectedBuild}`);

  assert(
    typeof watchInfo.NSHealthShareUsageDescription === 'string' && watchInfo.NSHealthShareUsageDescription.trim().length > 0,
    'Watch Info.plist missing NSHealthShareUsageDescription.'
  );
  assert(
    typeof watchInfo.NSHealthUpdateUsageDescription === 'string' && watchInfo.NSHealthUpdateUsageDescription.trim().length > 0,
    'Watch Info.plist missing NSHealthUpdateUsageDescription.'
  );
  assert(
    watchInfo.WKApplication === true,
    'Watch Info.plist must include WKApplication=true (standalone watchOS app marker).'
  );
  assert(!('WKWatchKitApp' in watchInfo), 'Watch Info.plist must not include WKWatchKitApp.');

  // Entitlements: iOS + Watch must include HealthKit.
  const iosEntXml = codesignEntitlements(iosAppPath);
  const watchEntXml = codesignEntitlements(watchAppPath);
  const iosEnt = plistJsonFromXml(iosEntXml);
  const watchEnt = plistJsonFromXml(watchEntXml);
  assert(iosEnt['com.apple.developer.healthkit'] === true, 'iOS app entitlements missing com.apple.developer.healthkit=true.');
  assert(watchEnt['com.apple.developer.healthkit'] === true, 'Watch app entitlements missing com.apple.developer.healthkit=true.');

  // Store/TestFlight signing verification happens on the exported IPA (not the raw archive),
  // because Xcode may archive with Apple Development then re-sign during export.
  const exportResult = exportAppStoreIpa({ archivePath: absArchive, expectedVersion, expectedBuild });

  const expIosEnt = plistJsonFromXml(codesignEntitlements(exportResult.iosAppPath));
  const expWatchEnt = plistJsonFromXml(codesignEntitlements(exportResult.watchAppPath));
  const expWidgetsEnt = plistJsonFromXml(codesignEntitlements(exportResult.widgetsAppexPath));

  assert(
    expIosEnt['aps-environment'] === 'production',
    `Exported IPA iOS entitlements must include aps-environment=production (got: ${String(expIosEnt['aps-environment'] || '')}).`
  );
  assert(
    expIosEnt['get-task-allow'] === 0 || expIosEnt['get-task-allow'] === false || expIosEnt['get-task-allow'] === undefined,
    `Exported IPA iOS get-task-allow must be false/0 (got: ${String(expIosEnt['get-task-allow'])}).`
  );
  assert(
    expWatchEnt['get-task-allow'] === 0 || expWatchEnt['get-task-allow'] === false || expWatchEnt['get-task-allow'] === undefined,
    `Exported IPA Watch get-task-allow must be false/0 (got: ${String(expWatchEnt['get-task-allow'])}).`
  );
  assert(
    expWidgetsEnt['get-task-allow'] === 0 || expWidgetsEnt['get-task-allow'] === false || expWidgetsEnt['get-task-allow'] === undefined,
    `Exported IPA Widgets get-task-allow must be false/0 (got: ${String(expWidgetsEnt['get-task-allow'])}).`
  );

  const expDetails = codesignDetails(exportResult.iosAppPath);
  assert(
    /Authority=(Apple Distribution|iPhone Distribution)\b/.test(expDetails),
    'Exported IPA must be signed with an Apple/iPhone Distribution identity (codesign -dvv did not include a Distribution authority).'
  );

  // Architectures (informational; App Store will enforce later for watchOS arm64).
  const iosExec = String(iosInfo.CFBundleExecutable || '');
  const watchExec = String(watchInfo.CFBundleExecutable || '');
  const iosBin = iosExec ? path.join(iosAppPath, iosExec) : null;
  const watchBin = watchExec ? path.join(watchAppPath, watchExec) : null;

  const iosArch = iosBin && exists(iosBin) ? lipoInfo(iosBin) : 'iOS executable not found';
  const watchArch = watchBin && exists(watchBin) ? lipoInfo(watchBin) : 'Watch executable not found';

  console.log('✅ Archive + exported IPA look upload-ready');
  console.log(`- Archive: ${absArchive}`);
  console.log(`- Version: ${expectedVersion}`);
  console.log(`- Build: ${expectedBuild}`);
  console.log(`- iOS entitlements: HealthKit ✅`);
  console.log(`- Watch entitlements: HealthKit ✅`);
  console.log(`- Export dir: ${exportResult.exportDir}`);
  console.log(`- Exported IPA: ${exportResult.ipaPath}`);
  console.log(`- Exported iOS signing: Apple Distribution ✅`);
  console.log(`- Exported iOS entitlements: aps-environment=production ✅ get-task-allow=false ✅`);
  console.log(`- iOS arch: ${iosArch}`);
  console.log(`- Watch arch: ${watchArch}`);
}

try {
  main();
} catch (error) {
  console.error(`❌ ${error?.message || String(error)}`);
  process.exit(1);
}
