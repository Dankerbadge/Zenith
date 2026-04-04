const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REQUIRED_REGION_KEYS = [
  'CHEST_L',
  'CHEST_R',
  'DELTS_FRONT_L',
  'DELTS_FRONT_R',
  'DELTS_SIDE_L',
  'DELTS_SIDE_R',
  'DELTS_REAR_L',
  'DELTS_REAR_R',
  'BICEPS_L',
  'BICEPS_R',
  'TRICEPS_L',
  'TRICEPS_R',
  'FOREARMS_L',
  'FOREARMS_R',
  'UPPER_BACK_L',
  'UPPER_BACK_R',
  'LATS_L',
  'LATS_R',
  'TRAPS_L',
  'TRAPS_R',
  'ABS',
  'OBLIQUES_L',
  'OBLIQUES_R',
  'LOWER_BACK',
  'GLUTES_L',
  'GLUTES_R',
  'HIP_FLEXORS_L',
  'HIP_FLEXORS_R',
  'ADDUCTORS_L',
  'ADDUCTORS_R',
  'QUADS_L',
  'QUADS_R',
  'HAMSTRINGS_L',
  'HAMSTRINGS_R',
  'CALVES_L',
  'CALVES_R',
  'TIBIALIS_L',
  'TIBIALIS_R',
  'NECK',
];

const BANNED_NAME_PATTERNS = [
  /\barmature\b/i,
  /\bmetarig\b/i,
  /\bmixamorig\b/i,
  /\bskeleton\b/i,
  /\bhelper\b/i,
  /\blocator\b/i,
  /\bnull\b/i,
  /\bcontrol\b/i,
  /\bctrl\b/i,
  /\bproxy\b/i,
  /\bbone\b/i,
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildSwiftInspectorScript() {
  return `
import Foundation
import SceneKit

if CommandLine.arguments.count < 2 {
  fputs("usage: inspect <assetPath>\\n", stderr)
  exit(2)
}

let assetPath = CommandLine.arguments[1]
let assetURL = URL(fileURLWithPath: assetPath)

guard let scene = try? SCNScene(url: assetURL, options: nil) else {
  fputs("failed_to_load\\n", stderr)
  exit(3)
}

var totalNodes = 0
var geometryNodes = 0
var names: [String] = []
var geometryNodeNames: [String] = []

func walk(_ node: SCNNode) {
  totalNodes += 1

  let trimmed = node.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  if !trimmed.isEmpty {
    names.append(trimmed)
  }

  if node.geometry != nil {
    geometryNodes += 1
    if !trimmed.isEmpty {
      geometryNodeNames.append(trimmed)
    }
  }

  for child in node.childNodes {
    walk(child)
  }
}

walk(scene.rootNode)

let payload: [String: Any] = [
  "totalNodes": totalNodes,
  "geometryNodes": geometryNodes,
  "names": names,
  "geometryNodeNames": geometryNodeNames,
]

let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
`;
}

function inspectModel(assetPath) {
  const swiftPath = path.join(
    os.tmpdir(),
    `zenith-body-map-inspect-${process.pid}-${Date.now()}.swift`
  );

  try {
    fs.writeFileSync(swiftPath, buildSwiftInspectorScript(), 'utf8');
    const result = spawnSync('xcrun', ['swift', swiftPath, assetPath], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.status !== 0) {
      const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      throw new Error(
        `Failed to inspect body-map model with SceneKit (exit ${result.status}).${
          details ? `\n${details}` : ''
        }`
      );
    }

    const parsed = JSON.parse(result.stdout);
    return {
      totalNodes: Number(parsed.totalNodes || 0),
      geometryNodes: Number(parsed.geometryNodes || 0),
      names: Array.isArray(parsed.names) ? parsed.names.map(String) : [],
      geometryNodeNames: Array.isArray(parsed.geometryNodeNames)
        ? parsed.geometryNodeNames.map(String)
        : [],
    };
  } finally {
    if (fs.existsSync(swiftPath)) {
      fs.unlinkSync(swiftPath);
    }
  }
}

function collectCounts(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const assetPath = path.join(root, 'ios', 'Zenith', 'BodyMapModel.usdz');

  assert(fs.existsSync(assetPath), 'Missing ios/Zenith/BodyMapModel.usdz.');

  const inspection = inspectModel(assetPath);
  const allNameCounts = collectCounts(inspection.names);
  const geometryNameCounts = collectCounts(inspection.geometryNodeNames);

  const missingRegions = REQUIRED_REGION_KEYS.filter((key) => !allNameCounts.has(key));
  const duplicateRegions = REQUIRED_REGION_KEYS.filter((key) => (allNameCounts.get(key) || 0) > 1);

  const baseBodyCount = allNameCounts.get('BaseBody') || 0;
  const duplicateGeometryNames = [...geometryNameCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);

  const bannedNames = inspection.names.filter((name) =>
    BANNED_NAME_PATTERNS.some((pattern) => pattern.test(name))
  );

  const allowedGeometryNames = new Set(['BaseBody', ...REQUIRED_REGION_KEYS]);
  const unexpectedGeometryNames = inspection.geometryNodeNames.filter(
    (name) => !allowedGeometryNames.has(name)
  );

  assert(
    inspection.totalNodes >= 40 && inspection.totalNodes <= 200,
    `Unexpected total node count (${inspection.totalNodes}); expected 40..200.`
  );
  assert(
    inspection.geometryNodes >= REQUIRED_REGION_KEYS.length + 1 &&
      inspection.geometryNodes <= 120,
    `Unexpected geometry node count (${inspection.geometryNodes}); expected ${
      REQUIRED_REGION_KEYS.length + 1
    }..120.`
  );
  assert(baseBodyCount === 1, `Expected exactly one BaseBody node, found ${baseBodyCount}.`);
  assert(missingRegions.length === 0, `Missing required region nodes: ${missingRegions.join(', ')}.`);
  assert(
    duplicateRegions.length === 0,
    `Duplicate required region node names detected: ${duplicateRegions.join(', ')}.`
  );
  assert(
    duplicateGeometryNames.length === 0,
    `Duplicate geometry node names detected: ${duplicateGeometryNames.join(', ')}.`
  );
  assert(
    unexpectedGeometryNames.length === 0,
    `Unexpected geometry node names: ${unexpectedGeometryNames.join(', ')}.`
  );
  assert(
    bannedNames.length === 0,
    `Banned helper/export junk node names detected: ${[...new Set(bannedNames)].join(', ')}.`
  );

  console.log('Body-map model structure verification passed.');
  console.log(`- Total nodes: ${inspection.totalNodes}`);
  console.log(`- Geometry nodes: ${inspection.geometryNodes}`);
  console.log('- BaseBody present exactly once');
  console.log(`- Required region node names present: ${REQUIRED_REGION_KEYS.length}`);
  console.log('- No duplicate region names, no unexpected geometry names, no banned helper names');
}

main();
