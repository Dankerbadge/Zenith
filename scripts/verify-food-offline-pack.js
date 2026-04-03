#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'assets', 'food', 'offline-pack');
const MANIFEST_PATH = path.join(PACK_DIR, 'manifest.json');
const CHECKSUMS_PATH = path.join(PACK_DIR, 'checksums.json');
const ATTRIBUTION_PATH = path.join(PACK_DIR, 'attribution.json');

function mustExist(absPath, label) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`missing_${label}:${path.relative(ROOT, absPath)}`);
  }
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function sha256File(absPath) {
  const buffer = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function main() {
  mustExist(PACK_DIR, 'pack_dir');
  mustExist(MANIFEST_PATH, 'manifest');
  mustExist(CHECKSUMS_PATH, 'checksums');
  mustExist(ATTRIBUTION_PATH, 'attribution');

  const manifest = readJson(MANIFEST_PATH);
  const checksums = readJson(CHECKSUMS_PATH);

  const databaseRel = String(manifest?.files?.database || '').trim();
  const attributionRel = String(manifest?.files?.attribution || '').trim();
  const checksumsRel = String(manifest?.files?.checksums || '').trim();
  if (!databaseRel || !attributionRel || !checksumsRel) {
    throw new Error('manifest_files_missing');
  }

  const databasePath = path.join(PACK_DIR, databaseRel);
  const attributionPath = path.join(PACK_DIR, attributionRel);
  const checksumsPathFromManifest = path.join(PACK_DIR, checksumsRel);
  mustExist(databasePath, 'database');
  mustExist(attributionPath, 'attribution_from_manifest');
  mustExist(checksumsPathFromManifest, 'checksums_from_manifest');

  const expectedDb = String(checksums?.[databaseRel]?.sha256 || '').trim().toLowerCase();
  const expectedAttribution = String(checksums?.[attributionRel]?.sha256 || '').trim().toLowerCase();
  if (!expectedDb || !expectedAttribution) {
    throw new Error('checksum_entries_missing');
  }

  const actualDb = sha256File(databasePath);
  const actualAttribution = sha256File(attributionPath);
  if (actualDb !== expectedDb) {
    throw new Error(`database_checksum_mismatch:expected=${expectedDb}:actual=${actualDb}`);
  }
  if (actualAttribution !== expectedAttribution) {
    throw new Error(`attribution_checksum_mismatch:expected=${expectedAttribution}:actual=${actualAttribution}`);
  }

  if (!Number.isFinite(Number(manifest?.schemaVersion)) || Number(manifest.schemaVersion) < 2) {
    throw new Error('manifest_schema_version_invalid');
  }
  if (!Number.isFinite(Number(manifest?.protocolVersion)) || Number(manifest.protocolVersion) < 1) {
    throw new Error('manifest_protocol_version_invalid');
  }

  console.log('Food offline pack verification passed.');
  console.log(`- Pack directory: ${path.relative(ROOT, PACK_DIR)}`);
  console.log(`- Database: ${databaseRel}`);
  console.log(`- Attribution: ${attributionRel}`);
  console.log(`- Checksums validated: 2`);
}

main();
