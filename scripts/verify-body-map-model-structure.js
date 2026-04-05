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
var geometryBounds: [[String: Any]] = []

func worldBounds(for node: SCNNode) -> (min: SCNVector3, max: SCNVector3)? {
  let (bmin, bmax) = node.boundingBox
  let corners = [
    SCNVector3(bmin.x, bmin.y, bmin.z), SCNVector3(bmin.x, bmin.y, bmax.z),
    SCNVector3(bmin.x, bmax.y, bmin.z), SCNVector3(bmin.x, bmax.y, bmax.z),
    SCNVector3(bmax.x, bmin.y, bmin.z), SCNVector3(bmax.x, bmin.y, bmax.z),
    SCNVector3(bmax.x, bmax.y, bmin.z), SCNVector3(bmax.x, bmax.y, bmax.z),
  ]

  var minV = SCNVector3(Float.greatestFiniteMagnitude, Float.greatestFiniteMagnitude, Float.greatestFiniteMagnitude)
  var maxV = SCNVector3(-Float.greatestFiniteMagnitude, -Float.greatestFiniteMagnitude, -Float.greatestFiniteMagnitude)

  for corner in corners {
    let world = node.convertPosition(corner, to: scene.rootNode)
    minV.x = min(minV.x, world.x)
    minV.y = min(minV.y, world.y)
    minV.z = min(minV.z, world.z)
    maxV.x = max(maxV.x, world.x)
    maxV.y = max(maxV.y, world.y)
    maxV.z = max(maxV.z, world.z)
  }

  if !minV.x.isFinite || !minV.y.isFinite || !minV.z.isFinite || !maxV.x.isFinite || !maxV.y.isFinite || !maxV.z.isFinite {
    return nil
  }
  return (minV, maxV)
}

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
      if let bounds = worldBounds(for: node) {
        let center = [
          (bounds.min.x + bounds.max.x) * 0.5,
          (bounds.min.y + bounds.max.y) * 0.5,
          (bounds.min.z + bounds.max.z) * 0.5,
        ]
        let size = [
          bounds.max.x - bounds.min.x,
          bounds.max.y - bounds.min.y,
          bounds.max.z - bounds.min.z,
        ]
        geometryBounds.append([
          "name": trimmed,
          "min": [bounds.min.x, bounds.min.y, bounds.min.z],
          "max": [bounds.max.x, bounds.max.y, bounds.max.z],
          "center": center,
          "size": size,
        ])
      }
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
  "geometryBounds": geometryBounds,
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
      geometryBounds: Array.isArray(parsed.geometryBounds)
        ? parsed.geometryBounds
            .map((entry) => ({
              name: String(entry?.name || ''),
              min: Array.isArray(entry?.min) ? entry.min.map((v) => Number(v || 0)) : [],
              max: Array.isArray(entry?.max) ? entry.max.map((v) => Number(v || 0)) : [],
              center: Array.isArray(entry?.center) ? entry.center.map((v) => Number(v || 0)) : [],
              size: Array.isArray(entry?.size) ? entry.size.map((v) => Number(v || 0)) : [],
            }))
            .filter(
              (entry) =>
                entry.name &&
                entry.min.length === 3 &&
                entry.max.length === 3 &&
                entry.center.length === 3 &&
                entry.size.length === 3 &&
                entry.min.every(Number.isFinite) &&
                entry.max.every(Number.isFinite) &&
                entry.center.every(Number.isFinite) &&
                entry.size.every(Number.isFinite)
            )
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

