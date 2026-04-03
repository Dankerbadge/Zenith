#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
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
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
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

function resolveRouteToFile(routePath) {
  const normalized = String(routePath || '').split('?')[0].trim();
  if (!normalized.startsWith('/')) return { ok: false, reason: 'non-route' };

  if (normalized === '/') {
    const rootIndex = ROUTE_FILE_EXTENSIONS.map((ext) => path.join(APP_DIR, `index${ext}`)).find((p) => fs.existsSync(p));
    if (rootIndex) return { ok: true, file: rootIndex };
    const tabsIndex = ROUTE_FILE_EXTENSIONS.map((ext) => path.join(APP_DIR, '(tabs)', `index${ext}`)).find((p) => fs.existsSync(p));
    if (tabsIndex) return { ok: true, file: tabsIndex };
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
      if (dynamicLeaf) return { ok: true, file: path.join(currentDir, dynamicLeaf) };
      const dynamicDir = findDynamicDir(currentDir);
      if (dynamicDir && hasIndexFile(path.join(currentDir, dynamicDir))) {
        const index = ROUTE_FILE_EXTENSIONS.map((ext) => path.join(currentDir, dynamicDir, `index${ext}`)).find((p) => fs.existsSync(p));
        if (index) return { ok: true, file: index };
      }
      return { ok: false, reason: `missing dynamic leaf for "${segment}"` };
    }

    const exactFile = ROUTE_FILE_EXTENSIONS.map((ext) => path.join(currentDir, `${segment}${ext}`)).find((p) => fs.existsSync(p));
    if (exactFile) return { ok: true, file: exactFile };

    const exactDir = path.join(currentDir, segment);
    if (fs.existsSync(exactDir) && fs.statSync(exactDir).isDirectory() && hasIndexFile(exactDir)) {
      const index = ROUTE_FILE_EXTENSIONS.map((ext) => path.join(exactDir, `index${ext}`)).find((p) => fs.existsSync(p));
      if (index) return { ok: true, file: index };
    }

    const dynamicLeaf = findDynamicLeafFile(currentDir);
    if (dynamicLeaf) return { ok: true, file: path.join(currentDir, dynamicLeaf) };

    return { ok: false, reason: `missing leaf route "${segment}"` };
  }

  return { ok: false, reason: 'unknown resolution failure' };
}

function collectRoutesFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const results = [];
  const patterns = [
    /router\.(?:push|replace)\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g,
    /href=\{\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")\s*\}/g,
    /pathname:\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g,
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const route = match[1] || match[2] || match[3] || '';
      if (!route.startsWith('/')) continue;
      if (/^https?:\/\//i.test(route)) continue;
      results.push({ route, line: lineAt(content, match.index) });
    }
  });
  return results;
}

function classifyIncomplete(fileContent) {
  const rules = [
    { id: 'coming_soon', re: /coming soon/i },
    { id: 'not_implemented', re: /not implemented/i },
    { id: 'disabled_build', re: /disabled in this build/i },
    { id: 'not_initialized', re: /not initialized yet/i },
    { id: 'needs_config', re: /\brequire cloud config\b|\brequires cloud configuration\b|needs cloud setup/i },
    { id: 'todo_fixme', re: /\b(TODO|FIXME)\b/ },
  ];
  const hits = rules.filter((r) => r.re.test(fileContent)).map((r) => r.id);
  return hits;
}

function main() {
  const files = walkFiles(APP_DIR);
  const routeRefs = [];
  files.forEach((file) => {
    const rel = path.relative(ROOT, file);
    const routes = collectRoutesFromFile(file);
    routes.forEach((r) => routeRefs.push({ from: rel, line: r.line, route: r.route }));
  });

  const uniqueRoutes = new Map();
  routeRefs.forEach((r) => {
    const key = r.route.split('?')[0];
    if (!uniqueRoutes.has(key)) uniqueRoutes.set(key, []);
    uniqueRoutes.get(key).push(r);
  });

  const findings = [];
  for (const [route, refs] of uniqueRoutes.entries()) {
    const resolved = resolveRouteToFile(route);
    if (!resolved.ok) continue; // verify-routes handles missing targets; this report is for completeness.
    const content = fs.readFileSync(resolved.file, 'utf8');
    const tags = classifyIncomplete(content);
    if (tags.length) {
      findings.push({
        route,
        file: path.relative(ROOT, resolved.file),
        tags,
        refs: refs.slice(0, 3),
      });
    }
  }

  if (!findings.length) {
    console.log('No obvious incomplete/placeholder route targets found (heuristic scan).');
    process.exit(0);
  }

  const needsConfig = findings.filter((f) => f.tags.length === 1 && f.tags[0] === 'needs_config');
  const placeholders = findings.filter((f) => !needsConfig.includes(f));

  if (placeholders.length) {
    console.log('Potentially incomplete route targets (heuristic scan):');
    placeholders
      .sort((a, b) => a.route.localeCompare(b.route))
      .forEach((f) => {
        console.log(`- ${f.route} -> ${f.file} [${f.tags.join(', ')}]`);
        f.refs.forEach((r) => console.log(`  referenced by ${r.from}:${r.line}`));
      });
  }

  if (needsConfig.length) {
    if (placeholders.length) console.log('');
    console.log('Route targets that need user configuration (not a code placeholder):');
    needsConfig
      .sort((a, b) => a.route.localeCompare(b.route))
      .forEach((f) => {
        console.log(`- ${f.route} -> ${f.file} [needs_config]`);
        f.refs.forEach((r) => console.log(`  referenced by ${r.from}:${r.line}`));
      });
  }

  if (placeholders.length) {
    process.exit(1);
  }
}

main();
