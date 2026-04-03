const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const root = path.resolve(__dirname, '..');
  const assetPath = path.join(root, 'ios', 'Zenith', 'BodyMapModel.usdz');
  const pbxprojPath = path.join(root, 'ios', 'Zenith.xcodeproj', 'project.pbxproj');

  assert(fs.existsSync(assetPath), 'Missing ios/Zenith/BodyMapModel.usdz.');
  assert(fs.existsSync(pbxprojPath), 'Missing iOS project file: ios/Zenith.xcodeproj/project.pbxproj.');

  const pbxprojText = fs.readFileSync(pbxprojPath, 'utf8');
  assert(
    /BodyMapModel\.usdz \*\/ = \{isa = PBXFileReference;[^}]*path = Zenith\/BodyMapModel\.usdz;/m.test(pbxprojText),
    'project.pbxproj is missing PBXFileReference for BodyMapModel.usdz.'
  );
  assert(
    /BodyMapModel\.usdz in Resources \*\/ = \{isa = PBXBuildFile;[^}]*BodyMapModel\.usdz/m.test(pbxprojText),
    'project.pbxproj is missing PBXBuildFile entry for BodyMapModel.usdz in Resources.'
  );

  const resourcesSectionMatch = pbxprojText.match(
    /\/\* Begin PBXResourcesBuildPhase section \*\/[\s\S]*?\/\* End PBXResourcesBuildPhase section \*\//
  );
  assert(resourcesSectionMatch, 'project.pbxproj missing PBXResourcesBuildPhase section.');
  assert(
    resourcesSectionMatch[0].includes('BodyMapModel.usdz in Resources'),
    'BodyMapModel.usdz is not included in any PBXResourcesBuildPhase files list.'
  );

  console.log('Body-map asset verification passed.');
  console.log('- BodyMapModel.usdz exists in ios/Zenith');
  console.log('- Xcode file reference is present');
  console.log('- Build file wiring exists in Resources');
}

main();