function distance3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
  const boundsByName = new Map(inspection.geometryBounds.map((entry) => [entry.name, entry]));
  const baseBodyBounds = boundsByName.get('BaseBody');
  const detachedShells = [];
  const leftRightMismatches = [];
  const anatomicalPairMismatches = [];

  if (baseBodyBounds) {
    const baseCenter = baseBodyBounds.center;
    const baseSpan = baseBodyBounds.max.map((value, index) => value - baseBodyBounds.min[index]);
    const pad = baseSpan.map((span) => Math.max(0.08, span * 0.22));
    const xMidlineTolerance = Math.max(0.015, baseSpan[0] * 0.03);
    const mirrorXTolerance = Math.max(0.08, baseSpan[0] * 0.35);
    const mirrorYZTolerance = Math.max(0.09, Math.max(baseSpan[1], baseSpan[2]) * 0.22);

    for (const key of REQUIRED_REGION_KEYS) {
      const region = boundsByName.get(key);
      if (!region) continue;
      const outOfBounds = region.center.some((value, axis) => {
        const minAllowed = baseBodyBounds.min[axis] - pad[axis];
        const maxAllowed = baseBodyBounds.max[axis] + pad[axis];
        return value < minAllowed || value > maxAllowed;
      });
      if (outOfBounds) {
        detachedShells.push(
          `${key}(center=${region.center.map((value) => value.toFixed(3)).join(',')})`
        );
      }

      if (key.endsWith('_L')) {
        const pairKey = `${key.slice(0, -2)}_R`;
        const pair = boundsByName.get(pairKey);
        if (!pair) continue;
        const leftX = region.center[0] - baseCenter[0];
        const rightX = pair.center[0] - baseCenter[0];
        if (leftX >= -xMidlineTolerance || rightX <= xMidlineTolerance) {
          leftRightMismatches.push(`${key}/${pairKey}(invalid side placement)`);
          continue;
        }
        const xMirrorDelta = Math.abs(Math.abs(leftX) - Math.abs(rightX));
        const yDelta = Math.abs(region.center[1] - pair.center[1]);
        const zDelta = Math.abs(region.center[2] - pair.center[2]);
        if (xMirrorDelta > mirrorXTolerance || yDelta > mirrorYZTolerance || zDelta > mirrorYZTolerance) {
          leftRightMismatches.push(
            `${key}/${pairKey}(mirror drift: x=${xMirrorDelta.toFixed(3)}, y=${yDelta.toFixed(3)}, z=${zDelta.toFixed(3)})`
          );
        }
      }
    }

    const anatomicalPairs = [
      ['DELTS_FRONT_L', 'DELTS_REAR_L', 0.045],
      ['DELTS_FRONT_R', 'DELTS_REAR_R', 0.045],
      ['BICEPS_L', 'TRICEPS_L', 0.04],
      ['BICEPS_R', 'TRICEPS_R', 0.04],
      ['QUADS_L', 'HAMSTRINGS_L', 0.06],
      ['QUADS_R', 'HAMSTRINGS_R', 0.06],
      ['TIBIALIS_L', 'CALVES_L', 0.06],
      ['TIBIALIS_R', 'CALVES_R', 0.06],
    ];
    for (const [aName, bName, minDistance] of anatomicalPairs) {
      const a = boundsByName.get(aName);
      const b = boundsByName.get(bName);
      if (!a || !b) continue;
      const distance = distance3(a.center, b.center);
      if (distance < minDistance) {
        anatomicalPairMismatches.push(
          `${aName}/${bName}(distance=${distance.toFixed(3)}, required>=${minDistance.toFixed(3)})`
        );
      }
    }
  }

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
  assert(baseBodyBounds, 'Could not resolve BaseBody world bounds from model geometry.');
  assert(
    detachedShells.length === 0,
    `Detached/off-body region shells detected: ${detachedShells.join(', ')}.`
  );
  assert(
    leftRightMismatches.length === 0,
    `Left/right region placement mismatches detected: ${leftRightMismatches.join(', ')}.`
  );
  assert(
    anatomicalPairMismatches.length === 0,
    `Anatomical pair separation mismatches detected: ${anatomicalPairMismatches.join(', ')}.`
  );

  console.log('Body-map model structure verification passed.');
  console.log(`- Total nodes: ${inspection.totalNodes}`);
  console.log(`- Geometry nodes: ${inspection.geometryNodes}`);
  console.log('- BaseBody present exactly once');
  console.log(`- Required region node names present: ${REQUIRED_REGION_KEYS.length}`);
  console.log('- No duplicate region names, no unexpected geometry names, no banned helper names');
  console.log('- Region shell centers are spatially aligned with BaseBody bounds');
  console.log('- Left/right region pairs stay on correct sides and mirror within tolerance');
  console.log('- Key front/back anatomical pairs are spatially distinct');
}

main();
