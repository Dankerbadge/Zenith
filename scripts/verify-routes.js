#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..', 'app');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const ROUTE_FILE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

function walkFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function lineAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

function isDynamicSegment(segment) {
  return segment.includes('${') || /^\[.+\]$/.test(segment);
}

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function listFiles(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function hasIndexFile(dir) {
  return ROUTE_FILE_EXTENSIONS.some((ext) => fs.existsSync(path.join(dir, `index${ext}`)));
}

function findDynamicDir(dir) {
  return listDirs(dir).find((name) => /^\[.+\]$/.test(name)) || null;
}

function findDynamicLeafFile(dir) {
  return (
    listFiles(dir).find((name) => {
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      return ROUTE_FILE_EXTENSIONS.includes(ext) && /^\[.+\]$/.test(base);
    }) || null
  );
}

function resolveRoutePath(routePath) {
  const normalized = String(routePath || '').split('?')[0].trim();
  if (!normalized.startsWith('/')) return { ok: true, reason: 'non-route' };
  if (normalized === '/') {
    if (hasIndexFile(APP_DIR)) return { ok: true };
    const tabsIndex = path.join(APP_DIR, '(tabs)');
    if (hasIndexFile(tabsIndex)) return { ok: true };
    return { ok: false, reason: 'root route missing index' };
  }

  const segments = normalized.split('/').filter(Boolean);
  let currentDir = APP_DIR;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;

    if (!isLast) {
      const exactDir = path.join(currentDir, segment);
      if (fs.existsSync(exactDir) && fs.statSync(exactDir).isDirectory()) {
        currentDir = exactDir;
        continue;
      }
      if (isDynamicSegment(segment)) {
        const dynamicDir = findDynamicDir(currentDir);
        if (dynamicDir) {
          currentDir = path.join(currentDir, dynamicDir);
          continue;
        }
      }
      return { ok: false, reason: `missing segment directory "${segment}"` };
    }

    if (isDynamicSegment(segment)) {
      const dynamicLeaf = findDynamicLeafFile(currentDir);
      if (dynamicLeaf) return { ok: true };
      const dynamicDir = findDynamicDir(currentDir);
      if (dynamicDir && hasIndexFile(path.join(currentDir, dynamicDir))) return { ok: true };
      return { ok: false, reason: `missing dynamic leaf for "${segment}"` };
    }

    const exactFile = ROUTE_FILE_EXTENSIONS.some((ext) =>
      fs.existsSync(path.join(currentDir, `${segment}${ext}`))
    );
    if (exactFile) return { ok: true };

    const exactDir = path.join(currentDir, segment);
    if (fs.existsSync(exactDir) && fs.statSync(exactDir).isDirectory() && hasIndexFile(exactDir)) {
      return { ok: true };
    }

    const dynamicLeaf = findDynamicLeafFile(currentDir);
    if (dynamicLeaf) return { ok: true };

    return { ok: false, reason: `missing leaf route "${segment}"` };
  }

  return { ok: false, reason: 'unknown resolution failure' };
}

function collectRoutesFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const results = [];
  const patterns = [
    /router\.(?:push|replace)\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g,
    /pathname:\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const route = match[1] || match[2] || match[3] || '';
      if (!route.startsWith('/')) continue;
      if (/^https?:\/\//i.test(route)) continue;
      results.push({
        route,
        line: lineAt(content, match.index),
      });
    }
  });

  return results;
}

const files = walkFiles(APP_DIR);
const issues = [];

files.forEach((filePath) => {
  const relative = path.relative(path.resolve(__dirname, '..'), filePath);
  const routes = collectRoutesFromFile(filePath);
  routes.forEach((entry) => {
    const resolved = resolveRoutePath(entry.route);
    if (!resolved.ok) {
      issues.push({
        file: relative,
        line: entry.line,
        route: entry.route,
        reason: resolved.reason,
      });
    }
  });
});

if (issues.length) {
  console.error('Route verification failed. Missing or unresolved route targets:');
  issues.forEach((issue) => {
    console.error(`- ${issue.file}:${issue.line} -> "${issue.route}" (${issue.reason})`);
  });
  process.exit(1);
}

console.log('Route verification passed.');
console.log(`Checked ${files.length} file(s) in app/.`);
