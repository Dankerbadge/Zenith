#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_LOCAL = path.join(ROOT, '.env.local');

function parseEnvFile(filepath) {
  if (!fs.existsSync(filepath)) return {};
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

const fallbackEnv = parseEnvFile(ENV_LOCAL);

function getEnv(key, required = false) {
  const value = String(process.env[key] || fallbackEnv[key] || '').trim();
  if (required && !value) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

function pad(v) {
  return String(v).padStart(2, '0');
}

function utcTimestampKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `${y}${m}${d}_${hh}${mm}${ss}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonReport(filenamePrefix, payload) {
  const outDir = path.join(ROOT, 'docs', 'qa', 'phase30');
  ensureDir(outDir);
  const fileName = `${filenamePrefix}_${utcTimestampKey()}.json`;
  const abs = path.join(outDir, fileName);
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2), 'utf8');
  return abs;
}

function readJsonFile(relativePath) {
  const abs = path.join(ROOT, relativePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Missing JSON file: ${relativePath}`);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  return JSON.parse(raw);
}

function baseConfig() {
  const supabaseUrl = getEnv('EXPO_PUBLIC_SUPABASE_URL', true);
  const anonKey = getEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', true);
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', true);
  const opsAutomationKey = getEnv('OPS_AUTOMATION_KEY', false);
  return { supabaseUrl, anonKey, serviceRoleKey, opsAutomationKey };
}

