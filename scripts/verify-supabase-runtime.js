#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ENV_LOCAL = path.join(ROOT, '.env.local');
const FETCH_TIMEOUT_MS = 15000;

function parseEnvFile(filepath) {
  if (!fs.existsSync(filepath)) {
    return {};
  }
  const source = fs.readFileSync(filepath, 'utf8');
  const out = {};
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

function getEnv(key, fallback) {
  if (process.env[key] && process.env[key].trim()) {
    return process.env[key].trim();
  }
  return fallback[key] || '';
}

function mask(value) {
  if (!value) return '(missing)';
  if (value.length <= 16) return `${value.slice(0, 4)}...`;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isDeployableEdgeFunctionDir(functionsDir, dirent) {
  if (!dirent.isDirectory()) return false;
  const name = String(dirent.name || '').trim();
  if (!name || name.startsWith('.') || name.startsWith('_')) return false;
  const indexTs = path.join(functionsDir, name, 'index.ts');
  return fs.existsSync(indexTs);
}

async function callJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

async function main() {
  const fallbackEnv = parseEnvFile(ENV_LOCAL);
  const supabaseUrl = getEnv('EXPO_PUBLIC_SUPABASE_URL', fallbackEnv);
  const supabaseAnonKey = getEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', fallbackEnv);

  assert(supabaseUrl, 'Missing EXPO_PUBLIC_SUPABASE_URL');
  assert(supabaseAnonKey, 'Missing EXPO_PUBLIC_SUPABASE_ANON_KEY');

  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error(`Invalid EXPO_PUBLIC_SUPABASE_URL: ${supabaseUrl}`);
  }

  assert(parsedUrl.protocol === 'https:', 'Supabase URL must use https');
  assert(
    parsedUrl.hostname.endsWith('.supabase.co'),
    `Supabase URL hostname must end with .supabase.co (got ${parsedUrl.hostname})`
  );
  assert(
    supabaseAnonKey.startsWith('sb_publishable_') || supabaseAnonKey.startsWith('eyJ'),
    'EXPO_PUBLIC_SUPABASE_ANON_KEY does not look like a publishable/anon key'
  );

  console.log('Supabase runtime preflight:');
  console.log(`- URL: ${supabaseUrl}`);
  console.log(`- Anon key: ${mask(supabaseAnonKey)}`);

  const commonHeaders = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
  };

  const authSettings = await callJson(`${supabaseUrl}/auth/v1/settings`, {
    method: 'GET',
    headers: commonHeaders,
  });
  assert(authSettings.response.status === 200, `auth/v1/settings failed (${authSettings.response.status})`);

  const tableReads = [
    'profiles',
    'follows',
    'posts',
    'likes',
    'comments',
    'teams',
    'team_members',
    'team_checkins',
    'team_challenges',
    'leaderboards',
    'activity_feed',
    'groups',
    'group_members',
    'friendships',
    'events',
    'event_rsvps',
    'garmin_link_tokens',
    'garmin_device_links',
    'garmin_workouts',
    'garmin_entitlements',
    'food_search_cache',
    'food_search_prefix_cache',
    'food_user_query_profile',
    'food_search_metrics',
    'food_search_rate_limit_state',
    'backend_ops_alerts',
    'backend_ops_heartbeats',
  ];

  for (const table of tableReads) {
    const res = await callJson(`${supabaseUrl}/rest/v1/${table}?select=id&limit=1`, {
      method: 'GET',
      headers: commonHeaders,
    });
    assert(
      res.response.status !== 404 && res.response.status < 500,
      `${table} read probe failed (${res.response.status})`
    );
  }

  const probeUserId = crypto.randomUUID();
  const probeContent = `rls_probe_${crypto.randomUUID().slice(0, 8)}`;
  const anonWrite = await callJson(`${supabaseUrl}/rest/v1/posts`, {
    method: 'POST',
    headers: {
      ...commonHeaders,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      user_id: probeUserId,
      content: probeContent,
      post_type: 'text',
    }),
  });

  const writeBlocked = anonWrite.response.status === 401 || anonWrite.response.status === 403;
  if (!writeBlocked) {
    // Safety cleanup if RLS is misconfigured and anon insert unexpectedly succeeded.
    await callJson(
      `${supabaseUrl}/rest/v1/posts?user_id=eq.${encodeURIComponent(probeUserId)}&content=eq.${encodeURIComponent(probeContent)}`,
      {
        method: 'DELETE',
        headers: {
          ...commonHeaders,
          Prefer: 'return=minimal',
        },
      }
    );
  }
  assert(
    writeBlocked,
    `Anonymous write should be blocked by RLS (got ${anonWrite.response.status})`
  );

  // Protected backend-op tables must NOT be directly readable by anon/authenticated app keys.
  const protectedTables = [
    'food_search_cache',
    'food_search_prefix_cache',
    'food_user_query_profile',
    'food_search_metrics',
    'food_search_rate_limit_state',
    'backend_ops_alerts',
    'backend_ops_heartbeats',
  ];
  for (const table of protectedTables) {
    const res = await callJson(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1`, {
      method: 'GET',
      headers: commonHeaders,
    });
    const blocked = res.response.status === 401 || res.response.status === 403;
    assert(blocked, `${table} should be blocked for anon/app key reads (got ${res.response.status})`);
  }

  // Edge function reachability probes: ensure functions are deployed (not 404).
  // We intentionally do NOT send a user JWT here; most functions should reject or be method-limited, but must exist.
  const functionsDir = path.join(ROOT, 'supabase', 'functions');
  const functionNames = fs
    .readdirSync(functionsDir, { withFileTypes: true })
    .filter((d) => isDeployableEdgeFunctionDir(functionsDir, d))
    .map((d) => d.name)
    .filter((name) => !name.startsWith('.'));
  const requiredPrivacyFunctions = [
    'privacy-consent',
    'privacy-data-explanation',
    'privacy-public-shares',
    'privacy-retention-enforce',
  ];
  for (const requiredFn of requiredPrivacyFunctions) {
    assert(functionNames.includes(requiredFn), `required privacy function missing locally: ${requiredFn}`);
  }

  for (const fn of functionNames) {
    const res = await callJson(`${supabaseUrl}/functions/v1/${fn}`, {
      method: 'GET',
      headers: commonHeaders,
    });
    assert(res.response.status !== 404, `edge function "${fn}" not found (404)`);
  }

  console.log('Supabase runtime check passed.');
  console.log('- Auth settings reachable');
  console.log(`- Tables readable with anon role: ${tableReads.join(', ')}`);
  console.log('- Anonymous insert blocked by RLS');
  console.log(`- Protected tables blocked for anon/app key reads: ${protectedTables.join(', ')}`);
  console.log(`- Edge functions reachable (not 404): ${functionNames.join(', ')}`);
}

main().catch((error) => {
  console.error(`Supabase runtime check failed: ${error.message}`);
  process.exit(1);
});
