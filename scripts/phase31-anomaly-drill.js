#!/usr/bin/env node
/* eslint-disable no-console */

const {
  phase30,
  readReport,
  writeJsonReport,
  nowIso,
} = require('./phase31-lib');

const { baseConfig, tableExists, restSelect, restUpsert } = phase30;

function actionForSeverity(severity) {
  const sev = String(severity || '').toLowerCase();
  if (sev === 'sev1') return 'auto_rollback';
  if (sev === 'sev2') return 'canary_halt';
  return 'alert_only';
}

async function main() {
  const config = baseConfig();

  const alertsTableExists = await tableExists(config, 'food_v2_alert_events');
  if (!alertsTableExists) throw new Error('food_v2_alert_events_missing');

  const read = await restSelect(config, {
    table: 'food_v2_alert_events',
    query: 'select=alert_id,critical_path,severity,threshold,actual_value,triggered_at,resolved_at,auto_action,owner&triggered_at=not.is.null&resolved_at=is.null&order=triggered_at.desc',
  });

  if (!read.ok) {
    throw new Error(`alert_events_triggered_read_failed:${read.status}:${JSON.stringify(read.body)}`);
  }

  const rows = Array.isArray(read.body) ? read.body : [];
  if (!rows.length) {
    throw new Error('no_triggered_alerts_found:run_phase31:alert-sim_first');
  }

  let sloFailures = 0;
  try {
    const slo = readReport('slo_summary.json');
    sloFailures = Number(slo?.totals?.failed || 0);
  } catch {
    sloFailures = 0;
  }

  const anomalies = rows.map((row) => {
    const threshold = Number(row.threshold || 0);
    const actual = Number(row.actual_value || 0);
    const overBy = Number((actual - threshold).toFixed(4));
    const severityAction = actionForSeverity(row.severity);
    const preferredAction = row.auto_action || severityAction;

    return {
      alertId: row.alert_id,
      criticalPath: row.critical_path,
      severity: row.severity,
      threshold,
      actualValue: actual,
      overBy,
      preferredAction,
      owner: row.owner,
      detectedAt: nowIso(),
      notes: `Anomaly detected for ${row.critical_path}; threshold ${threshold}, actual ${actual}`,
    };
  });

  const incidentTableExists = await tableExists(config, 'food_v2_incident_reports');
  const writtenIncidents = [];
  if (incidentTableExists) {
    for (const anomaly of anomalies) {
      const insert = await restUpsert(config, {
        table: 'food_v2_incident_reports',
        rows: {
          critical_path: anomaly.criticalPath,
          severity: anomaly.severity,
          start_time: nowIso(),
          resolved_time: null,
          owner: anomaly.owner || 'unknown',
          notes: `phase31_anomaly_drill action=${anomaly.preferredAction} overBy=${anomaly.overBy}`,
        },
      });
      writtenIncidents.push({
        alertId: anomaly.alertId,
        ok: insert.ok,
        status: insert.status,
      });
    }
  }

  const haltCandidates = anomalies.filter((a) => a.preferredAction === 'canary_halt').length;
  const rollbackCandidates = anomalies.filter((a) => a.preferredAction === 'auto_rollback').length;

  const summary = {
    ok: anomalies.length > 0 && (haltCandidates > 0 || rollbackCandidates > 0),
    createdAt: nowIso(),
    totals: {
      anomalies: anomalies.length,
      haltCandidates,
      rollbackCandidates,
      sloFailures,
    },
    anomalies,
    incidents: {
      attempted: incidentTableExists ? anomalies.length : 0,
      written: writtenIncidents.filter((i) => i.ok).length,
      rows: writtenIncidents,
    },
  };

  const reportPath = writeJsonReport('anomaly_drill.json', summary);
  console.log('Phase 31 anomaly drill complete.');
  console.log(`Report: ${reportPath}`);

  if (!summary.ok) {
    throw new Error('anomaly_drill_expectation_failed');
  }
}

main().catch((error) => {
  console.error(`Phase 31 anomaly drill failed: ${error.message}`);
  process.exit(1);
});
