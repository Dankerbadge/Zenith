#!/usr/bin/env node
/* eslint-disable no-console */

const {
  phase30,
  writeJsonReport,
  writeMarkdownReport,
  toMarkdownTable,
  nowIso,
} = require('./phase31-lib');

const {
  baseConfig,
  tableExists,
  restUpsert,
  restSelect,
  callFunction,
  ensureFixtureUser,
  signInWithPassword,
} = phase30;

const USERS = {
  regular: {
    email: 'phase31_regular@zenithfit.app',
    password: 'Phase31!Regular#2026',
    displayName: 'Phase 31 Regular',
    username: 'phase31_regular',
    role: 'user',
  },
  admin: {
    email: 'phase31_admin@zenithfit.app',
    password: 'Phase31!Admin#2026',
    displayName: 'Phase 31 Admin',
    username: 'phase31_admin',
    role: 'admin',
  },
};

function isoDay(dayOffset = 0) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + Number(dayOffset || 0)));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function ensureSessions(config) {
  const out = {};

  for (const [key, user] of Object.entries(USERS)) {
    const ensured = await ensureFixtureUser(config, {
      email: user.email,
      password: user.password,
      displayName: user.displayName,
      username: user.username,
      userMetadata: {
        role: user.role,
        phase31_fixture: true,
      },
      appMetadata: {
        phase31_fixture: true,
      },
    });

    const session = await signInWithPassword(config, user.email, user.password);
    out[key] = {
      userId: ensured.userId,
      accessToken: session.accessToken,
      email: user.email,
    };
  }

  return out;
}

