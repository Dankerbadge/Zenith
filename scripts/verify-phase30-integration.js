#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  baseConfig,
  readJsonFile,
  ensureFixtureUser,
  signInWithPassword,
  tableExists,
  restSelect,
  restUpsert,
  callFunction,
  writeJsonReport,
  writeMarkdownReport,
} = require('./phase30-lib');

function isoDayFromOffset(dayOffset = 0) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + Number(dayOffset || 0)));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function runScript(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
  };
}

function tableMarkdown(rows) {
  const header = '| Test ID | Phase Dependencies | Scenario | Expected | Owner | Result | Notes |';
  const sep = '| --- | --- | --- | --- | --- | --- | --- |';
  const body = rows.map((row) => {
    return `| ${row.id} | ${row.dependencies} | ${row.scenario} | ${row.expected} | ${row.owner} | ${row.result} | ${String(row.notes || '').replace(/\|/g, '\\|')} |`;
  });
  return [header, sep, ...body].join('\n');
}

async function ensureFixtureSessions(config, fixtures) {
  const users = Array.isArray(fixtures.users) ? fixtures.users : [];
  const out = {};
  for (const user of users) {
    const ensured = await ensureFixtureUser(config, {
      email: user.email,
      password: user.password,
      displayName: user.displayName,
      username: user.username,
      userMetadata: { role: user.role || 'user', phase30_fixture: true },
      appMetadata: { phase30_fixture: true },
    });
    const session = await signInWithPassword(config, user.email, user.password);
    out[user.key] = {
      ...ensured,
      accessToken: session.accessToken,
    };
  }
  return out;
}

function isHardGate(testId) {
  const hard = new Set([
    'T30-001', 'T30-002', 'T30-003', 'T30-004', 'T30-005', 'T30-006',
    'T30-007', 'T30-008', 'T30-009', 'T30-010', 'T30-011', 'T30-012',
    'T30-013', 'T30-014',
  ]);
  return hard.has(testId);
}

