#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`Missing file: ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

function mustInclude(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`Missing ${label}: ${needle}`);
  }
}

function main() {
  const migration = read('supabase/migrations/20260325183000_phase29_privacy_consent_policy_hardening.sql');
  mustInclude(migration, 'create table if not exists public.food_v2_retention_policies', 'retention policy table');
  mustInclude(migration, 'create table if not exists public.food_v2_user_consent', 'user consent table');
  mustInclude(migration, 'create table if not exists public.food_v2_public_shares', 'public shares table');
  mustInclude(migration, 'create table if not exists public.food_v2_user_data_explanation', 'user data explanation table');
  mustInclude(migration, 'create table if not exists public.food_v2_privacy_audit_events', 'privacy audit table');
  mustInclude(migration, 'food_v2_enforce_retention_policies', 'retention enforcement function');
  mustInclude(migration, 'food_v2_append_privacy_audit_event', 'privacy audit append function');

  const appConfig = read('utils/appConfig.ts');
  mustInclude(appConfig, 'FF_RETENTION_WINDOW_ENFORCEMENT_ENABLED', 'retention feature flag');
  mustInclude(appConfig, 'FF_NOTIFICATION_CONSENT_ENABLED', 'notification consent feature flag');
  mustInclude(appConfig, 'FF_ANALYTICS_MINIMIZATION_ENABLED', 'analytics minimization feature flag');
  mustInclude(appConfig, 'FF_PUBLIC_SHARE_GUARD_ENABLED', 'public share guard feature flag');
  mustInclude(appConfig, 'FF_PRIVACY_UI_ENABLED', 'privacy UI feature flag');
  mustInclude(appConfig, 'FF_USER_VISIBLE_DATA_EXPLANATIONS_ENABLED', 'data explanation feature flag');

  const privacyConsentFn = read('supabase/functions/privacy-consent/index.ts');
  mustInclude(privacyConsentFn, "req.method !== 'GET' && req.method !== 'POST'", 'consent endpoint methods');
  mustInclude(privacyConsentFn, 'food_v2_user_consent', 'consent table usage');
  mustInclude(privacyConsentFn, 'food_v2_append_privacy_audit_event', 'consent audit event');

  const privacySharesFn = read('supabase/functions/privacy-public-shares/index.ts');
  mustInclude(privacySharesFn, "action !== 'activate' && action !== 'revoke'", 'share action validation');
  mustInclude(privacySharesFn, 'public_sharing_consent_required', 'share activation consent gate');

  const privacyExplainFn = read('supabase/functions/privacy-data-explanation/index.ts');
  mustInclude(privacyExplainFn, 'food_v2_user_data_explanation', 'data explanation upsert');
  mustInclude(privacyExplainFn, 'retentionPolicies', 'retention response payload');

  const retentionFn = read('supabase/functions/privacy-retention-enforce/index.ts');
  mustInclude(retentionFn, 'x-ops-key', 'ops key guard');
  mustInclude(retentionFn, 'food_v2_enforce_retention_policies', 'retention rpc invoke');

  const consentStore = read('utils/privacyConsentStore.ts');
  mustInclude(consentStore, 'PRIVACY_CONSENT_MIRROR_KEY', 'local consent mirror key');
  mustInclude(consentStore, 'getLocalPrivacyConsentSnapshot', 'local consent getter');

  const privacyService = read('utils/privacyService.ts');
  mustInclude(privacyService, "authedFunctionFetch('privacy-consent'", 'consent function client call');
  mustInclude(privacyService, 'isAnalyticsConsentGranted', 'analytics consent helper');
  mustInclude(privacyService, 'isNotificationConsentGranted', 'notification consent helper');

  const notificationService = read('utils/notificationService.ts');
  mustInclude(notificationService, 'hasNotificationConsent', 'notification consent guard');

  const crashReporter = read('utils/crashReporter.ts');
  mustInclude(crashReporter, 'hasAnalyticsConsent', 'analytics consent guard');

  const deleteMe = read('supabase/functions/delete-me/index.ts');
  mustInclude(deleteMe, 'food_v2_user_consent', 'delete account privacy consent cleanup');
  mustInclude(deleteMe, 'food_v2_public_shares', 'delete account public share cleanup');

  console.log('Phase 29 privacy hardening verification passed.');
  console.log('- Migration: retention/consent/share/explanation/audit tables + retention RPC');
  console.log('- Edge functions: consent, public share guard, data explanation, retention enforcement');
  console.log('- Client: local consent mirror + privacy service APIs');
  console.log('- Runtime gating: notifications and crash telemetry are consent-gated');
}

main();

