#!/usr/bin/env node
/* eslint-disable no-console */

const {
  phase30,
  writeJsonReport,
  nowIso,
} = require('./phase31-lib');

const { baseConfig, tableExists, restSelect, restUpsert } = phase30;

function remediationTypeForPath(criticalPath) {
  const key = String(criticalPath || '').toLowerCase();
  if (key === 'search') return 'search_latency_mitigation';
  if (key === 'logging') return 'dual_write_replay';
  if (key === 'sync') return 'sync_batch_replay';
  if (key === 'privacy_consent') return 'consent_enforcement_retry';
  if (key === 'retention') return 'retention_purge_replay';
  if (key === 'export_import') return 'export_import_retry';
  return 'generic_ops_repair';
}

async function main() {
  const config = baseConfig();

  const alertTableExists = await tableExists(config, 'food_v2_alert_events');
  const jobsTableExists = await tableExists(config, 'food_v2_remediation_jobs');

  if (!alertTableExists) throw new Error('food_v2_alert_events_missing');
  if (!jobsTableExists) throw new Error('food_v2_remediation_jobs_missing');

  const alertRead = await restSelect(config, {
    table: 'food_v2_alert_events',
    query: 'select=alert_id,critical_path,severity,actual_value,threshold,auto_action,owner,triggered_at,resolved_at&triggered_at=not.is.null&resolved_at=is.null&order=triggered_at.asc',
  });

  if (!alertRead.ok) {
    throw new Error(`alert_read_failed:${alertRead.status}:${JSON.stringify(alertRead.body)}`);
  }

  const activeAlerts = Array.isArray(alertRead.body) ? alertRead.body : [];

  const jobRead = await restSelect(config, {
    table: 'food_v2_remediation_jobs',
    query: 'select=remediation_id,job_type,target_scope,status,executed_at,audit_log&order=executed_at.desc.nullslast',
  });

  if (!jobRead.ok) {
    throw new Error(`remediation_jobs_read_failed:${jobRead.status}:${JSON.stringify(jobRead.body)}`);
  }

  const existingJobs = Array.isArray(jobRead.body) ? jobRead.body : [];

  const results = [];
  for (const alert of activeAlerts) {
    const existingForAlert = existingJobs.find((job) => {
      const target = job && typeof job.target_scope === 'object' ? job.target_scope : {};
      return String(target.alertId || '') === String(alert.alert_id) && String(job.status || '').toLowerCase() === 'executed';
    });

    if (existingForAlert) {
      const closeAlert = await restUpsert(config, {
        table: 'food_v2_alert_events',
        onConflict: 'alert_id',
        rows: {
          alert_id: alert.alert_id,
          critical_path: alert.critical_path,
          severity: alert.severity,
          threshold: alert.threshold,
          actual_value: alert.actual_value,
          triggered_at: alert.triggered_at,
          resolved_at: nowIso(),
          auto_action: alert.auto_action || 'alert_only',
          owner: alert.owner,
        },
      });

      results.push({
        alertId: alert.alert_id,
        criticalPath: alert.critical_path,
        action: 'skip_existing',
        remediationId: existingForAlert.remediation_id,
        status: closeAlert.ok ? 'skipped' : 'partial_failure',
        closeStatus: closeAlert.status,
      });
      continue;
    }

    const remediationType = remediationTypeForPath(alert.critical_path);
    const auditLog = {
      source: 'phase31-remediation',
      executedAt: nowIso(),
      actor: 'automation',
      reason: `Auto remediation for ${alert.critical_path} ${alert.severity}`,
      alertSnapshot: {
        threshold: Number(alert.threshold || 0),
        actualValue: Number(alert.actual_value || 0),
        autoAction: alert.auto_action,
      },
    };

    const createJob = await restUpsert(config, {
      table: 'food_v2_remediation_jobs',
      rows: {
        job_type: remediationType,
        target_scope: {
          alertId: alert.alert_id,
          criticalPath: alert.critical_path,
          owner: alert.owner,
        },
        status: 'executed',
        executed_at: nowIso(),
        audit_log: auditLog,
      },
    });

    if (!createJob.ok) {
      results.push({
        alertId: alert.alert_id,
        criticalPath: alert.critical_path,
        action: remediationType,
        status: 'failed',
        error: `job_create_failed:${createJob.status}`,
      });
      continue;
    }

    const remediationId = Array.isArray(createJob.body) && createJob.body.length
      ? createJob.body[0].remediation_id
      : null;

    const closeAlert = await restUpsert(config, {
      table: 'food_v2_alert_events',
      onConflict: 'alert_id',
      rows: {
        alert_id: alert.alert_id,
        critical_path: alert.critical_path,
        severity: alert.severity,
        threshold: alert.threshold,
        actual_value: alert.actual_value,
        triggered_at: alert.triggered_at,
        resolved_at: nowIso(),
        auto_action: alert.auto_action || 'alert_only',
        owner: alert.owner,
      },
    });

    const ok = closeAlert.ok;
    results.push({
      alertId: alert.alert_id,
      criticalPath: alert.critical_path,
      action: remediationType,
      remediationId,
      status: ok ? 'resolved' : 'partial_failure',
      closeStatus: closeAlert.status,
    });
  }

  const failed = results.filter((r) => r.status === 'failed' || r.status === 'partial_failure');

  const summary = {
    ok: failed.length === 0,
    createdAt: nowIso(),
    totals: {
      activeAlerts: activeAlerts.length,
      remediated: results.filter((r) => r.status === 'resolved').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: failed.length,
    },
    results,
  };

  const reportPath = writeJsonReport('remediation_logs.json', summary);
  console.log('Phase 31 remediation run complete.');
  console.log(`Report: ${reportPath}`);

  if (!summary.ok) {
    throw new Error('phase31_remediation_failures_detected');
  }
}

main().catch((error) => {
  console.error(`Phase 31 remediation run failed: ${error.message}`);
  process.exit(1);
});
