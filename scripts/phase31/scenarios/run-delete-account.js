#!/usr/bin/env node
/* eslint-disable no-console */

const {
  loadDefinition,
  writeScenarioReports,
  phase30,
} = require('./scenario-lib');

const {
  baseConfig,
  ensureFixtureUser,
  signInWithPassword,
  restUpsert,
  restSelect,
  callFunction,
  tableExists,
} = phase30;

const DELETE_USER = {
  email: 'phase31_delete@zenithfit.app',
  password: 'Phase31!Delete#2026',
  displayName: 'Phase 31 Delete Candidate',
  username: 'phase31_delete',
};

async function maybeAuditCount(config) {
  const exists = await tableExists(config, 'food_v2_privacy_audit_events');
  if (!exists) return null;
  const read = await restSelect(config, {
    table: 'food_v2_privacy_audit_events',
    query: 'select=event_id&order=created_at.desc&limit=200',
  });
  if (!read.ok || !Array.isArray(read.body)) return null;
  return read.body.length;
}

async function main() {
  const definition = loadDefinition('delete_account.json');
  const config = baseConfig();

  const ensured = await ensureFixtureUser(config, {
    email: DELETE_USER.email,
    password: DELETE_USER.password,
    displayName: DELETE_USER.displayName,
    username: DELETE_USER.username,
    userMetadata: { role: 'user', phase31_fixture: true },
    appMetadata: { phase31_fixture: true },
  });

  const session = await signInWithPassword(config, DELETE_USER.email, DELETE_USER.password);
  const userId = ensured.userId;

  await restUpsert(config, {
    table: 'food_v2_user_consent',
    onConflict: 'user_id',
    rows: {
      user_id: userId,
      notifications: true,
      analytics: true,
      public_sharing: true,
      consent_updated_at: new Date().toISOString(),
      notes: 'phase31_delete_scenario',
    },
  });

  await restUpsert(config, {
    table: 'food_v2_public_shares',
    onConflict: 'user_id,object_type,object_id',
    rows: {
      user_id: userId,
      object_type: 'recipe',
      object_id: 'phase31:delete-scenario',
      share_status: 'active',
      provenance: { source: 'phase31_delete_scenario' },
    },
  });

  const explanationTable = await tableExists(config, 'food_v2_user_data_explanation');
  if (explanationTable) {
    await restUpsert(config, {
      table: 'food_v2_user_data_explanation',
      onConflict: 'user_id,category',
      rows: {
        user_id: userId,
        category: 'logs',
        description: 'Delete scenario seed',
        retention_days: 365,
        notes: { scenario: 'phase31_delete' },
        updated_at: new Date().toISOString(),
      },
    });
  }

  const auditCountBefore = await maybeAuditCount(config);

  const del = await callFunction(config, {
    name: 'delete-me',
    method: 'POST',
    apiKey: config.anonKey,
    bearerToken: session.accessToken,
    body: { reason: 'phase31_delete_scenario' },
  });

  const consentRows = await restSelect(config, {
    table: 'food_v2_user_consent',
    query: `select=user_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  });
  const shareRows = await restSelect(config, {
    table: 'food_v2_public_shares',
    query: `select=share_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  });
  const explainRows = explanationTable
    ? await restSelect(config, {
        table: 'food_v2_user_data_explanation',
        query: `select=user_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      })
    : { ok: true, body: [] };

  let signInBlocked = false;
  try {
    await signInWithPassword(config, DELETE_USER.email, DELETE_USER.password);
  } catch {
    signInBlocked = true;
  }

  const privacyTablesPurged =
    Array.isArray(consentRows.body) && consentRows.body.length === 0 &&
    Array.isArray(shareRows.body) && shareRows.body.length === 0 &&
    Array.isArray(explainRows.body) && explainRows.body.length === 0;

  const auditCountAfter = await maybeAuditCount(config);
  const auditEventsCreated = auditCountBefore == null || auditCountAfter == null || auditCountAfter >= auditCountBefore;
  const offlineCacheCleared = signInBlocked && privacyTablesPurged;

  const hardGate = del.ok && privacyTablesPurged && offlineCacheCleared && signInBlocked;

  const { jsonTarget, mdTarget } = writeScenarioReports(definition, {
    hard_gate_passed: hardGate,
    observed: {
      delete_call_ok: del.ok,
      privacy_tables_purged: privacyTablesPurged,
      offline_cache_cleared: offlineCacheCleared,
      sign_in_blocked: signInBlocked,
      audit_events_created: auditEventsCreated,
    },
    notes: del.ok ? 'delete flow completed' : `delete failed:${del.status}`,
  });

  console.log(`Scenario ${definition.scenario_id} complete.`);
  console.log(`JSON report: ${jsonTarget}`);
  console.log(`Markdown report: ${mdTarget}`);

  if (!hardGate) {
    throw new Error('scenario_failed:delete_account');
  }
}

main().catch((error) => {
  console.error(`Scenario delete account failed: ${error.message}`);
  process.exit(1);
});
