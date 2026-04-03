#!/usr/bin/env node
/* eslint-disable no-console */

// Runtime guardrails for the live run GPS engine.
// This intentionally tests the executable behavior (not just config wiring)
// to prevent regressions that would materially impact run accuracy.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const ENGINE_FILE = path.join(ROOT, 'utils', 'gpsService.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const moduleCache = new Map();

function resolveModulePath(fromFile, request) {
  if (path.isAbsolute(request)) return request;
  return path.resolve(path.dirname(fromFile), request);
}

function resolveTsOrJs(fromFile, request) {
  const base = resolveModulePath(fromFile, request);
  // If the request includes an extension, trust it.
  if (path.extname(base)) return base;

  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.json`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }

  // Fall back to the unresolved path so the caller gets a meaningful error.
  return base;
}

function loadTsModule(absPath) {
  if (moduleCache.has(absPath)) return moduleCache.get(absPath).exports;

  const source = fs.readFileSync(absPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: absPath,
  }).outputText;

  const moduleRef = { exports: {} };
  moduleCache.set(absPath, moduleRef);

  const script = new vm.Script(transpiled, { filename: absPath });
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require: (id) => requireFrom(absPath, id),
    console,
    process,
  };
  vm.createContext(sandbox);
  script.runInContext(sandbox);
  return moduleRef.exports;
}

function requireFrom(parentFile, id) {
  // gpsService imports native Expo modules that aren't available under Node.
  if (id === 'expo-location') return {};
  if (id === './crashReporter') return { captureException: async () => {} };

  // Relative/absolute imports: load TS via the transpile+vm loader.
  if (id.startsWith('.') || path.isAbsolute(id)) {
    const resolved = resolveTsOrJs(parentFile, id);
    if (resolved.endsWith('.ts') || resolved.endsWith('.tsx')) {
      return loadTsModule(resolved);
    }
    // JSON or JS modules can be loaded through Node.
    return require(resolved);
  }

  // Node/external deps.
  return require(id);
}

function loadModuleFromTs(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const script = new vm.Script(transpiled, { filename: filePath });
  const moduleRef = { exports: {} };

  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    require: (id) => requireFrom(filePath, id),
    console,
    process,
  };
  vm.createContext(sandbox);
  script.runInContext(sandbox);
  return moduleRef.exports;
}

function latDeltaForMiles(miles) {
  // Rough conversion: 1 degree latitude ~= 69 miles.
  return miles / 69;
}

function point({ lat, lon, tMs, accM, speedMps }) {
  return {
    latitude: lat,
    longitude: lon,
    timestamp: tMs,
    altitude: null,
    accuracy: accM == null ? null : accM,
    speed: speedMps == null ? null : speedMps,
  };
}

function main() {
  const mod = loadModuleFromTs(ENGINE_FILE);
  const create = mod.createRunTrackingEngine;
  const update = mod.updateRunTrackingEngine;

  assert(typeof create === 'function', 'gpsService.ts must export createRunTrackingEngine(priority).');
  assert(typeof update === 'function', 'gpsService.ts must export updateRunTrackingEngine(state, point, activeTimeSec).');

  const baseLat = 40.0;
  const baseLon = -74.0;

  // 1) First sample is accepted but adds no distance.
  let state = create('accuracy');
  let out = update(state, point({ lat: baseLat, lon: baseLon, tMs: 0, accM: 10, speedMps: null }), 0);
  assert(out.metrics.totalDistanceMiles === 0, 'First point must not add distance.');
  assert(out.metrics.includePointInRoute === true, 'First point should be eligible for route capture.');
  assert(out.metrics.paceState === 'acquiring', 'Initial pace state should be acquiring.');
  state = out.state;

  // 2) A normal, high-confidence segment integrates distance.
  const stepMiles = 0.010; // ~52 feet
  out = update(
    state,
    point({ lat: baseLat + latDeltaForMiles(stepMiles), lon: baseLon, tMs: 5000, accM: 10, speedMps: null }),
    5
  );
  assert(out.metrics.distanceDeltaMiles > 0, 'Normal segment should integrate distance.');
  assert(out.metrics.totalDistanceMiles > 0, 'Total distance should increase for a normal segment.');
  // Critical regression check: when speed is missing (null), the engine must not treat it as 0 and "fuse" it.
  assert(out.metrics.sourceTag === 'gps', 'Missing speed must not force fused speed (expected sourceTag=gps).');
  state = out.state;

  // 3) After enough samples + time, pace should become confident.
  out = update(
    state,
    point({ lat: baseLat + latDeltaForMiles(stepMiles * 2), lon: baseLon, tMs: 10000, accM: 10, speedMps: null }),
    10
  );
  state = out.state;
  out = update(
    state,
    point({ lat: baseLat + latDeltaForMiles(stepMiles * 3), lon: baseLon, tMs: 15000, accM: 10, speedMps: null }),
    15
  );
  assert(out.metrics.paceState === 'live_confident', 'After stable samples/time, pace should be live_confident.');
  state = out.state;

  // 4) Teleport jump must be rejected (no distance + no route include).
  out = update(
    state,
    point({ lat: baseLat + latDeltaForMiles(0.7), lon: baseLon, tMs: 17000, accM: 10, speedMps: null }),
    17
  );
  assert(out.metrics.distanceDeltaMiles === 0, 'Teleport segment must not add distance.');
  assert(out.metrics.includePointInRoute === false, 'Teleport segment must not be included in route.');
  state = out.state;

  // 5) Low confidence (but not reject-level) should not integrate distance in accuracy priority.
  out = update(
    state,
    point({ lat: baseLat + latDeltaForMiles(stepMiles * 4), lon: baseLon, tMs: 22000, accM: 40, speedMps: null }),
    22
  );
  assert(out.metrics.gpsConfidence === 'low', 'Accuracy 40m should map to low confidence.');
  assert(out.metrics.distanceDeltaMiles === 0, 'Low-confidence segments must not add distance in accuracy mode.');

  // 6) In responsiveness priority, low confidence segments can still integrate (when not outliers).
  let resp = create('responsiveness');
  resp = update(resp, point({ lat: baseLat, lon: baseLon, tMs: 0, accM: 10, speedMps: null }), 0).state;
  out = update(
    resp,
    point({ lat: baseLat + latDeltaForMiles(stepMiles), lon: baseLon, tMs: 5000, accM: 40, speedMps: null }),
    15
  );
  assert(out.metrics.distanceDeltaMiles > 0, 'Low-confidence segments should integrate in responsiveness mode.');

  // 7) Large gaps should not integrate across "lost" windows.
  let gap = create('accuracy');
  gap = update(gap, point({ lat: baseLat, lon: baseLon, tMs: 0, accM: 10, speedMps: null }), 0).state;
  out = update(
    gap,
    point({ lat: baseLat + latDeltaForMiles(stepMiles), lon: baseLon, tMs: 30000, accM: 10, speedMps: null }),
    30
  );
  assert(out.metrics.distanceDeltaMiles === 0, 'Segments after large gaps must not integrate distance.');

  console.log('Run tracking engine verification passed.');
  console.log('- Distance integrates only when confidence rules allow');
  console.log('- Teleports and lost-gaps are rejected');
  console.log('- Missing speed is treated as missing (not fused-as-zero)');
  console.log('- Pace state transitions to live_confident after stabilization');
}

main();
