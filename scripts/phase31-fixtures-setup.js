#!/usr/bin/env node
/* eslint-disable no-console */

const {
  phase30,
  readPhase31Seed,
  baselineMetricValue,
  writeJsonReport,
  nowIso,
  FIXTURE_SCHEMA_PATH,
} = require('./phase31-lib');

const {
  baseConfig,
  tableExists,
  restUpsert,
  restDelete,
  ensureFixtureUser,
} = phase30;

const FIXTURE_USERS = [
  {
    key: 'phase31_regular',
    email: 'phase31_regular@zenithfit.app',
    password: 'Phase31!Regular#2026',
    displayName: 'Phase 31 Regular',
    username: 'phase31_regular',
    role: 'user',
  },
  {
    key: 'phase31_legacy',
    email: 'phase31_legacy@zenithfit.app',
    password: 'Phase31!Legacy#2026',
    displayName: 'Phase 31 Legacy',
    username: 'phase31_legacy',
    role: 'user',
  },
  {
    key: 'phase31_admin',
    email: 'phase31_admin@zenithfit.app',
    password: 'Phase31!Admin#2026',
    displayName: 'Phase 31 Admin',
    username: 'phase31_admin',
    role: 'admin',
  },
];

function enc(v) {
  return encodeURIComponent(String(v));
}

async function ensureTables(config) {
  const required = [
    'food_v2_slo_metrics',
    'food_v2_alert_events',
    'food_v2_remediation_jobs',
    'food_v2_oncall_shifts',
    'food_v2_incident_reports',
  ];

  const out = {};
  const missing = [];
  for (const table of required) {
    const exists = await tableExists(config, table);
    out[table] = exists;
    if (!exists) missing.push(table);
  }

  if (missing.length) {
    throw new Error(
      `missing_phase31_fixture_tables:${missing.join(',')}. Apply ${FIXTURE_SCHEMA_PATH} in staging before seeding fixtures.`
    );
  }

  return out;
}

async function ensureUsers(config) {
  const created = {};
  for (const user of FIXTURE_USERS) {
    created[user.key] = await ensureFixtureUser(config, {
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
  }
  return created;
}

async function seedSloMetrics(config, seed) {
  const rows = (Array.isArray(seed.slo_metrics) ? seed.slo_metrics : []).map((row) => ({
    critical_path: row.critical_path,
    sli_metric: row.sli_metric,
    slo_target: row.slo_target,
    measurement_interval: row.measurement_interval,
    current_value: row.current_value == null ? baselineMetricValue(row) : row.current_value,
    updated_at: nowIso(),
  }));

  if (!rows.length) return { count: 0, skipped: true };

  const res = await restUpsert(config, {
    table: 'food_v2_slo_metrics',
    onConflict: 'critical_path,sli_metric,measurement_interval',
    rows,
  });
  if (!res.ok) {
    throw new Error(`seed_slo_metrics_failed:${res.status}:${JSON.stringify(res.body)}`);
  }
  return { count: rows.length, skipped: false };
}

async function seedAlertEvents(config, seed) {
  const events = Array.isArray(seed.alert_events) ? seed.alert_events : [];
  let inserted = 0;

  for (const event of events) {
    await restDelete(config, {
      table: 'food_v2_alert_events',
      query: `critical_path=eq.${enc(event.critical_path)}&severity=eq.${enc(event.severity)}&owner=eq.${enc(event.owner)}&triggered_at=is.null&resolved_at=is.null`,
    });

    const insert = await restUpsert(config, {
      table: 'food_v2_alert_events',
      rows: {
        critical_path: event.critical_path,
        severity: event.severity,
        threshold: event.threshold,
        actual_value: 0,
        triggered_at: null,
        resolved_at: null,
        auto_action: null,
        owner: event.owner,
      },
    });

    if (!insert.ok) {
      throw new Error(`seed_alert_event_failed:${insert.status}:${JSON.stringify(insert.body)}`);
    }

    inserted += 1;
  }

  return { count: inserted, skipped: inserted === 0 };
}

async function seedOnCall(config, seed) {
  const shifts = Array.isArray(seed.oncall_shifts) ? seed.oncall_shifts : [];
  let inserted = 0;

  for (const shift of shifts) {
    await restDelete(config, {
      table: 'food_v2_oncall_shifts',
      query: `owner=eq.${enc(shift.owner)}&tier=eq.${enc(shift.tier)}&start_time=eq.${enc(shift.start_time)}&end_time=eq.${enc(shift.end_time)}`,
    });

    const insert = await restUpsert(config, {
      table: 'food_v2_oncall_shifts',
      rows: {
        owner: shift.owner,
        tier: shift.tier,
        start_time: shift.start_time,
        end_time: shift.end_time,
        escalations: Array.isArray(shift.escalations) ? shift.escalations : [],
      },
    });

    if (!insert.ok) {
      throw new Error(`seed_oncall_shift_failed:${insert.status}:${JSON.stringify(insert.body)}`);
    }
    inserted += 1;
  }

  return { count: inserted, skipped: inserted === 0 };
}

async function seedConsentDefaults(config, users) {
  const consentTableExists = await tableExists(config, 'food_v2_user_consent');
  if (!consentTableExists) return { skipped: true, reason: 'food_v2_user_consent_missing', count: 0 };

  const rows = Object.values(users).map((u) => ({
    user_id: u.userId,
    notifications: false,
    analytics: false,
    public_sharing: false,
    consent_updated_at: nowIso(),
    notes: 'phase31_fixture',
  }));

  const res = await restUpsert(config, {
    table: 'food_v2_user_consent',
    onConflict: 'user_id',
    rows,
  });

  if (!res.ok) {
    throw new Error(`seed_user_consent_failed:${res.status}:${JSON.stringify(res.body)}`);
  }

  return { skipped: false, count: rows.length };
}

async function main() {
  const config = baseConfig();
  const seed = readPhase31Seed();

  const tableCheck = await ensureTables(config);
  const users = await ensureUsers(config);

  const slo = await seedSloMetrics(config, seed);
  const alerts = await seedAlertEvents(config, seed);
  const oncall = await seedOnCall(config, seed);
  const consent = await seedConsentDefaults(config, users);

  const report = {
    ok: true,
    createdAt: nowIso(),
    tableCheck,
    fixtures: {
      users,
      sloMetrics: slo,
      alertEvents: alerts,
      oncallShifts: oncall,
      consent,
    },
  };

  const reportPath = writeJsonReport('fixtures_report', report);
  console.log('Phase 31 fixtures setup complete.');
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(`Phase 31 fixtures setup failed: ${error.message}`);
  process.exit(1);
});
