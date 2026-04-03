#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function normalizeRel(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

function collectFilesystemArtifacts(startDir) {
  const out = [];
  const stack = [startDir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.startsWith('._')) {
        out.push(normalizeRel(full));
      }
    }
  }
  return out.sort();
}

function runGit(args) {
  return spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isGitRepository() {
  const res = runGit(['rev-parse', '--is-inside-work-tree']);
  return res.status === 0 && String(res.stdout || '').trim() === 'true';
}

function parseNullSeparatedPaths(output) {
  return String(output || '')
    .split('\0')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.split(path.sep).join('/'));
}

function listGitArtifacts(args) {
  const res = runGit(args);
  if (res.status !== 0) {
    return [];
  }
  return parseNullSeparatedPaths(res.stdout)
    .filter((rel) => path.basename(rel).startsWith('._'))
    .sort();
}

function printSection(title, rows) {
  if (!rows.length) return;
  console.error(`${title} (${rows.length})`);
  for (const row of rows) {
    console.error(`- ${row}`);
  }
}

function main() {
  const filesystemArtifacts = collectFilesystemArtifacts(ROOT);
  let trackedArtifacts = [];
  let untrackedArtifacts = [];
  const gitRepo = isGitRepository();

  if (gitRepo) {
    trackedArtifacts = listGitArtifacts(['ls-files', '-z']);
    untrackedArtifacts = listGitArtifacts(['ls-files', '--others', '--exclude-standard', '-z']);
  }

  const hasArtifacts =
    filesystemArtifacts.length > 0 || trackedArtifacts.length > 0 || untrackedArtifacts.length > 0;

  if (hasArtifacts) {
    console.error('AppleDouble artifact check failed.');
    printSection('Filesystem artifacts', filesystemArtifacts);
    if (gitRepo) {
      printSection('Tracked artifacts', trackedArtifacts);
      printSection('Untracked artifacts', untrackedArtifacts);
    } else {
      console.error('Git repository not detected; tracked/untracked breakdown unavailable.');
    }
    process.exit(1);
  }

  if (!gitRepo) {
    console.log('AppleDouble artifact check passed. No artifacts found (filesystem scan; git not detected).');
    return;
  }

  console.log('AppleDouble artifact check passed.');
  console.log('- Filesystem scan clean');
  console.log('- Tracked files clean');
  console.log('- Untracked files clean');
}

main();
