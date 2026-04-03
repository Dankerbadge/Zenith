import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import BottomSheet from '../../components/ui/BottomSheet';
import Chip from '../../components/ui/Chip';
import EmptyState from '../../components/ui/EmptyState';
import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { getUserProfile, setStorageItem, USER_PROFILE_KEY } from '../../utils/storageUtils';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

type Prefs = {
  dashboardTeamsModeEnabled?: boolean;
  dashboardTeamsModeTeamId?: string | null;
};

type TeamSummary = { teamId: string; name: string; role: string };

const COACH_ACCESS_REQUESTED_KEY = 'teams:coach_access_requested_v1';

function parseCoachReq(raw: string | null): boolean {
  if (!raw) return false;
  if (raw === 'true') return true;
  return raw.trim().startsWith('{');
}

export default function DashboardPreferencesScreen() {
  const insets = useSafeAreaInsets();
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<Prefs>({ dashboardTeamsModeEnabled: false, dashboardTeamsModeTeamId: null });
  const [coachAccessRequested, setCoachAccessRequested] = useState(false);

  const [eligibleTeams, setEligibleTeams] = useState<TeamSummary[]>([]);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const [pendingEnable, setPendingEnable] = useState(false);

  const teamsEligible = useMemo(() => eligibleTeams.length > 0 || coachAccessRequested, [eligibleTeams.length, coachAccessRequested]);

  const resolvedTeam = useMemo(() => {
    const current = String(prefs.dashboardTeamsModeTeamId || '').trim();
    if (current && eligibleTeams.some((t) => t.teamId === current)) return eligibleTeams.find((t) => t.teamId === current) || null;
    return eligibleTeams[0] || null;
  }, [eligibleTeams, prefs.dashboardTeamsModeTeamId]);

  const persistPrefs = useCallback(async (next: Prefs) => {
    setPrefs(next);
    const profile = await getUserProfile();
    await setStorageItem(USER_PROFILE_KEY, {
      ...profile,
      preferences: {
        ...(profile.preferences || {}),
        dashboardTeamsModeEnabled: Boolean(next.dashboardTeamsModeEnabled),
        dashboardTeamsModeTeamId: next.dashboardTeamsModeTeamId ?? null,
      },
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await getUserProfile();
      const profilePrefs = (profile.preferences || {}) as Prefs;
      setPrefs({
        dashboardTeamsModeEnabled: Boolean(profilePrefs.dashboardTeamsModeEnabled),
        dashboardTeamsModeTeamId: typeof profilePrefs.dashboardTeamsModeTeamId === 'string' ? String(profilePrefs.dashboardTeamsModeTeamId) : null,
      });

      const rawCoachReq = await AsyncStorage.getItem(COACH_ACCESS_REQUESTED_KEY);
      const coachReq = parseCoachReq(rawCoachReq);
      setCoachAccessRequested(coachReq);

      if (!viewerUserId || !socialEnabled || !isSupabaseConfigured) {
        setEligibleTeams([]);
        return;
      }

      const mine = await socialApi.getMyTeams(viewerUserId);
      const rows = Array.isArray(mine) ? mine : [];
      const mapped: TeamSummary[] = rows
        .map((row: any) => {
          const team = row?.teams || null;
          const teamId = String(row?.team_id || team?.id || '').trim();
          if (!teamId) return null;
          const name = String(team?.name || 'Team').trim() || 'Team';
          const role = String(row?.role || 'member').trim() || 'member';
          return { teamId, name, role };
        })
        .filter(Boolean) as TeamSummary[];
      setEligibleTeams(mapped);
    } catch (err: any) {
      setError(String(err?.message || 'Unable to load dashboard preferences.'));
      setEligibleTeams([]);
    } finally {
      setLoading(false);
    }
  }, [viewerUserId, socialEnabled]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Auto-revert Teams Mode if eligibility is lost.
  useFocusEffect(
    useCallback(() => {
      if (loading) return;
      const enabled = Boolean(prefs.dashboardTeamsModeEnabled);
      if (!enabled) return;
      if (teamsEligible) return;
      void persistPrefs({ ...prefs, dashboardTeamsModeEnabled: false, dashboardTeamsModeTeamId: null });
    }, [loading, persistPrefs, prefs, teamsEligible])
  );

  const toggleTeamsMode = async () => {
    if (loading) return;
    if (!teamsEligible) return;
    const currentlyOn = Boolean(prefs.dashboardTeamsModeEnabled);
    if (currentlyOn) {
      await persistPrefs({ ...prefs, dashboardTeamsModeEnabled: false });
      return;
    }

    if (!eligibleTeams.length) {
      // Coach/start-team request path: allow enabling even without an active team.
      await persistPrefs({ ...prefs, dashboardTeamsModeEnabled: true, dashboardTeamsModeTeamId: null });
      return;
    }

    if (eligibleTeams.length === 1) {
      await persistPrefs({ ...prefs, dashboardTeamsModeEnabled: true, dashboardTeamsModeTeamId: eligibleTeams[0].teamId });
      return;
    }

    const current = String(prefs.dashboardTeamsModeTeamId || '').trim();
    if (current && eligibleTeams.some((t) => t.teamId === current)) {
      await persistPrefs({ ...prefs, dashboardTeamsModeEnabled: true, dashboardTeamsModeTeamId: current });
      return;
    }

    setPendingEnable(true);
    setTeamPickerOpen(true);
  };

  const chooseTeam = async (teamId: string) => {
    const normalized = String(teamId || '').trim();
    if (!normalized) return;
    const exists = eligibleTeams.some((t) => t.teamId === normalized);
    if (!exists) return;
    setPendingEnable(false);
    setTeamPickerOpen(false);
    await persistPrefs({
      ...prefs,
      dashboardTeamsModeTeamId: normalized,
      dashboardTeamsModeEnabled: pendingEnable ? true : Boolean(prefs.dashboardTeamsModeEnabled),
    });
  };

  const togglePill = (active: boolean, onPress: () => void, disabled?: boolean) => (
    <Pressable
      onPress={onPress}
      style={[styles.togglePill, active ? styles.toggleOn : styles.toggleOff, disabled && styles.disabled]}
      disabled={disabled}
    >
      <View style={[styles.toggleThumb, active ? styles.toggleThumbOn : styles.toggleThumbOff]} />
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Dashboard</Text>
          <View style={{ width: 60 }} />
        </View>

        {error ? (
          <GlassCard>
            <Text style={styles.empty}>Dashboard preferences error.</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={loading}>
              <Text style={styles.retryText}>{loading ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <SectionHeader title="DASHBOARD MODE" />
        <GlassCard>
          <View style={styles.rowSplit}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Normal dashboard</Text>
              <Text style={styles.rowValue}>Your default dashboard</Text>
            </View>
            <Chip label="Default" active onPress={() => {}} disabled />
          </View>

          <View style={styles.divider} />

          {teamsEligible ? (
            <>
              <View style={styles.rowSplit}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Teams Mode Dashboard</Text>
                  <Text style={styles.rowValue}>
                    {prefs.dashboardTeamsModeEnabled
                      ? resolvedTeam
                        ? `On · ${resolvedTeam.name}`
                        : coachAccessRequested
                        ? 'On · Setup in progress'
                        : 'On'
                      : loading
                      ? 'Loading…'
                      : 'Off'}
                  </Text>
                </View>
                {togglePill(Boolean(prefs.dashboardTeamsModeEnabled), () => void toggleTeamsMode(), loading)}
              </View>

              {prefs.dashboardTeamsModeEnabled && eligibleTeams.length > 1 ? (
                <Pressable style={styles.rowBtn} onPress={() => setTeamPickerOpen(true)}>
                  <Text style={styles.rowTitle}>Primary team</Text>
                  <Text style={styles.rowValue}>{resolvedTeam?.name || 'Select'}</Text>
                </Pressable>
              ) : null}

              <Text style={styles.helperText}>
                Teams Mode swaps your Dashboard into a team cockpit. Eligibility: accepted into a team or a start-team request.
              </Text>
            </>
          ) : loading ? (
            <Text style={styles.helperText}>Loading eligibility…</Text>
          ) : (
            <EmptyState
              icon="🏁"
              title={socialEnabled ? 'Teams Mode not active yet' : 'Social features not enabled in this build'}
              body={
                socialEnabled
                  ? 'Join or create a team (or request coach access) to enable Teams Mode.'
                  : 'Dashboard is running in personal mode. Teams Mode becomes available when social features are enabled.'
              }
              primaryAction={{ label: 'Open Teams', onPress: () => router.push('/teams' as any) }}
              secondaryAction={
                viewerUserId
                  ? { label: 'Check Teams tab', onPress: () => router.push('/(tabs)/teams' as any) }
                  : { label: 'Sign in', onPress: () => router.push('/auth/login' as any) }
              }
            />
          )}
        </GlassCard>
      </ScrollView>

      <BottomSheet
        visible={teamPickerOpen}
        title="Choose primary team"
        subtitle="Required when you belong to multiple teams."
        onClose={() => {
          setPendingEnable(false);
          setTeamPickerOpen(false);
        }}
        scroll
        footer={
          <Pressable
            style={styles.sheetClose}
            onPress={() => {
              setPendingEnable(false);
              setTeamPickerOpen(false);
            }}
          >
            <Text style={styles.sheetCloseText}>Close</Text>
          </Pressable>
        }
      >
        {eligibleTeams.map((t) => {
          const active = String(prefs.dashboardTeamsModeTeamId || '') === t.teamId;
          return (
            <Pressable key={t.teamId} style={styles.sheetRow} onPress={() => void chooseTeam(t.teamId)}>
              <Text style={styles.sheetRowText}>{t.name}</Text>
              {active ? <Text style={styles.sheetCheck}>✓</Text> : null}
            </Pressable>
          );
        })}
        {!eligibleTeams.length ? <Text style={styles.helperText}>No teams found yet.</Text> : null}
        <View style={{ height: Math.max(12, insets.bottom) }} />
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 30 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { paddingVertical: 8, paddingHorizontal: 8 },
  backText: { color: '#7EDCFF', fontWeight: '900' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 18 },

  empty: { color: '#C7C7C7', fontWeight: '800', textAlign: 'center' },
  errorText: { color: '#FFB4A5', fontWeight: '700', marginTop: 8, textAlign: 'center' },
  retryBtn: { marginTop: 10, minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#001018', fontWeight: '900' },

  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 12 },
  helperText: { color: '#9BB9C2', fontWeight: '700', marginTop: 10, fontSize: 12, textAlign: 'center' },

  rowSplit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowBtn: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowTitle: { color: '#FFFFFF', fontWeight: '900' },
  rowValue: { color: '#8FA6AE', marginTop: 4, fontWeight: '700', fontSize: 12 },

  togglePill: {
    width: 54,
    height: 30,
    borderRadius: 999,
    padding: 3,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: 'rgba(0,217,255,0.9)' },
  toggleOff: { backgroundColor: '#2A2A2A' },
  toggleThumb: { width: 24, height: 24, borderRadius: 999 },
  toggleThumbOn: { backgroundColor: '#FFFFFF', alignSelf: 'flex-end' },
  toggleThumbOff: { backgroundColor: '#888888', alignSelf: 'flex-start' },
  disabled: { opacity: 0.6 },

  sheetRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetRowText: { color: '#EAEAEA', fontWeight: '900' },
  sheetCheck: { color: '#00D9FF', fontWeight: '900' },
  sheetClose: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCloseText: { color: '#C8C8C8', fontWeight: '900' },
});
