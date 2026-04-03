#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'utils', 'runStateMachine.ts');

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
    require,
    console,
  };
  vm.createContext(sandbox);
  script.runInContext(sandbox);
  return moduleRef.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const mod = loadModuleFromTs(STATE_FILE);
  assert(typeof mod.canTransition === 'function', 'runStateMachine.ts must export canTransition(from, to).');

  const can = mod.canTransition;
  const states = ['idle', 'ready', 'tracking', 'paused', 'ended', 'saved', 'discarded'];

  const requiredTrue = [
    ['idle', 'ready'],
    ['ready', 'tracking'],
    ['ready', 'discarded'],
    ['tracking', 'paused'],
    ['tracking', 'ended'],
    ['paused', 'tracking'],
    ['paused', 'ended'],
    ['ended', 'saved'],
    ['ended', 'discarded'],
  ];

  const requiredFalse = [
    ['ready', 'ended'],
    ['tracking', 'saved'],
    ['tracking', 'discarded'],
    ['paused', 'saved'],
    ['paused', 'discarded'],
    ['saved', 'tracking'],
    ['discarded', 'tracking'],
  ];

  for (const [from, to] of requiredTrue) {
    assert(can(from, to) === true, `Expected allowed transition ${from} -> ${to}`);
  }
  for (const [from, to] of requiredFalse) {
    assert(can(from, to) === false, `Expected blocked transition ${from} -> ${to}`);
  }

  for (const to of states) {
    assert(can('saved', to) === false, `saved must have no outgoing transitions (found saved -> ${to})`);
    assert(can('discarded', to) === false, `discarded must have no outgoing transitions (found discarded -> ${to})`);
  }

  console.log('Run lifecycle verification passed.');
  console.log('- Required transitions validated');
  console.log('- Invalid transitions blocked');
  console.log('- Terminal states locked');
}

main();
