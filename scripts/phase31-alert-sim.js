#!/usr/bin/env node
/* eslint-disable no-console */

const {
  phase30,
  metricForAlertSimulation,
  evaluateAlertBreach,
  writeJsonReport,
  nowIso,
} = require('./phase31-lib');

const { baseConfig, tableExists, restSelect, restUpsert } = phase30;

async function writeIncident(config, event, actualValue, autoAction) {
  const incidentTableExists = await tableExists(config, 'food_v2_incident_reports');
  if (!incidentTableExists) return { written: false, reason: 'food_v2_incident_reports_missing' };

  const res = await restUpsert(config, {
    table: 'food_v2_incident_reports',
    rows: {
      critical_path: event.critical_path,
      severity: event.severity,
      start_time: nowIso(),
      resolved_time: null,
      owner: event.owner || 'unknown',
      notes: `phase31_alert_sim actual=${actualValue} threshold=${event.threshold} auto=${autoAction}`,
    },
  });

  if (!res.ok) {
    return { written: false, reason: `incident_insert_failed:${res.status}` };
  }

  return { written: true };
}

async function main() {
  const config = baseConfig();
  const alertTableExists = await tableExists(config, 'food_v2_alert_events');
  if (!alertTableExists) {
    throw new Error('food_v2_alert_events_missing');
  }

  const read = await restSelect(config, {
    table: 'food_v2_alert_events',
    query: 'select=alert_id,critical_path,severity,threshold,actual_value,triggered_at,resolved_at,auto_action,owner&order=critical_path.asc,threshold.asc',
  });

  if (!read.ok) {
    throw new Error(`alert_events_read_failed:${read.status}:${JSON.stringify(read.body)}`);
  }

  const rows = Array.isArray(read.body) ? read.body : [];
  if (!rows.length) {
    throw new Error('no_alert_events_to_simulate:run_phase31_fixtures_first');
  }

  const results = [];
  for (const row of rows) {
    const actualValue = metricForAlertSimulation(row);
    const evalResult = evaluateAlertBreach(row, actualValue);

    const patch = await restUpsert(config, {
      table: 'food_v2_alert_events',
      onConflict: 'alert_id',
      rows: {
        alert_id: row.alert_id,
        critical_path: row.critical_path,
        severity: row.severity,
        threshold: row.threshold,
        actual_value: actualValue,
        triggered_at: evalResult.isBreached ? nowIso() : row.triggered_at,
        resolved_at: null,
        auto_action: evalResult.autoAction,
        owner: row.owner,
      },
    });

    if (!patch.ok) {
      throw new Error(`alert_event_patch_failed:${patch.status}:${JSON.stringify(patch.body)}`);
    }

    let incident = { written: false };
    if (evalResult.isBreached) {
      incident = await writeIncident(config, row, actualValue, evalResult.autoAction);
    }

    results.push({
      alertId: row.alert_id,
      criticalPath: row.critical_path,
      severity: row.severity,
      threshold: Number(row.threshold),
      actualValue,
      breached: evalResult.isBreached,
      autoAction: evalResult.autoAction,
      owner: row.owner,
      incident,
    });
  }

  const breached = results.filter((r) => r.breached);
  const sev1Breached = breached.some((r) => String(r.severity).toLowerCase() === 'sev1');
  const sev2Breached = breached.some((r) => String(r.severity).toLowerCase() === 'sev2');

  const summary = {
    ok: breached.length > 0 && sev1Breached && sev2Breached,
    createdAt: nowIso(),
    totals: {
      total: results.length,
      breached: breached.length,
      sev1Breached,
      sev2Breached,
    },
    results,
  };

  const reportPath = writeJsonReport('alert_simulation.json', summary);
  console.log('Phase 31 alert simulation complete.');
  console.log(`Report: ${reportPath}`);

  if (!summary.ok) {
    throw new Error('alert_simulation_expectation_failed');
  }
}

main().catch((error) => {
  console.error(`Phase 31 alert simulation failed: ${error.message}`);
  process.exit(1);
});