async function main() {
  const config = baseConfig();
  const sessions = await ensureSessions(config);
  const regular = sessions.regular;

  const checks = [];

  async function runCheck(id, scenario, fn) {
    const row = { id, scenario, result: 'FAIL', notes: '' };
    try {
      const output = await fn();
      row.result = output.pass ? 'PASS' : 'FAIL';
      row.notes = output.notes || '';
    } catch (error) {
      row.result = 'FAIL';
      row.notes = `error:${error.message}`;
    }
    checks.push(row);
  }

  await runCheck('E31-001', 'Offline queue -> online aggregate sync', async () => {
    const day = isoDay(0);
    const stateKey = `dailyLog_${day}`;

    const snapshot = await restUpsert(config, {
      table: 'user_state_snapshots',
      onConflict: 'user_id,state_key',
      apiKey: config.anonKey,
      bearerToken: regular.accessToken,
      rows: {
        user_id: regular.userId,
        state_key: stateKey,
        state_value: {
          foodEntries: [
            {
              ts: `${day}T13:05:00.000Z`,
              meal: 'lunch',
              label: 'phase31 chicken bowl',
              calories: 730,
              protein: 46,
              carbs: 58,
              fat: 28,
              fiber: 7,
            },
          ],
          calories: 730,
          macros: { protein: 46, carbs: 58, fat: 28 },
        },
      },
    });

    if (!snapshot.ok) return { pass: false, notes: `snapshot_upsert_failed:${snapshot.status}` };

    const immutableLogWrite = await callFunction(config, {
      name: 'food-log-v2-write',
      method: 'POST',
      apiKey: config.anonKey,
      bearerToken: regular.accessToken,
      body: {
        clientEventId: `phase31:${stateKey}`,
        stateKey,
        day,
        payload: {
          foodEntries: [
            {
              ts: `${day}T13:05:00.000Z`,
              meal: 'lunch',
              label: 'phase31 chicken bowl',
              calories: 730,
              protein: 46,
              carbs: 58,
              fat: 28,
              fiber: 7,
            },
          ],
          calories: 730,
          macros: { protein: 46, carbs: 58, fat: 28 },
        },
      },
    });
    if (!immutableLogWrite.ok) return { pass: false, notes: `immutable_log_write_failed:${immutableLogWrite.status}` };

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
    return { pass: read.ok && rows.length === 1 && calories >= 700, notes: `calories=${calories}` };
  });

  await runCheck('E31-002', 'Goal snapshot write/read', async () => {
    const exists = await tableExists(config, 'food_v2_daily_goal_snapshots');
    if (!exists) return { pass: false, notes: 'food_v2_daily_goal_snapshots_missing' };

    const day = isoDay(0);
    const upsert = await restUpsert(config, {
      table: 'food_v2_daily_goal_snapshots',
      onConflict: 'user_id,snapshot_date,goal_profile_id',
      rows: {
        user_id: regular.userId,
        snapshot_date: day,
        timezone: 'America/New_York',
        goal_profile_id: '00000000-0000-0000-0000-000000000001',
        targets: { protein_g: 140, fiber_g: 25 },
        totals: { protein_g: 88, fiber_g: 16 },
        progress: { protein_pct: 62.8, fiber_pct: 64.0 },
        computed_at: nowIso(),
      },
    });

    return { pass: upsert.ok, notes: upsert.ok ? 'goal_snapshot_ok' : `goal_snapshot_failed:${upsert.status}` };
  });

  await runCheck('E31-003', 'Discovery/usual foods context update', async () => {
    const exists = await tableExists(config, 'food_v2_user_usual_foods');
    if (!exists) return { pass: false, notes: 'food_v2_user_usual_foods_missing' };

    const upsert = await restUpsert(config, {
      table: 'food_v2_user_usual_foods',
      onConflict: 'user_id,context_key,provider_id,source_food_id,template_id',
      rows: {
        user_id: regular.userId,
        context_key: 'weekday:lunch',
        provider_id: 'usda',
        source_food_id: 'fixture:phase31:lunch:bowl',
        template_id: null,
        score: 0.93,
        use_count: 8,
        last_used_at: nowIso(),
        default_serving_id: 'serving_key:100g',
        default_quantity: 1,
        updated_at: nowIso(),
      },
    });

    return { pass: upsert.ok, notes: upsert.ok ? 'usual_food_upsert_ok' : `usual_food_upsert_failed:${upsert.status}` };
  });

  await runCheck('E31-004', 'Export + import endpoint availability', async () => {
    const day = isoDay(0);
    const exportRes = await callFunction(config, {
      name: 'export-nutrition',
      method: 'GET',
      apiKey: config.anonKey,
      bearerToken: regular.accessToken,
      query: `from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}`,
    });

    if (!exportRes.ok) return { pass: false, notes: `export_failed:${exportRes.status}` };

    const importCandidates = ['portability-import', 'import-nutrition', 'restore-backup'];
    let reachable = false;
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
        reachable = probe.status < 500;
        importStatus = `${name}:${probe.status}`;
        break;
      }
    }

    return { pass: reachable, notes: reachable ? `import_probe=${importStatus}` : 'import_endpoint_missing' };
  });

  await runCheck('E31-005', 'Privacy consent + public share guard', async () => {
    const consentOff = await callFunction(config, {
      name: 'privacy-consent',
      method: 'POST',
      apiKey: config.anonKey,
      bearerToken: regular.accessToken,
      body: {
        notifications: false,
        analytics: false,
        publicSharing: false,
        notes: 'phase31_e2e_guard',
      },
    });

    if (!consentOff.ok) return { pass: false, notes: `consent_off_failed:${consentOff.status}` };

    const seedShare = await restUpsert(config, {
      table: 'food_v2_public_shares',
      onConflict: 'user_id,object_type,object_id',
      rows: {
        user_id: regular.userId,
        object_type: 'collection',
        object_id: 'phase31:e2e:collection',
        share_status: 'pending',
        revoked_at: null,
        provenance: { source: 'phase31_e2e' },
      },
    });

    if (!seedShare.ok) return { pass: false, notes: `share_seed_failed:${seedShare.status}` };
    const shareId = String(seedShare.body?.[0]?.share_id || '');
    if (!shareId) return { pass: false, notes: 'share_id_missing' };

    const blocked = await callFunction(config, {
      name: 'privacy-public-shares',
      method: 'POST',
      apiKey: config.anonKey,
      bearerToken: regular.accessToken,
      body: { shareId, action: 'activate' },
    });

    if (blocked.status !== 403) {
      return { pass: false, notes: `expected_403_without_consent_got_${blocked.status}` };
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
        notes: 'phase31_e2e_guard_allow',
      },
    });

    if (!consentOn.ok) return { pass: false, notes: `consent_on_failed:${consentOn.status}` };

    const activate = await callFunction(config, {
      name: 'privacy-public-shares',
      method: 'POST',
      apiKey: config.anonKey,
      bearerToken: regular.accessToken,
      body: { shareId, action: 'activate' },
    });

    return { pass: activate.ok, notes: activate.ok ? 'share_guard_enforced' : `activate_failed:${activate.status}` };
  });

  await runCheck('E31-006', 'Retention enforcement purge behavior', async () => {
    if (!config.opsAutomationKey) return { pass: false, notes: 'OPS_AUTOMATION_KEY_missing' };
    const policyExists = await tableExists(config, 'food_v2_retention_policies');
    if (!policyExists) return { pass: false, notes: 'food_v2_retention_policies_missing' };

    const oldDay = '2001-01-01';
    await restUpsert(config, {
      table: 'nutrition_daily',
      onConflict: 'user_id,day',
      rows: {
        user_id: regular.userId,
        day: oldDay,
        calories_kcal: 1200,
        protein_g: 20,
        carbs_g: 120,
        fat_g: 35,
        fiber_g: 8,
        meal_breakdown: {},
        computed_at: nowIso(),
      },
    });

    const previousPolicyRead = await restSelect(config, {
      table: 'food_v2_retention_policies',
      query: 'select=category,retention_days,purge_action,enabled&category=eq.logs&limit=1',
    });
    const oldPolicy = Array.isArray(previousPolicyRead.body) && previousPolicyRead.body.length
      ? previousPolicyRead.body[0]
      : null;

    const tightenPolicy = await restUpsert(config, {
      table: 'food_v2_retention_policies',
      onConflict: 'category',
      rows: {
        category: 'logs',
        retention_days: 1,
        purge_action: 'delete',
        enabled: true,
        updated_at: nowIso(),
      },
    });
    if (!tightenPolicy.ok) return { pass: false, notes: `policy_upsert_failed:${tightenPolicy.status}` };

    const enforce = await callFunction(config, {
      name: 'privacy-retention-enforce',
      method: 'POST',
      headers: { 'x-ops-key': config.opsAutomationKey },
      body: { dryRun: false },
    });

    if (oldPolicy) {
      await restUpsert(config, {
        table: 'food_v2_retention_policies',
        onConflict: 'category',
        rows: oldPolicy,
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
  });

  await runCheck('E31-007', 'Admin replay idempotency', async () => {
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
    return {
      pass: total1 === total2,
      notes: `totals=${total1}/${total2}`,
    };
  });

  await runCheck('E31-008', 'Runtime compatibility contract', async () => {
    const runtime = await callFunction(config, {
      name: 'runtime-config',
      method: 'GET',
      apiKey: config.anonKey,
      bearerToken: regular.accessToken,
      query: 'platform=ios&appVersion=9.9.9&packSchemaVersion=3',
    });

    if (!runtime.ok) return { pass: false, notes: `runtime_config_failed:${runtime.status}` };
    const hasContract = typeof runtime.body?.capabilities === 'object' || typeof runtime.body?.apiContractVersion === 'number';
    return { pass: hasContract, notes: hasContract ? 'runtime_contract_ok' : 'runtime_contract_missing' };
  });

  await runCheck('E31-009', 'Dual-write parity evidence from runtime', async () => {
    const exists = await tableExists(config, 'food_v2_dual_write_parity');
    if (!exists) return { pass: false, notes: 'food_v2_dual_write_parity_missing' };
    const day = isoDay(0);
    const read = await restSelect(config, {
      table: 'food_v2_dual_write_parity',
      apiKey: config.anonKey,
      bearerToken: regular.accessToken,
      query: `select=state_key,parity_ok,checked_at&user_id=eq.${encodeURIComponent(regular.userId)}&day=eq.${day}&order=checked_at.desc&limit=1`,
    });

    if (!read.ok) return { pass: false, notes: `dual_write_parity_read_failed:${read.status}` };
    const rows = Array.isArray(read.body) ? read.body : [];
    const parityOk = Boolean(rows[0]?.parity_ok);
    return { pass: rows.length > 0 && parityOk, notes: `rows=${rows.length},parity_ok=${parityOk}` };
  });

  const failed = checks.filter((row) => row.result !== 'PASS');
  const summary = {
    ok: failed.length === 0,
    createdAt: nowIso(),
    totals: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    failed: failed.map((row) => ({ id: row.id, notes: row.notes })),
    checks,
  };

  const jsonPath = writeJsonReport('e2e_report.json', summary);
  const md = [
    '# Phase 31 Cross-Phase E2E Report',
    '',
    `- Generated: ${summary.createdAt}`,
    `- Total checks: ${summary.totals.total}`,
    `- Passed: ${summary.totals.passed}`,
    `- Failed: ${summary.totals.failed}`,
    '',
    toMarkdownTable(['id', 'scenario', 'result', 'notes'], checks),
    '',
  ].join('\n');
  const mdPath = writeMarkdownReport('e2e_report.md', md);

  console.log('Phase 31 E2E check complete.');
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${mdPath}`);

  if (!summary.ok) {
    throw new Error(`phase31_e2e_failures:${failed.map((row) => row.id).join(',')}`);
  }
}

main().catch((error) => {
  console.error(`Phase 31 E2E check failed: ${error.message}`);
  process.exit(1);
});
