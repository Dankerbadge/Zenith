#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'assets', 'food', 'offline-pack');
const DB_NAME = 'food_offline_pack.sqlite';
const MANIFEST_NAME = 'manifest.json';
const ATTRIBUTION_NAME = 'attribution.json';
const CHECKSUMS_NAME = 'checksums.json';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256File(absPath) {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function writeSqlitePack(dbPath) {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const sql = [
    'PRAGMA journal_mode=DELETE;',
    'PRAGMA foreign_keys=ON;',
    'CREATE TABLE foods (',
    '  id TEXT PRIMARY KEY,',
    '  source TEXT NOT NULL,',
    '  name TEXT NOT NULL,',
    '  calories_kcal REAL NOT NULL,',
    '  protein_g REAL NOT NULL,',
    '  carbs_g REAL NOT NULL,',
    '  fat_g REAL NOT NULL',
    ');',
    "INSERT INTO foods(id, source, name, calories_kcal, protein_g, carbs_g, fat_g) VALUES ('seed:egg','seed','Egg, whole',143,12.6,0.7,9.5);",
    "INSERT INTO foods(id, source, name, calories_kcal, protein_g, carbs_g, fat_g) VALUES ('seed:rice','seed','Rice, cooked',130,2.7,28.2,0.3);",
    "INSERT INTO foods(id, source, name, calories_kcal, protein_g, carbs_g, fat_g) VALUES ('seed:chicken','seed','Chicken breast, cooked',165,31.0,0.0,3.6);",
    'CREATE TABLE metadata (',
    '  key TEXT PRIMARY KEY,',
    '  value TEXT NOT NULL',
    ');',
    "INSERT INTO metadata(key, value) VALUES ('schema_version','3');",
    "INSERT INTO metadata(key, value) VALUES ('dataset_version','2026.03.26');",
  ].join('\n');
  execFileSync('sqlite3', [dbPath], { input: sql, stdio: 'pipe' });
}

function main() {
  ensureDir(PACK_DIR);

  const dbPath = path.join(PACK_DIR, DB_NAME);
  const manifestPath = path.join(PACK_DIR, MANIFEST_NAME);
  const attributionPath = path.join(PACK_DIR, ATTRIBUTION_NAME);
  const checksumsPath = path.join(PACK_DIR, CHECKSUMS_NAME);

  writeSqlitePack(dbPath);

  const attribution = {
    providers: [
      { key: 'usda', name: 'USDA FoodData Central', license: 'U.S. Government Works' },
      { key: 'off', name: 'Open Food Facts', license: 'ODbL 1.0' },
      { key: 'restaurant_seed', name: 'Zenith Seeded Restaurant Dataset', license: 'Internal QA Seed' },
    ],
    generatedAt: '2026-03-26T00:00:00.000Z',
  };
  fs.writeFileSync(attributionPath, JSON.stringify(attribution, null, 2) + '\n', 'utf8');

  const checksums = {
    [DB_NAME]: { sha256: sha256File(dbPath) },
    [ATTRIBUTION_NAME]: { sha256: sha256File(attributionPath) },
  };
  fs.writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2) + '\n', 'utf8');

  const manifest = {
    schemaVersion: 3,
    protocolVersion: 2,
    datasetVersion: '2026.03.26',
    generatedAt: '2026-03-26T00:00:00.000Z',
    files: {
      database: DB_NAME,
      attribution: ATTRIBUTION_NAME,
      checksums: CHECKSUMS_NAME,
    },
    compatibility: {
      minAppVersion: '3.8.0',
      minPackSchemaVersion: 2,
      maxPackSchemaVersion: 3,
      minSyncProtocolVersion: 1,
      maxSyncProtocolVersion: 2,
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log('Built food offline pack.');
  console.log(`- Directory: ${PACK_DIR}`);
  console.log(`- Database: ${DB_NAME}`);
  console.log(`- Manifest: ${MANIFEST_NAME}`);
  console.log(`- Attribution: ${ATTRIBUTION_NAME}`);
  console.log(`- Checksums: ${CHECKSUMS_NAME}`);
}

main();