async function main() {
  const config = baseConfig();
  const fixtures = readJsonFile('scripts/fixtures/phase30-fixtures.json');
  const sessions = await ensureFixtureSessions(config, fixtures);
  const regular = sessions.regular;
  const legacy = sessions.legacy;
  const admin = sessions.admin;
  const deleteCandidate = sessions.delete_candidate;
  if (!regular || !legacy || !admin || !deleteCandidate) {
    throw new Error('Fixture sessions missing required users.');
  }

  const tests = [];

  async function runTest(meta, fn) {
    const row = {
      id: meta.id,
      dependencies: meta.dependencies,
      scenario: meta.scenario,
      expected: meta.expected,
      owner: meta.owner,
      result: 'FAIL',
      notes: '',
    };
    try {
      const output = await fn();
      row.result = output.pass ? 'PASS' : 'FAIL';
      row.notes = output.notes || '';
    } catch (error) {
      row.result = 'FAIL';
      row.notes = `error:${error.message}`;
    }
    tests.push(row);
  }

  await runTest(
    {
      id: 'T30-001',
      dependencies: '19,28',
      scenario: 'Basic log write/read (online)',
      expected: 'log accepted, synced',
      owner: 'QA Lead',
    },
    async () => {
      const day = isoDayFromOffset(0);
      const upsert = await restUpsert(config, {
        table: 'nutrition_daily',
        onConflict: 'user_id,day',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        rows: {
          user_id: regular.userId,
          day,
          calories_kcal: 1990,
          protein_g: 132.2,
          carbs_g: 201.1,
          fat_g: 60.6,
          fiber_g: 19.9,
          meal_breakdown: {},
          computed_at: new Date().toISOString(),
        },
      });
      if (!upsert.ok) return { pass: false, notes: `upsert_failed:${upsert.status}` };
      const select = await restSelect(config, {
        table: 'nutrition_daily',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        query: `select=day,calories_kcal,protein_g&user_id=eq.${encodeURIComponent(regular.userId)}&day=eq.${day}&limit=1`,
      });
      const rows = Array.isArray(select.body) ? select.body : [];
      const pass = select.ok && rows.length === 1 && Number(rows[0].calories_kcal) === 1990;
      return { pass, notes: pass ? `row=${day}` : `select_status=${select.status}` };
    }
  );

  await runTest(
    {
      id: 'T30-002',
      dependencies: '19,28',
      scenario: 'Offline write -> sync online',
      expected: 'queued log materializes in aggregates',
      owner: 'QA',
    },
    async () => {
      const day = isoDayFromOffset(0);
      const stateKey = `dailyLog_${day}`;
      const snapshotWrite = await restUpsert(config, {
        table: 'user_state_snapshots',
        onConflict: 'user_id,state_key',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        rows: {
          user_id: regular.userId,
          state_key: stateKey,
          state_value: {
            foodEntries: [
              { ts: `${day}T12:00:00.000Z`, meal: 'lunch', label: 'fixture chicken bowl', calories: 780, protein: 52, carbs: 60, fat: 30, fiber: 6 },
            ],
            calories: 780,
            macros: { protein: 52, carbs: 60, fat: 30 },
          },
          updated_at: new Date().toISOString(),
        },
      });
      if (!snapshotWrite.ok) return { pass: false, notes: `snapshot_write_failed:${snapshotWrite.status}` };

      const aggregate = await callFunction(config, {
        name: 'compute-nutrition-aggregates',
        method: 'POST',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        body: { fromDay: day, toDay: day },
      });
      if (!aggregate.ok) return { pass: false, notes: `aggregate_failed:${aggregate.status}` };

      const read = await restSelect(config, {
        table: 'nutrition_daily',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        query: `select=day,calories_kcal,protein_g&user_id=eq.${encodeURIComponent(regular.userId)}&day=eq.${day}&limit=1`,
      });
      const rows = Array.isArray(read.body) ? read.body : [];
      const calories = Number(rows[0]?.calories_kcal || 0);
      return {
        pass: read.ok && rows.length === 1 && calories >= 700,
        notes: `calories=${calories}`,
      };
    }
  );

  await runTest(
    {
      id: 'T30-003',
      dependencies: '23',
      scenario: 'Goal-aware logging',
      expected: 'goal snapshot table exists and stores progress',
      owner: 'Dev/QA',
    },
    async () => {
      const exists = await tableExists(config, 'food_v2_daily_goal_snapshots');
      if (!exists) return { pass: false, notes: 'food_v2_daily_goal_snapshots_missing' };
      const day = isoDayFromOffset(0);
      const upsert = await restUpsert(config, {
        table: 'food_v2_daily_goal_snapshots',
        onConflict: 'user_id,snapshot_date,goal_profile_id',
        rows: {
          user_id: regular.userId,
          snapshot_date: day,
          timezone: 'America/New_York',
          goal_profile_id: '00000000-0000-0000-0000-000000000001',
          targets: { protein_g: 120 },
          totals: { protein_g: 86 },
          progress: { protein_pct: 71.6 },
          computed_at: new Date().toISOString(),
        },
      });
      if (!upsert.ok) return { pass: false, notes: `goal_upsert_failed:${upsert.status}` };
      return { pass: true, notes: 'goal_snapshot_upserted' };
    }
  );

  await runTest(
    {
      id: 'T30-004',
      dependencies: '21-25',
      scenario: 'Usual foods retrieval',
      expected: 'usual foods context table exists and stores ranking rows',
      owner: 'QA',
    },
    async () => {
      const exists = await tableExists(config, 'food_v2_user_usual_foods');
      if (!exists) return { pass: false, notes: 'food_v2_user_usual_foods_missing' };
      const upsert = await restUpsert(config, {
        table: 'food_v2_user_usual_foods',
        onConflict: 'user_id,context_key,provider_id,source_food_id,template_id',
        rows: {
          user_id: regular.userId,
          context_key: 'weekday:lunch',
          provider_id: 'usda',
          source_food_id: 'fixture:usda:chicken_bowl',
          template_id: null,
          score: 0.91,
          use_count: 4,
          last_used_at: new Date().toISOString(),
          default_serving_id: 'serving_key:100g',
          default_quantity: 1,
          updated_at: new Date().toISOString(),
        },
      });
      if (!upsert.ok) return { pass: false, notes: `usual_food_upsert_failed:${upsert.status}` };
      return { pass: true, notes: 'usual_food_row_written' };
    }
  );

  await runTest(
    {
      id: 'T30-005',
      dependencies: '19,28',
      scenario: 'Old client compatibility',
      expected: 'runtime config returns degraded-mode capability contract',
      owner: 'Release Engineer',
    },
    async () => {
      const result = await callFunction(config, {
        name: 'runtime-config',
        method: 'GET',
        apiKey: config.anonKey,
        bearerToken: legacy.accessToken,
        query: 'platform=ios&appVersion=2.1.0&packSchemaVersion=1',
      });
      if (!result.ok) return { pass: false, notes: `runtime_config_missing_or_failed:${result.status}` };
      const body = result.body || {};
      const hasCompat = typeof body?.degradedMode === 'object' || typeof body?.apiContractVersion === 'number';
      return { pass: hasCompat, notes: hasCompat ? 'runtime_contract_ok' : 'runtime_contract_missing_fields' };
    }
  );

  await runTest(
    {
      id: 'T30-006',
      dependencies: '28',
      scenario: 'Runtime compatibility negotiation',
      expected: 'runtime config returns capabilities and pack compatibility',
      owner: 'Release Engineer',
    },
    async () => {
      const result = await callFunction(config, {
        name: 'runtime-config',
        method: 'GET',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        query: 'platform=ios&appVersion=9.9.9&packSchemaVersion=3',
      });
      if (!result.ok) return { pass: false, notes: `runtime_config_failed:${result.status}` };
      const body = result.body || {};
      const pass = typeof body?.capabilities === 'object' && typeof body?.pack === 'object';
      return { pass, notes: pass ? 'capabilities_and_pack_present' : 'missing_capabilities_or_pack' };
    }
  );

  await runTest(
    {
      id: 'T30-007',
      dependencies: '26',
      scenario: 'Export / import snapshot flow',
      expected: 'export works and import endpoint reachable',
      owner: 'QA Lead',
    },
    async () => {
      const day = isoDayFromOffset(0);
      const exportRes = await callFunction(config, {
        name: 'export-nutrition',
        method: 'GET',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        query: `from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}`,
      });
      if (!exportRes.ok) return { pass: false, notes: `export_failed:${exportRes.status}` };

      // Import endpoint is expected for Phase 26+/30 readiness.
      const importCandidates = ['portability-import', 'import-nutrition', 'restore-backup'];
      let importReachable = false;
      let importStatus = '';
      for (const name of importCandidates) {
        const probe = await callFunction(config, {
          name,
          method: 'POST',
          apiKey: config.anonKey,
          bearerToken: regular.accessToken,
          body: { dryRun: true },
        });
        if (probe.status !== 404) {
          importReachable = probe.status < 500;
          importStatus = `${name}:${probe.status}`;
          break;
        }
      }
      return {
        pass: importReachable,
        notes: importReachable ? `export_ok,import_probe=${importStatus}` : 'import_endpoint_missing',
      };
    }
  );

  await runTest(
    {
      id: 'T30-008',
      dependencies: '29',
      scenario: 'Consent gating (notifications/analytics/public sharing)',
      expected: 'public share activation blocked when consent=false and allowed when true',
      owner: 'QA',
    },
    async () => {
      const consentOff = await callFunction(config, {
        name: 'privacy-consent',
        method: 'POST',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        body: {
          notifications: false,
          analytics: false,
          publicSharing: false,
          notes: 'phase30_t30_008',
        },
      });
      if (!consentOff.ok) return { pass: false, notes: `consent_update_off_failed:${consentOff.status}` };

      const seedShare = await restUpsert(config, {
        table: 'food_v2_public_shares',
        onConflict: 'user_id,object_type,object_id',
        rows: {
          user_id: regular.userId,
          object_type: 'recipe',
          object_id: 'phase30:t30-008',
          share_status: 'pending',
          revoked_at: null,
          provenance: { seededBy: 't30_008' },
        },
      });
      if (!seedShare.ok) return { pass: false, notes: `share_seed_failed:${seedShare.status}` };

      const shareId = String(seedShare.body?.[0]?.share_id || '');
      if (!shareId) return { pass: false, notes: 'share_id_missing_after_seed' };

      const activateWithoutConsent = await callFunction(config, {
        name: 'privacy-public-shares',
        method: 'POST',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        body: { shareId, action: 'activate' },
      });
      if (activateWithoutConsent.status !== 403) {
        return { pass: false, notes: `expected_403_without_consent_got_${activateWithoutConsent.status}` };
      }

      const consentOn = await callFunction(config, {
        name: 'privacy-consent',
        method: 'POST',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        body: {
          notifications: true,
          analytics: true,
          publicSharing: true,
          notes: 'phase30_t30_008_allow',
        },
      });
      if (!consentOn.ok) return { pass: false, notes: `consent_update_on_failed:${consentOn.status}` };

      const activateWithConsent = await callFunction(config, {
        name: 'privacy-public-shares',
        method: 'POST',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        body: { shareId, action: 'activate' },
      });
      return {
        pass: activateWithConsent.ok,
        notes: activateWithConsent.ok ? 'consent_gate_enforced' : `activate_with_consent_failed:${activateWithConsent.status}`,
      };
    }
  );

  await runTest(
    {
      id: 'T30-009',
      dependencies: '29',
      scenario: 'Retention enforcement',
      expected: 'expired logs purged by retention policy',
      owner: 'Dev/QA',
    },
    async () => {
      if (!config.opsAutomationKey) return { pass: false, notes: 'OPS_AUTOMATION_KEY_missing' };

      const policyExists = await tableExists(config, 'food_v2_retention_policies');
      if (!policyExists) return { pass: false, notes: 'food_v2_retention_policies_missing' };

      const oldDay = '2000-01-01';
      await restUpsert(config, {
        table: 'nutrition_daily',
        onConflict: 'user_id,day',
        rows: {
          user_id: regular.userId,
          day: oldDay,
          calories_kcal: 1111,
          protein_g: 11,
          carbs_g: 11,
          fat_g: 11,
          fiber_g: 0,
          meal_breakdown: {},
          computed_at: new Date().toISOString(),
        },
      });

      const prevPolicy = await restSelect(config, {
        table: 'food_v2_retention_policies',
        query: 'select=category,retention_days,purge_action,enabled&category=eq.logs&limit=1',
      });
      const oldPolicy = Array.isArray(prevPolicy.body) && prevPolicy.body.length ? prevPolicy.body[0] : null;

      const policyUpsert = await restUpsert(config, {
        table: 'food_v2_retention_policies',
        onConflict: 'category',
        rows: {
          category: 'logs',
          retention_days: 1,
          purge_action: 'delete',
          enabled: true,
          updated_at: new Date().toISOString(),
        },
      });
      if (!policyUpsert.ok) return { pass: false, notes: `policy_upsert_failed:${policyUpsert.status}` };

      const enforce = await callFunction(config, {
        name: 'privacy-retention-enforce',
        method: 'POST',
        headers: { 'x-ops-key': config.opsAutomationKey },
        body: { dryRun: false },
      });

      // Restore baseline policy regardless of test outcome.
      if (oldPolicy) {
        await restUpsert(config, {
          table: 'food_v2_retention_policies',
          onConflict: 'category',
          rows: oldPolicy,
        });
      } else {
        await restUpsert(config, {
          table: 'food_v2_retention_policies',
          onConflict: 'category',
          rows: {
            category: 'logs',
            retention_days: 3650,
            purge_action: 'delete',
            enabled: true,
            updated_at: new Date().toISOString(),
          },
        });
      }

      if (!enforce.ok) return { pass: false, notes: `retention_enforce_failed:${enforce.status}` };

      const verify = await restSelect(config, {
        table: 'nutrition_daily',
        query: `select=day&user_id=eq.${encodeURIComponent(regular.userId)}&day=eq.${oldDay}&limit=1`,
      });
      const rows = Array.isArray(verify.body) ? verify.body : [];
      return {
        pass: verify.ok && rows.length === 0,
        notes: verify.ok ? `old_row_deleted=${rows.length === 0}` : `verify_failed:${verify.status}`,
      };
    }
  );

  await runTest(
    {
      id: 'T30-010',
      dependencies: '27,28',
      scenario: 'Admin replay idempotency',
      expected: 'replay-safe behavior with audit entries',
      owner: 'Release Engineer',
    },
    async () => {
      if (!config.opsAutomationKey) return { pass: false, notes: 'OPS_AUTOMATION_KEY_missing' };
      const run1 = await callFunction(config, {
        name: 'privacy-retention-enforce',
        method: 'POST',
        headers: { 'x-ops-key': config.opsAutomationKey },
        body: { dryRun: true },
      });
      const run2 = await callFunction(config, {
        name: 'privacy-retention-enforce',
        method: 'POST',
        headers: { 'x-ops-key': config.opsAutomationKey },
        body: { dryRun: true },
      });
      if (!run1.ok || !run2.ok) return { pass: false, notes: `dry_run_failed:${run1.status}/${run2.status}` };

      const total1 = Number(run1.body?.result?.totalAffected || run1.body?.totalAffected || 0);
      const total2 = Number(run2.body?.result?.totalAffected || run2.body?.totalAffected || 0);
      const auditExists = await tableExists(config, 'food_v2_privacy_audit_events');
      if (!auditExists) return { pass: false, notes: 'food_v2_privacy_audit_events_missing' };

      const auditRead = await restSelect(config, {
        table: 'food_v2_privacy_audit_events',
        query: 'select=event_id,action_type&action_type=eq.retention_dry_run&limit=5',
      });
      const auditRows = Array.isArray(auditRead.body) ? auditRead.body : [];
      return {
        pass: total1 === total2 && auditRead.ok && auditRows.length >= 1,
        notes: `dry_run_totals=${total1}/${total2},audit_rows=${auditRows.length}`,
      };
    }
  );

  await runTest(
    {
      id: 'T30-011',
      dependencies: '28',
      scenario: 'Canary auto-halt drill',
      expected: 'rollout halts on threshold breach',
      owner: 'Release Engineer',
    },
    async () => {
      const cmd = runScript('node', [path.join(__dirname, 'phase30-canary-rollback-drill.js'), '--scenario=halt', '--inject=dual_read_mismatch']);
      return {
        pass: cmd.ok,
        notes: cmd.ok ? 'halt_drill_passed' : `halt_drill_failed:${cmd.stderr || cmd.stdout}`,
      };
    }
  );

  await runTest(
    {
      id: 'T30-012',
      dependencies: '28',
      scenario: 'Rollback drill',
      expected: 'routing rollback completes with no data loss',
      owner: 'Release Engineer',
    },
    async () => {
      const before = await restSelect(config, {
        table: 'nutrition_daily',
        query: `select=day&user_id=eq.${encodeURIComponent(regular.userId)}&limit=100`,
      });
      const beforeCount = Array.isArray(before.body) ? before.body.length : 0;
      const cmd = runScript('node', [path.join(__dirname, 'phase30-canary-rollback-drill.js'), '--scenario=rollback', '--inject=sync_failures']);
      const after = await restSelect(config, {
        table: 'nutrition_daily',
        query: `select=day&user_id=eq.${encodeURIComponent(regular.userId)}&limit=100`,
      });
      const afterCount = Array.isArray(after.body) ? after.body.length : 0;
      return {
        pass: cmd.ok && beforeCount === afterCount,
        notes: `before=${beforeCount},after=${afterCount},drill=${cmd.ok ? 'ok' : 'failed'}`,
      };
    }
  );

  await runTest(
    {
      id: 'T30-013',
      dependencies: '26,29',
      scenario: 'Delete user account data',
      expected: 'privacy tables removed and auth revoked',
      owner: 'QA Lead',
    },
    async () => {
      await restUpsert(config, {
        table: 'food_v2_user_consent',
        onConflict: 'user_id',
        rows: {
          user_id: deleteCandidate.userId,
          notifications: true,
          analytics: true,
          public_sharing: true,
          consent_updated_at: new Date().toISOString(),
        },
      });
      await restUpsert(config, {
        table: 'food_v2_public_shares',
        onConflict: 'user_id,object_type,object_id',
        rows: {
          user_id: deleteCandidate.userId,
          object_type: 'recipe',
          object_id: 'phase30:delete_candidate',
          share_status: 'active',
          provenance: { source: 't30_013' },
        },
      });

      const del = await callFunction(config, {
        name: 'delete-me',
        method: 'POST',
        apiKey: config.anonKey,
        bearerToken: deleteCandidate.accessToken,
        body: { reason: 'phase30_t30_013' },
      });
      if (!del.ok) return { pass: false, notes: `delete_me_failed:${del.status}` };

      const consentLeft = await restSelect(config, {
        table: 'food_v2_user_consent',
        query: `select=user_id&user_id=eq.${encodeURIComponent(deleteCandidate.userId)}&limit=1`,
      });
      const shareLeft = await restSelect(config, {
        table: 'food_v2_public_shares',
        query: `select=share_id&user_id=eq.${encodeURIComponent(deleteCandidate.userId)}&limit=1`,
      });
      const consentRows = Array.isArray(consentLeft.body) ? consentLeft.body.length : 0;
      const shareRows = Array.isArray(shareLeft.body) ? shareLeft.body.length : 0;

      let signInBlocked = false;
      try {
        await signInWithPassword(config, fixtures.users.find((u) => u.key === 'delete_candidate').email, fixtures.users.find((u) => u.key === 'delete_candidate').password);
      } catch {
        signInBlocked = true;
      }

      return {
        pass: consentRows === 0 && shareRows === 0 && signInBlocked,
        notes: `consentRows=${consentRows},shareRows=${shareRows},signInBlocked=${signInBlocked}`,
      };
    }
  );

  await runTest(
    {
      id: 'T30-014',
      dependencies: '19-29',
      scenario: 'Full E2E integration flow',
      expected: 'offline->sync->goals/discovery hooks->privacy->export->admin replay path all succeed',
      owner: 'QA Lead',
    },
    async () => {
      const day = isoDayFromOffset(-1);
      const stateKey = `dailyLog_${day}`;
      const writeSnapshot = await restUpsert(config, {
        table: 'user_state_snapshots',
        onConflict: 'user_id,state_key',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        rows: {
          user_id: regular.userId,
          state_key: stateKey,
          state_value: {
            foodEntries: [{ ts: `${day}T08:30:00.000Z`, meal: 'breakfast', label: 'phase30 oats', calories: 420, protein: 20, carbs: 60, fat: 11, fiber: 7 }],
            calories: 420,
            macros: { protein: 20, carbs: 60, fat: 11 },
          },
        },
      });
      if (!writeSnapshot.ok) return { pass: false, notes: `snapshot_write_failed:${writeSnapshot.status}` };

      const agg = await callFunction(config, {
        name: 'compute-nutrition-aggregates',
        method: 'POST',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        body: { fromDay: day, toDay: day },
      });
      if (!agg.ok) return { pass: false, notes: `aggregate_failed:${agg.status}` };

      const consent = await callFunction(config, {
        name: 'privacy-consent',
        method: 'POST',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        body: { notifications: true, analytics: false, publicSharing: true },
      });
      if (!consent.ok) return { pass: false, notes: `consent_update_failed:${consent.status}` };

      const explanation = await callFunction(config, {
        name: 'privacy-data-explanation',
        method: 'GET',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
      });
      if (!explanation.ok) return { pass: false, notes: `data_explanation_failed:${explanation.status}` };

      const exportRes = await callFunction(config, {
        name: 'export-nutrition',
        method: 'GET',
        apiKey: config.anonKey,
        bearerToken: regular.accessToken,
        query: `from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}`,
      });
      if (!exportRes.ok) return { pass: false, notes: `export_failed:${exportRes.status}` };

      const replay = config.opsAutomationKey
        ? await callFunction(config, {
            name: 'privacy-retention-enforce',
            method: 'POST',
            headers: { 'x-ops-key': config.opsAutomationKey },
            body: { dryRun: true },
          })
        : { ok: false, status: 0 };
      if (!replay.ok) return { pass: false, notes: `admin_replay_dry_run_failed:${replay.status}` };

      const drill = runScript('node', [path.join(__dirname, 'phase30-canary-rollback-drill.js'), '--scenario=halt', '--inject=latency_spike']);
      if (!drill.ok) return { pass: false, notes: `drill_failed:${drill.stderr || drill.stdout}` };

      return { pass: true, notes: 'full_flow_ok' };
    }
  );

  const hardFailures = tests.filter((t) => isHardGate(t.id) && t.result !== 'PASS');
  const summary = {
    ok: hardFailures.length === 0,
    createdAt: new Date().toISOString(),
    hardFailures: hardFailures.map((t) => ({ id: t.id, notes: t.notes })),
    totals: {
      total: tests.length,
      passed: tests.filter((t) => t.result === 'PASS').length,
      failed: tests.filter((t) => t.result !== 'PASS').length,
    },
    tests,
  };

  const jsonPath = writeJsonReport('PHASE30_MATRIX_REPORT', summary);
  const markdown = [
    '# Phase 30 Unified QA Matrix Report',
    '',
    `- Generated: ${summary.createdAt}`,
    `- Total tests: ${summary.totals.total}`,
    `- Passed: ${summary.totals.passed}`,
    `- Failed: ${summary.totals.failed}`,
    '',
    tableMarkdown(tests),
    '',
  ].join('\n');
  const mdPath = writeMarkdownReport('PHASE30_MATRIX_REPORT', markdown);

  console.log('Phase 30 matrix run complete.');
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);

  if (!summary.ok) {
    const failedIds = hardFailures.map((f) => f.id).join(',');
    throw new Error(`hard_gate_failures:${failedIds}`);
  }
}

main().catch((error) => {
  console.error(`Phase 30 integration verification failed: ${error.message}`);
  process.exit(1);
});

