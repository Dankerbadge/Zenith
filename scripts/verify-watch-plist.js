const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function readPlistAsJson(plistPath) {
  const jsonText = execFileSync(
    '/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', plistPath],
    { encoding: 'utf8' }
  );
  return JSON.parse(jsonText);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const root = path.resolve(__dirname, '..');
  const watchInfoPlistPath = path.join(
    root,
    'ios',
    'ZenithWatch Watch App',
    'Info.plist'
  );
  const watchEntitlementsPath = path.join(
    root,
    'ios',
    'ZenithWatch Watch App',
    'ZenithWatch.entitlements'
  );
  const pbxprojPath = path.join(root, 'ios', 'Zenith.xcodeproj', 'project.pbxproj');

  const watchInfo = readPlistAsJson(watchInfoPlistPath);
  const watchEntitlements = readPlistAsJson(watchEntitlementsPath);
  const pbxprojText = fs.readFileSync(pbxprojPath, 'utf8');

  assert(
    typeof watchInfo.NSHealthShareUsageDescription === 'string' &&
      watchInfo.NSHealthShareUsageDescription.trim().length > 0,
    'Watch Info.plist missing NSHealthShareUsageDescription.'
  );
  assert(
    typeof watchInfo.NSHealthUpdateUsageDescription === 'string' &&
      watchInfo.NSHealthUpdateUsageDescription.trim().length > 0,
    'Watch Info.plist missing NSHealthUpdateUsageDescription.'
  );

  assert(
    watchInfo.WKApplication === true ||
      (watchInfo.WKApplication && typeof watchInfo.WKApplication === 'object'),
    'Watch Info.plist must include WKApplication (standalone watchOS app marker).'
  );
  assert(
    !('WKWatchKitApp' in watchInfo),
    'Watch Info.plist must not include WKWatchKitApp (would imply a WatchKit extension requirement).'
  );
  assert(
    typeof watchInfo.WKCompanionAppBundleIdentifier === 'string' &&
      watchInfo.WKCompanionAppBundleIdentifier.trim().length > 0,
    'Watch Info.plist missing WKCompanionAppBundleIdentifier.'
  );
  assert(
    watchInfo.CFBundleIconName === 'AppIcon',
    'Watch Info.plist missing CFBundleIconName=AppIcon (required for Watch icon asset selection).'
  );

  assert(
    watchEntitlements['com.apple.developer.healthkit'] === true,
    'Watch entitlements must include com.apple.developer.healthkit=true.'
  );
  assert(
    new RegExp('CODE_SIGN_ENTITLEMENTS\\s*=\\s*\"ZenithWatch Watch App/ZenithWatch\\.entitlements\";').test(pbxprojText),
    'Watch target must set CODE_SIGN_ENTITLEMENTS = "ZenithWatch Watch App/ZenithWatch.entitlements" in project.pbxproj.'
  );

  // Watch icons: App Store Connect validation requires a Watch App icon set and CFBundleIconName.
  const watchAssetsAppIcon = path.join(root, 'ios', 'ZenithWatch Watch App', 'Assets.xcassets', 'AppIcon.appiconset');
  assert(fs.existsSync(watchAssetsAppIcon), 'Missing Watch App icon set: ios/ZenithWatch Watch App/Assets.xcassets/AppIcon.appiconset');
  const watchAppIconContents = path.join(watchAssetsAppIcon, 'Contents.json');
  assert(fs.existsSync(watchAppIconContents), 'Missing Watch App icon Contents.json in AppIcon.appiconset');
  const iconJson = JSON.parse(fs.readFileSync(watchAppIconContents, 'utf8'));
  assert(Array.isArray(iconJson.images) && iconJson.images.length > 0, 'Watch App icon Contents.json has no images entries.');

  const requiredFilenames = [
    'AppIcon-1024.png',
    'AppIcon24x24@2x.png',
    'AppIcon27.5x27.5@2x.png',
    'AppIcon29x29@2x.png',
    'AppIcon29x29@3x.png',
    'AppIcon40x40@2x.png',
    'AppIcon44x44@2x.png',
    // App Store Connect-required watch icon slots (Series 4/5+ validation).
    'AppIcon50x50@2x.png',
    'AppIcon86x86@2x.png',
    'AppIcon98x98@2x.png',
    'AppIcon108x108@2x.png',
  ];
  for (const fn of requiredFilenames) {
    assert(fs.existsSync(path.join(watchAssetsAppIcon, fn)), `Missing Watch App icon file: ${fn}`);
  }

  const has44mmLongLook = iconJson.images.some(
    (img) =>
      img &&
      img.idiom === 'watch' &&
      img.role === 'longLook' &&
      img.subtype === '44mm' &&
      img.size === '50x50' &&
      img.scale === '2x' &&
      img.filename === 'AppIcon50x50@2x.png'
  );
  assert(has44mmLongLook, 'Watch App icon set missing required 44mm longLook icon (50x50@2x).');

  // Apple validates Long Look 42mm as a *44x44@2x.png icon. In practice, actool will only emit the
  // 88x88 rendition when a 40mm 44x44@2x slot is also present, so we require both.
  const has40mmLongLook44 = iconJson.images.some(
    (img) =>
      img &&
      img.idiom === 'watch' &&
      img.role === 'longLook' &&
      img.subtype === '40mm' &&
      img.size === '44x44' &&
      img.scale === '2x' &&
      img.filename === 'AppIcon44x44@2x.png'
  );
  assert(has40mmLongLook44, 'Watch App icon set missing required 40mm longLook icon (44x44@2x -> AppIcon44x44@2x.png).');

  const has42mmLongLook = iconJson.images.some(
    (img) =>
      img &&
      img.idiom === 'watch' &&
      img.role === 'longLook' &&
      img.subtype === '42mm' &&
      img.size === '44x44' &&
      img.scale === '2x' &&
      img.filename === 'AppIcon44x44@2x.png'
  );
  assert(has42mmLongLook, 'Watch App icon set missing required 42mm longLook icon (44x44@2x).');

  const has44mmQuickLook = iconJson.images.some(
    (img) =>
      img &&
      img.idiom === 'watch' &&
      img.role === 'quickLook' &&
      img.subtype === '44mm' &&
      img.size === '108x108' &&
      img.scale === '2x' &&
      img.filename === 'AppIcon108x108@2x.png'
  );
  assert(has44mmQuickLook, 'Watch App icon set missing required 44mm quickLook icon (108x108@2x).');

  // Ensure we have at least one non-marketing Watch icon entry.
  const hasWatchRoleIcon = iconJson.images.some((img) => img && img.idiom === 'watch' && typeof img.filename === 'string' && img.filename.length > 0);
  assert(hasWatchRoleIcon, 'Watch App icon set must include at least one idiom=watch entry (not only watch-marketing).');

  console.log('Watch Info.plist verification passed.');
  console.log('- WKApplication present');
  console.log('- WKWatchKitApp absent');
  console.log('- Health purpose strings present');
  console.log('- Watch HealthKit entitlement present');
  console.log('- Watch App icons present + CFBundleIconName set');
}

main();
