import React, { useEffect, useRef } from 'react';
import { Stack, usePathname } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppState } from 'react-native';
import AppErrorBoundary from '../components/AppErrorBoundary';
import RankUpCelebrationController from '../components/RankUpCelebrationController';
import { finalizeExpiredChallengesForUser } from '../utils/challengeService';
import { scheduleContextualNudges } from '../utils/notificationService';
import { runStorageMigrations } from '../utils/storageMigrations';
import { initCrashReporting, setCrashRoute } from '../utils/crashReporter';
import { AuthProvider } from './context/authcontext';
import { syncWearableSignalsIfEnabled } from '../utils/wearableImportService';
import ZenithNumberPadAccessory from '../components/inputs/ZenithNumberPadAccessory';
import { flushCloudStateSyncQueue } from '../utils/cloudStateSync';
import { getAuthenticatedUserId } from '../utils/authIdentity';
import '../utils/runBackgroundLocation';

export default function RootLayout() {
  const pathname = usePathname();
  const syncInFlightRef = useRef(false);

  useEffect(() => {
    void initCrashReporting();
    void runStorageMigrations();
    void scheduleContextualNudges();
    void (async () => {
      const userId = await getAuthenticatedUserId();
      if (!userId) return;
      await finalizeExpiredChallengesForUser(userId);
    })();
  }, []);

  useEffect(() => {
    let alive = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    let wearableInterval: ReturnType<typeof setInterval> | null = null;

    const maybeSync = async () => {
      if (!alive) return;
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      try {
        await syncWearableSignalsIfEnabled();
      } finally {
        syncInFlightRef.current = false;
      }
    };

    void maybeSync();
    void flushCloudStateSyncQueue('open');
    interval = setInterval(() => {
      void flushCloudStateSyncQueue('interval');
    }, 30000);
    wearableInterval = setInterval(() => {
      void maybeSync();
    }, 5 * 60 * 1000);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void maybeSync();
        void flushCloudStateSyncQueue('foreground');
      } else if (state === 'background' || state === 'inactive') {
        void flushCloudStateSyncQueue('background');
      }
    });

    return () => {
      alive = false;
      if (interval) clearInterval(interval);
      if (wearableInterval) clearInterval(wearableInterval);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    setCrashRoute(pathname || null);
  }, [pathname]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppErrorBoundary>
        <AuthProvider>
          <>
            <ZenithNumberPadAccessory />
            <RankUpCelebrationController pathname={pathname} />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="paywall" />
              <Stack.Screen name="health-permissions" />
              <Stack.Screen name="live-run" />
              <Stack.Screen name="live-lift" />
              <Stack.Screen name="live-session" />
              <Stack.Screen name="manual-run" />
              <Stack.Screen name="run-review" />
              <Stack.Screen name="run-summary" />
              <Stack.Screen name="challenges" />
              <Stack.Screen name="messages" />
              <Stack.Screen name="clubs" />
              <Stack.Screen name="auth" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(modals)" options={{ presentation: 'modal' }} />
            </Stack>
          </>
        </AuthProvider>
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}