function authHeaders(apiKey, bearerToken) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${bearerToken || apiKey}`,
  };
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, ok: response.ok, body };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  return parseResponse(response);
}

async function authAdminListUsers(config) {
  const url = `${config.supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`;
  const result = await requestJson(url, {
    method: 'GET',
    headers: authHeaders(config.serviceRoleKey),
  });
  if (!result.ok) {
    throw new Error(`auth_admin_list_users_failed:${result.status}:${JSON.stringify(result.body)}`);
  }
  const users = Array.isArray(result.body?.users) ? result.body.users : [];
  return users;
}

async function authAdminCreateUser(config, input) {
  const url = `${config.supabaseUrl}/auth/v1/admin/users`;
  const payload = {
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: input.userMetadata || {},
    app_metadata: input.appMetadata || {},
  };
  const result = await requestJson(url, {
    method: 'POST',
    headers: {
      ...authHeaders(config.serviceRoleKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!result.ok) {
    throw new Error(`auth_admin_create_user_failed:${result.status}:${JSON.stringify(result.body)}`);
  }
  return result.body?.user || result.body;
}

async function authSignUp(config, input) {
  const url = `${config.supabaseUrl}/auth/v1/signup`;
  const payload = {
    email: input.email,
    password: input.password,
    data: input.userMetadata || {},
  };
  const result = await requestJson(url, {
    method: 'POST',
    headers: {
      ...authHeaders(config.anonKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!result.ok) {
    throw new Error(`auth_sign_up_failed:${result.status}:${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function authAdminUpdateUser(config, userId, input) {
  const url = `${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`;
  const payload = {
    password: input.password,
    email_confirm: true,
    user_metadata: input.userMetadata || {},
    app_metadata: input.appMetadata || {},
  };
  const result = await requestJson(url, {
    method: 'PUT',
    headers: {
      ...authHeaders(config.serviceRoleKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!result.ok) {
    throw new Error(`auth_admin_update_user_failed:${result.status}:${JSON.stringify(result.body)}`);
  }
  return result.body?.user || result.body;
}

async function signInWithPassword(config, email, password) {
  const url = `${config.supabaseUrl}/auth/v1/token?grant_type=password`;
  const result = await requestJson(url, {
    method: 'POST',
    headers: {
      ...authHeaders(config.anonKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  if (!result.ok) {
    throw new Error(`sign_in_failed:${result.status}:${JSON.stringify(result.body)}`);
  }
  return {
    accessToken: String(result.body?.access_token || ''),
    userId: String(result.body?.user?.id || ''),
    raw: result.body,
  };
}

function isAlreadyExistsAuthError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('already') ||
    message.includes('exists') ||
    message.includes('registered') ||
    message.includes('duplicate')
  );
}

async function trySignInWithPassword(config, email, password) {
  try {
    return await signInWithPassword(config, email, password);
  } catch {
    return null;
  }
}

function restUrl(config, table, query = '') {
  const suffix = query ? `?${query}` : '';
  return `${config.supabaseUrl}/rest/v1/${encodeURIComponent(table)}${suffix}`;
}

async function restSelect(config, input) {
  const query = input.query || 'select=*';
  const token = input.bearerToken || config.serviceRoleKey;
  return requestJson(restUrl(config, input.table, query), {
    method: 'GET',
    headers: authHeaders(input.apiKey || config.anonKey, token),
  });
}

async function restUpsert(config, input) {
  const queryParts = [];
  if (input.onConflict) queryParts.push(`on_conflict=${encodeURIComponent(input.onConflict)}`);
  if (input.returning !== false) queryParts.push('select=*');
  const query = queryParts.join('&');
  const token = input.bearerToken || config.serviceRoleKey;
  return requestJson(restUrl(config, input.table, query), {
    method: 'POST',
    headers: {
      ...authHeaders(input.apiKey || config.serviceRoleKey, token),
      'Content-Type': 'application/json',
      Prefer: input.returning === false ? 'resolution=merge-duplicates,return=minimal' : 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(input.rows),
  });
}

async function restDelete(config, input) {
  const token = input.bearerToken || config.serviceRoleKey;
  return requestJson(restUrl(config, input.table, input.query || ''), {
    method: 'DELETE',
    headers: {
      ...authHeaders(input.apiKey || config.serviceRoleKey, token),
      Prefer: 'return=minimal',
    },
  });
}

async function callFunction(config, input) {
  const query = input.query ? `?${input.query}` : '';
  const url = `${config.supabaseUrl}/functions/v1/${input.name}${query}`;
  const method = input.method || 'POST';
  const token = input.bearerToken || config.serviceRoleKey;
  const apiKey = input.apiKey || (input.bearerToken ? config.anonKey : config.serviceRoleKey);
  const headers = {
    ...authHeaders(apiKey, token),
    ...(input.headers || {}),
  };
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
  }
  return requestJson(url, {
    method,
    headers,
    ...(method !== 'GET' && method !== 'HEAD' ? { body: JSON.stringify(input.body || {}) } : {}),
  });
}

async function tableExists(config, table) {
  const result = await restSelect(config, {
    table,
    query: 'select=*&limit=1',
  });
  if (result.ok) return true;
  if (result.status === 404) return false;
  const msg = String(result.body?.message || result.body?.error || '');
  if (msg.toLowerCase().includes('does not exist')) return false;
  return false;
}

async function ensureFixtureUser(config, input) {
  const email = String(input.email || '').trim().toLowerCase();
  let existing = null;
  let session = await trySignInWithPassword(config, input.email, input.password);
  if (session?.userId) {
    existing = { id: session.userId };
  }

  if (!existing) {
    try {
      const signUp = await authSignUp(config, {
        email: input.email,
        password: input.password,
        userMetadata: input.userMetadata,
      });
      const signUpUserId = String(signUp?.user?.id || signUp?.id || '').trim();
      if (signUpUserId) {
        existing = { id: signUpUserId };
      }
    } catch (error) {
      if (!isAlreadyExistsAuthError(error)) {
        // Continue to admin fallback.
      }
    }
  }

  if (!existing) {
    try {
      existing = await authAdminCreateUser(config, {
        email: input.email,
        password: input.password,
        userMetadata: input.userMetadata,
        appMetadata: input.appMetadata,
      });
    } catch (error) {
      if (!isAlreadyExistsAuthError(error)) throw error;
    }
  }

  if (!session) {
    session = await trySignInWithPassword(config, input.email, input.password);
  }

  if (!existing && session?.userId) {
    existing = { id: session.userId };
  }

  if (existing?.id) {
    try {
      await authAdminUpdateUser(config, String(existing.id), {
        password: input.password,
        userMetadata: {
          ...(existing.user_metadata || {}),
          ...(input.userMetadata || {}),
        },
        appMetadata: {
          ...(existing.app_metadata || {}),
          ...(input.appMetadata || {}),
        },
      });
    } catch {
      // Non-fatal if admin update endpoint is unavailable in this environment.
    }
  }

  const authUserId = String(existing?.id || '');
  if (!authUserId) {
    throw new Error(`fixture_user_id_missing:${email}`);
  }

  const profileUpsert = await restUpsert(config, {
    table: 'profiles',
    onConflict: 'id',
    rows: {
      id: authUserId,
      email: input.email,
      display_name: input.displayName || input.email,
      username: input.username || null,
      updated_at: new Date().toISOString(),
    },
  });
  if (!profileUpsert.ok && profileUpsert.status !== 409) {
    throw new Error(`profile_upsert_failed:${profileUpsert.status}:${JSON.stringify(profileUpsert.body)}`);
  }

  if (!session) {
    session = await signInWithPassword(config, input.email, input.password);
  }
  if (!session.accessToken) {
    throw new Error(`fixture_sign_in_token_missing:${email}`);
  }

  return {
    email: input.email,
    userId: authUserId,
    accessToken: session.accessToken,
  };
}

function formatMarkdownTable(rows) {
  const header = '| Test ID | Scenario | Result | Notes |';
  const sep = '| --- | --- | --- | --- |';
  const body = rows.map((r) => `| ${r.testId} | ${r.scenario} | ${r.result} | ${String(r.notes || '').replace(/\|/g, '\\|')} |`);
  return [header, sep, ...body].join('\n');
}

function writeMarkdownReport(filenamePrefix, markdown) {
  const outDir = path.join(ROOT, 'docs', 'qa', 'phase30');
  ensureDir(outDir);
  const fileName = `${filenamePrefix}_${utcTimestampKey()}.md`;
  const abs = path.join(outDir, fileName);
  fs.writeFileSync(abs, markdown, 'utf8');
  return abs;
}

module.exports = {
  ROOT,
  baseConfig,
  getEnv,
  readJsonFile,
  writeJsonReport,
  writeMarkdownReport,
  formatMarkdownTable,
  requestJson,
  authAdminListUsers,
  authAdminCreateUser,
  authAdminUpdateUser,
  signInWithPassword,
  restSelect,
  restUpsert,
  restDelete,
  callFunction,
  tableExists,
  ensureFixtureUser,
};
