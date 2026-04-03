import Constants from 'expo-constants';
import { getLocalPrivacyConsentSnapshot } from './privacyConsentStore';
import { APP_CONFIG } from './appConfig';

type CrashContext = Record<string, unknown>;

const ENV_SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';

let initialized = false;
let currentRoute: string | null = null;
let authMode: 'local_only' | 'connected' | 'unknown' = 'unknown';
let analyticsConsentCache = false;
let analyticsConsentCheckedAt = 0;
const ANALYTICS_CONSENT_CACHE_MS = 60_000;

function shouldEnableCrashReporting() {
  // Option 1 (locked): prod-only via DSN presence in production secrets.
  // TestFlight builds should omit DSN if you want prod-only collection.
  return !__DEV__ && Boolean(ENV_SENTRY_DSN && ENV_SENTRY_DSN.trim().length > 0);
}

async function hasAnalyticsConsent() {
  if (!APP_CONFIG.FEATURES.FF_ANALYTICS_MINIMIZATION_ENABLED) {
    return true;
  }
  const now = Date.now();
  if (now - analyticsConsentCheckedAt <= ANALYTICS_CONSENT_CACHE_MS) {
    return analyticsConsentCache;
  }
  analyticsConsentCheckedAt = now;
  try {
    const snapshot = await getLocalPrivacyConsentSnapshot();
    analyticsConsentCache = snapshot.analytics === true;
  } catch {
    analyticsConsentCache = false;
  }
  return analyticsConsentCache;
}

function getRelease() {
  const version =
    Constants.expoConfig?.version ||
    (Constants.manifest as any)?.version ||
    (Constants.manifest2 as any)?.version ||
    null;
  const build =
    (Constants.expoConfig as any)?.ios?.buildNumber ||
    (Constants.expoConfig as any)?.android?.versionCode ||
    null;
  return version ? (build ? `${version}(${String(build)})` : version) : undefined;
}

async function getSentry() {
  // Dynamic import keeps this module safe even if Sentry is later removed.
  const mod: any = await import('@sentry/react-native');
  return mod;
}

export async function initCrashReporting() {
  if (initialized) return;
  initialized = true;

  if (!shouldEnableCrashReporting()) return;

  try {
    const Sentry = await getSentry();
    Sentry.init({
      dsn: ENV_SENTRY_DSN,
      release: getRelease(),
      enableAutoSessionTracking: true,
    });
  } catch {
    // Never block app boot on crash tooling.
  }
}

export function setCrashRoute(route: string | null) {
  currentRoute = route;
}

export function setCrashAuthMode(mode: 'local_only' | 'connected' | 'unknown') {
  authMode = mode;
}

export async function captureException(error: unknown, context?: CrashContext) {
  if (!shouldEnableCrashReporting() || !(await hasAnalyticsConsent())) {
    if (__DEV__) {
      // Keep dev visibility without spamming production logs.
      // eslint-disable-next-line no-console
      console.error('[crashReporter.captureException]', error, context);
    }
    return;
  }

  try {
    const Sentry = await getSentry();
    Sentry.captureException(error, {
      contexts: {
        zenith: {
          route: currentRoute,
          authMode,
          ...context,
        },
      },
    });
  } catch {
    // ignore
  }
}

export async function captureMessage(message: string, context?: CrashContext) {
  if (!shouldEnableCrashReporting() || !(await hasAnalyticsConsent())) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[crashReporter.captureMessage]', message, context);
    }
    return;
  }

  try {
    const Sentry = await getSentry();
    Sentry.captureMessage(message, {
      contexts: {
        zenith: {
          route: currentRoute,
          authMode,
          ...context,
        },
      },
    });
  } catch {
    // ignore
  }
}
