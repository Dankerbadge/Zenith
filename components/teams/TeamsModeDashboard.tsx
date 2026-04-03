import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BottomSheet from '../ui/BottomSheet';
import EmptyState from '../ui/EmptyState';
import EventCard from '../ui/EventCard';
import ModuleCard from '../ui/ModuleCard';
import { APP_CONFIG } from '../../utils/appConfig';
import { toLocalDateKey, getEventSource } from '../../utils/eventsUi';
import { getUserProfile, setStorageItem, USER_PROFILE_KEY } from '../../utils/storageUtils';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../../app/context/authcontext';

const SCALE_1_TO_5 = [1, 2, 3, 4, 5] as const;
const SCALE_PAIN = [0, 1, 2] as const;

type TeamSummary = { teamId: string; name: string; role: string };

type CheckinDraft = {
  sleep: number;
  fatigue: number;
  soreness: number;
  stress: number;
  mood: number;
  pain: number;
  note: string;
};

function dateKey(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatRelative(iso?: string | null) {
  const ts = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ts)) return 'recently';
  const deltaSec = Math.max(0, (Date.now() - ts) / 1000);
  if (deltaSec < 60) return 'just now';
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function emptyDraft(): CheckinDraft {
  return { sleep: 3, fatigue: 3, soreness: 3, stress: 3, mood: 3, pain: 0, note: '' };
}

function roleLabel(raw: string) {
  const role = String(raw || '').trim().toLowerCase();
  if (role === 'owner') return 'Coach';
  if (role === 'admin') return 'Admin';
  if (role === 'coach' || role === 'trainer') return 'Coach';
  return 'Athlete';
}

function ScaleSelector<T extends number>({
  values,
  value,
  onChange,
}: {
  values: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.scaleRow}>
      {values.map((opt) => {
        const active = opt === value;
        return (
          <Pressable key={String(opt)} style={[styles.scaleChip, active && styles.scaleChipOn]} onPress={() => onChange(opt)}>
            <Text style={[styles.scaleChipText, active && styles.scaleChipTextOn]}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function shouldIncludeForNextEvent(ev: any): boolean {
  const source = getEventSource(ev);
  if (source === 'team' || source === 'personal') return true;

  // For non-team groups: only surface events the user is attending.
  const enabled = Boolean(ev?.rsvp_enabled);
  if (!enabled) return true;
  const status = String(ev?.my_rsvp?.status || '').trim().toLowerCase();
  return status === 'going' || status === 'maybe';
}

function average(nums: number[]) {
  const clean = nums.filter((n) => Number.isFinite(Number(n)));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

export default function TeamsModeDashboard(props: { preferredTeamId: string | null }) {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);

  const [teamGroupId, setTeamGroupId] = useState<string | null>(null);

  const [checkinsLoading, setCheckinsLoading] = useState(false);
  const [checkinsError, setCheckinsError] = useState<string | null>(null);
  const [myCheckins, setMyCheckins] = useState<any[]>([]);

  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updatesError, setUpdatesError] = useState<string | null>(null);
  const [updates, setUpdates] = useState<any[]>([]);

  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);

  const [teamEventsLoading, setTeamEventsLoading] = useState(false);
  const [teamEventsError, setTeamEventsError] = useState<string | null>(null);
  const [teamUpcomingTraining, setTeamUpcomingTraining] = useState<any[]>([]);
  const [todayTraining, setTodayTraining] = useState<any | null>(null);

  const [checkinOpen, setCheckinOpen] = useState(false);
  const [draft, setDraft] = useState<CheckinDraft>(emptyDraft());
  const [savingCheckin, setSavingCheckin] = useState(false);

  const activeTeam = useMemo(() => teams.find((t) => t.teamId === activeTeamId) || null, [teams, activeTeamId]);

  const today = dateKey();
  const latestCheckin = myCheckins[0] || null;
  const checkinDue = useMemo(() => String(latestCheckin?.checkin_date || '') !== today, [latestCheckin?.checkin_date, today]);

  const nextEvent = useMemo(() => {
    const filtered = (Array.isArray(upcomingEvents) ? upcomingEvents : []).filter((ev) => shouldIncludeForNextEvent(ev));
    return filtered[0] || null;
  }, [upcomingEvents]);

  const insights = useMemo(() => {
    const rows = Array.isArray(myCheckins) ? myCheckins : [];
    if (!rows.length) return null;
    const sleepAvg = average(rows.map((r: any) => Number(r?.sleep_quality)));
    const fatigueAvg = average(rows.map((r: any) => Number(r?.fatigue_level)));
    const sorenessAvg = average(rows.map((r: any) => Number(r?.soreness_level)));
    const stressAvg = average(rows.map((r: any) => Number(r?.stress_level)));
    const moodAvg = average(rows.map((r: any) => Number(r?.mood_level)));
    return { sleepAvg, fatigueAvg, sorenessAvg, stressAvg, moodAvg };
  }, [myCheckins]);

  const persistPreferredTeam = useCallback(async (teamId: string) => {
    const normalized = String(teamId || '').trim();
    if (!normalized) return;
    try {
      const profile = await getUserProfile();
      await setStorageItem(USER_PROFILE_KEY, {
        ...profile,
        preferences: {
          ...(profile.preferences || {}),
          dashboardTeamsModeTeamId: normalized,
        },
      });
    } catch {
      // ignore; this only improves UX.
    }
  }, []);

  const loadTeams = useCallback(async () => {
    if (!viewerUserId || !isSupabaseConfigured || !socialEnabled) return;
    setLoading(true);
    setError(null);
    try {
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

      setTeams(mapped);
      setActiveTeamId((prev) => {
        const preferred = String(props.preferredTeamId || '').trim();
        if (preferred && mapped.some((t) => t.teamId === preferred)) return preferred;
        if (prev && mapped.some((t) => t.teamId === prev)) return prev;
        return mapped[0]?.teamId || null;
      });
    } catch (err: any) {
      setError(String(err?.message || 'Unable to load Teams Mode dashboard.'));
      setTeams([]);
      setActiveTeamId(null);
    } finally {
      setLoading(false);
    }
  }, [viewerUserId, socialEnabled, props.preferredTeamId]);

  const loadActiveTeamData = useCallback(async () => {
    if (!viewerUserId || !activeTeamId || !isSupabaseConfigured) {
      setTeamGroupId(null);
      setMyCheckins([]);
      setUpdates([]);
      setUpcomingEvents([]);
      setTodayTraining(null);
      setTeamUpcomingTraining([]);
      return;
    }

    const nowIso = new Date().toISOString();

    setCheckinsLoading(true);
    setCheckinsError(null);
    setUpdatesLoading(true);
    setUpdatesError(null);
    setEventsLoading(true);
    setEventsError(null);
    setTeamEventsLoading(true);
    setTeamEventsError(null);

    try {
      const [checkinRows, teamGroup, global] = await Promise.all([
        socialApi.getTeamCheckins(activeTeamId, { limit: 14, userId: viewerUserId }),
        socialApi.getTeamGroup(activeTeamId),
        socialApi.getEventsForUser(viewerUserId, { fromIso: nowIso, limit: 80, includeRsvpCounts: true }),
      ]);

      setMyCheckins(Array.isArray(checkinRows) ? checkinRows : []);
      setUpcomingEvents(Array.isArray(global) ? global : []);

      const gid = teamGroup?.id ? String(teamGroup.id) : null;
      setTeamGroupId(gid);

      if (gid) {
        const [postRows, groupEvents] = await Promise.all([
          socialApi.getGroupPosts(gid, 6),
          socialApi.getEventsForUser(viewerUserId, { groupId: gid, fromIso: nowIso, limit: 80, includeRsvpCounts: true }),
        ]);
        setUpdates(Array.isArray(postRows) ? postRows : []);

        const upcomingTraining = (Array.isArray(groupEvents) ? groupEvents : [])
          .filter((ev: any) => String(ev?.event_type || '').trim().toLowerCase() === 'training')
          .filter((ev: any) => Date.parse(String(ev?.start_at || '')) >= Date.now())
          .sort((a: any, b: any) => Date.parse(String(a?.start_at || '')) - Date.parse(String(b?.start_at || '')))
          .slice(0, 6);
        setTeamUpcomingTraining(upcomingTraining);

        const todayKey = dateKey();
        const todayPick =
          upcomingTraining.find((ev: any) => toLocalDateKey(String(ev?.start_at || '')) === todayKey) ||
          (Array.isArray(groupEvents) ? groupEvents : []).find((ev: any) => toLocalDateKey(String(ev?.start_at || '')) === todayKey) ||
          null;
        setTodayTraining(todayPick);
      } else {
        setUpdates([]);
        setTodayTraining(null);
        setTeamUpcomingTraining([]);
      }
    } catch (err: any) {
      const msg = String(err?.message || 'Unable to load Teams Mode data.');
      setCheckinsError(msg);
      setUpdatesError(msg);
      setEventsError(msg);
      setTeamEventsError(msg);
      setMyCheckins([]);
      setUpdates([]);
      setUpcomingEvents([]);
      setTodayTraining(null);
      setTeamUpcomingTraining([]);
      setTeamGroupId(null);
    } finally {
      setCheckinsLoading(false);
      setUpdatesLoading(false);
      setEventsLoading(false);
      setTeamEventsLoading(false);
    }
  }, [viewerUserId, activeTeamId]);

  useFocusEffect(
    useCallback(() => {
      void loadTeams();
    }, [loadTeams])
  );

  useFocusEffect(
    useCallback(() => {
      void loadActiveTeamData();
    }, [loadActiveTeamData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadTeams();
      await loadActiveTeamData();
    } finally {
      setRefreshing(false);
    }
  };

  const openCheckin = () => {
    setDraft((prev) => {
      const existing = latestCheckin || null;
      if (!existing) return emptyDraft();
      return {
        sleep: Number(existing.sleep_quality || 3),
        fatigue: Number(existing.fatigue_level || 3),
        soreness: Number(existing.soreness_level || 3),
        stress: Number(existing.stress_level || 3),
        mood: Number(existing.mood_level || 3),
        pain: Number(existing.pain_flag || 0),
        note: existing.note ? String(existing.note) : '',
      };
    });
    setCheckinOpen(true);
  };

  const submitCheckin = async () => {
    if (!viewerUserId || !activeTeamId) return;
    if (savingCheckin) return;
    setSavingCheckin(true);
    try {
      await socialApi.upsertTeamCheckin({
        teamId: activeTeamId,
        userId: viewerUserId,
        checkinDate: today,
        sleepQuality: draft.sleep,
        fatigueLevel: draft.fatigue,
        sorenessLevel: draft.soreness,
        stressLevel: draft.stress,
        moodLevel: draft.mood,
        painFlag: draft.pain,
        note: draft.note.trim() || null,
      });
      setCheckinOpen(false);
      await loadActiveTeamData();
    } catch (err: any) {
      Alert.alert('Check-in failed', String(err?.message || 'Try again.'));
    } finally {
      setSavingCheckin(false);
    }
  };

  if (!socialEnabled) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <EmptyState title="Teams Mode is disabled." body="Enable social features to use Teams Mode Dashboard." icon="⚙️" primaryAction={{ label: 'Profile', onPress: () => router.push('/(tabs)/profile' as any) }} />
        </View>
      </SafeAreaView>
    );
  }

  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <EmptyState
            title="Sign in required"
            body="Sign in to load your teams and events."
            icon="🔐"
            primaryAction={{ label: 'Sign in', onPress: () => router.push('/auth/login' as any) }}
            secondaryAction={{ label: 'Back to Profile', onPress: () => router.push('/(tabs)/profile' as any) }}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <EmptyState title="Cloud sync required" body="Configure Supabase to use Teams Mode." icon="☁️" primaryAction={{ label: 'Profile', onPress: () => router.push('/(tabs)/profile' as any) }} />
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.info}>Loading team cockpit…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Teams Mode error.</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.centerCta} onPress={() => void loadTeams()}>
            <Text style={styles.centerCtaText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!teams.length) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>Dashboard</Text>
            <Pressable onPress={() => router.push('/events' as any)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Open Event Center">
              <Text style={styles.iconText}>🏁</Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>Teams Mode setup</Text>
          <ModuleCard title="Team setup in progress" subtitle="Join a team or finish coach access setup to unlock your team cockpit.">
            <View style={styles.rowActions}>
              <Pressable style={styles.primaryBtn} onPress={() => router.push('/teams' as any)}>
                <Text style={styles.primaryBtnText}>Open Teams</Text>
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={() => router.push('/(tabs)/profile' as any)}>
                <Text style={styles.secondaryBtnText}>Profile</Text>
              </Pressable>
            </View>
          </ModuleCard>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#8FDBFF" />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Dashboard</Text>
          <Pressable onPress={() => router.push('/events' as any)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Open Event Center">
            <Text style={styles.iconText}>🏁</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>Team cockpit</Text>

        <Pressable
          style={styles.teamChip}
          onPress={() => setTeamPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Switch team"
        >
          <Text style={styles.teamChipText} numberOfLines={1}>
            {activeTeam ? `${activeTeam.name} ▾` : 'Choose team ▾'}
          </Text>
          <Text style={styles.teamChipMeta}>{activeTeam ? roleLabel(activeTeam.role) : ''}</Text>
        </Pressable>

        <ModuleCard title="Today" variant="hero">
          {teamEventsLoading ? <Text style={styles.info}>Loading today…</Text> : null}
          {teamEventsError ? <Text style={styles.warn}>Today unavailable: {teamEventsError}</Text> : null}
          {!teamEventsLoading && !teamEventsError && todayTraining ? (
            <EventCard
              event={todayTraining}
              variant="hero"
              onPress={() => router.push(`/events/${String(todayTraining.id)}` as any)}
              onRsvpPress={() => router.push(`/events/${String(todayTraining.id)}?rsvp=1` as any)}
            />
          ) : null}
          {!teamEventsLoading && !teamEventsError && !todayTraining ? (
            <Text style={styles.info}>No scheduled session today.</Text>
          ) : null}
        </ModuleCard>

        <ModuleCard title="Check-ins">
          {checkinsLoading ? <Text style={styles.info}>Loading check-ins…</Text> : null}
          {checkinsError ? <Text style={styles.warn}>Check-ins unavailable: {checkinsError}</Text> : null}
          {!checkinsLoading && !checkinsError ? (
            <>
              <Text style={styles.info}>
                {checkinDue
                  ? 'Daily check-in is due. Complete in about 15 seconds.'
                  : `Check-in submitted ${formatRelative(String(latestCheckin?.submitted_at || latestCheckin?.updated_at || ''))}.`}
              </Text>
              <View style={styles.rowActions}>
                <Pressable style={styles.primaryBtn} onPress={openCheckin}>
                  <Text style={styles.primaryBtnText}>{checkinDue ? 'Complete check-in' : 'Update check-in'}</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </ModuleCard>

        <ModuleCard title="Coach updates" rightAction={teamGroupId ? { label: 'Open', onPress: () => router.push(`/groups/${teamGroupId}` as any) } : undefined}>
          {updatesLoading ? <Text style={styles.info}>Loading updates…</Text> : null}
          {updatesError ? <Text style={styles.warn}>Updates unavailable: {updatesError}</Text> : null}
          {!updatesLoading && !updatesError && updates.length === 0 ? <Text style={styles.info}>No announcements yet.</Text> : null}
          {!updatesError && updates.length ? (
            <View style={{ gap: 10 }}>
              {updates.slice(0, 2).map((p: any) => (
                <View key={String(p?.id || Math.random())} style={styles.updateRow}>
                  <Text style={styles.updateTitle} numberOfLines={2}>
                    {String(p?.content || '').trim() || 'Update'}
                  </Text>
                  <Text style={styles.updateMeta}>{String(p?.profiles?.display_name || p?.profiles?.username || 'Coach')}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </ModuleCard>

        <ModuleCard title="Next event" rightAction={{ label: 'All events', onPress: () => router.push('/events' as any) }}>
          {eventsLoading ? <Text style={styles.info}>Loading events…</Text> : null}
          {eventsError ? <Text style={styles.warn}>Events unavailable: {eventsError}</Text> : null}
          {!eventsLoading && !eventsError && nextEvent ? (
            <EventCard
              event={nextEvent}
              variant="hero"
              onPress={() => router.push(`/events/${String(nextEvent.id)}` as any)}
              onRsvpPress={() => router.push(`/events/${String(nextEvent.id)}?rsvp=1` as any)}
            />
          ) : null}
          {!eventsLoading && !eventsError && !nextEvent ? <Text style={styles.info}>No upcoming events yet.</Text> : null}
        </ModuleCard>

        <ModuleCard title="Upcoming training" rightAction={{ label: 'Events', onPress: () => router.push('/events' as any) }} variant="list">
          {teamEventsLoading ? <Text style={styles.info}>Loading training…</Text> : null}
          {teamEventsError ? <Text style={styles.warn}>Training unavailable: {teamEventsError}</Text> : null}
          {!teamEventsLoading && !teamEventsError && !teamUpcomingTraining.length ? (
            <Text style={styles.info}>No upcoming training events yet.</Text>
          ) : null}
          {!teamEventsError && teamUpcomingTraining.length ? (
            <>
              {teamUpcomingTraining.slice(0, 3).map((ev: any) => (
                <EventCard
                  key={String(ev?.id || Math.random())}
                  event={ev}
                  onPress={() => router.push(`/events/${String(ev.id)}` as any)}
                  onRsvpPress={() => router.push(`/events/${String(ev.id)}?rsvp=1` as any)}
                />
              ))}
            </>
          ) : null}
        </ModuleCard>

        <ModuleCard title="Quick actions" variant="list">
          <View style={styles.quickRow}>
            <Pressable style={styles.quickBtn} onPress={() => router.push('/events' as any)}>
              <Text style={styles.quickEmoji}>🏁</Text>
              <Text style={styles.quickText}>Events</Text>
            </Pressable>
            <Pressable
              style={styles.quickBtn}
              onPress={() => {
                if (!activeTeamId) return;
                router.push(`/teams/${activeTeamId}` as any);
              }}
              disabled={!activeTeamId}
            >
              <Text style={styles.quickEmoji}>👥</Text>
              <Text style={styles.quickText}>Team</Text>
            </Pressable>
            <Pressable
              style={styles.quickBtn}
              onPress={() => {
                if (!teamGroupId) return;
                router.push(`/groups/${teamGroupId}` as any);
              }}
              disabled={!teamGroupId}
            >
              <Text style={styles.quickEmoji}>🗣️</Text>
              <Text style={styles.quickText}>Updates</Text>
            </Pressable>
            <Pressable style={styles.quickBtn} onPress={openCheckin}>
              <Text style={styles.quickEmoji}>✅</Text>
              <Text style={styles.quickText}>Check-in</Text>
            </Pressable>
          </View>
        </ModuleCard>

        <ModuleCard title="Insights">
          {checkinsLoading ? <Text style={styles.info}>Loading insights…</Text> : null}
          {!checkinsLoading && insights ? (
            <View style={styles.insightsGrid}>
              <View style={styles.insightCell}>
                <Text style={styles.insightLabel}>Sleep</Text>
                <Text style={styles.insightValue}>{insights.sleepAvg != null ? insights.sleepAvg.toFixed(1) : '—'}</Text>
              </View>
              <View style={styles.insightCell}>
                <Text style={styles.insightLabel}>Fatigue</Text>
                <Text style={styles.insightValue}>{insights.fatigueAvg != null ? insights.fatigueAvg.toFixed(1) : '—'}</Text>
              </View>
              <View style={styles.insightCell}>
                <Text style={styles.insightLabel}>Soreness</Text>
                <Text style={styles.insightValue}>{insights.sorenessAvg != null ? insights.sorenessAvg.toFixed(1) : '—'}</Text>
              </View>
              <View style={styles.insightCell}>
                <Text style={styles.insightLabel}>Stress</Text>
                <Text style={styles.insightValue}>{insights.stressAvg != null ? insights.stressAvg.toFixed(1) : '—'}</Text>
              </View>
            </View>
          ) : null}
          {!checkinsLoading && !insights ? <Text style={styles.info}>No check-in history yet.</Text> : null}
        </ModuleCard>
      </ScrollView>

      <BottomSheet
        visible={teamPickerOpen}
        title="Switch team"
        subtitle="Changes the active team in Teams Mode."
        onClose={() => setTeamPickerOpen(false)}
        scroll
        footer={
          <Pressable style={styles.sheetClose} onPress={() => setTeamPickerOpen(false)}>
            <Text style={styles.sheetCloseText}>Close</Text>
          </Pressable>
        }
      >
        {teams.map((t) => {
          const active = t.teamId === activeTeamId;
          return (
            <Pressable
              key={t.teamId}
              style={styles.sheetRow}
              onPress={() => {
                setTeamPickerOpen(false);
                setActiveTeamId(t.teamId);
                void persistPreferredTeam(t.teamId);
              }}
            >
              <Text style={styles.sheetRowText}>{t.name}</Text>
              {active ? <Text style={styles.sheetCheck}>✓</Text> : null}
            </Pressable>
          );
        })}
      </BottomSheet>

      <Modal visible={checkinOpen} transparent animationType="slide" onRequestClose={() => setCheckinOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Daily Check-in</Text>
            <Text style={styles.modalSubtitle}>Complete in ~15 seconds. Scores are shared with your team coach.</Text>

            <Text style={styles.modalLabel}>Sleep quality</Text>
            <ScaleSelector values={SCALE_1_TO_5} value={draft.sleep} onChange={(v) => setDraft((p) => ({ ...p, sleep: v }))} />

            <Text style={styles.modalLabel}>Fatigue</Text>
            <ScaleSelector values={SCALE_1_TO_5} value={draft.fatigue} onChange={(v) => setDraft((p) => ({ ...p, fatigue: v }))} />

            <Text style={styles.modalLabel}>Soreness</Text>
            <ScaleSelector values={SCALE_1_TO_5} value={draft.soreness} onChange={(v) => setDraft((p) => ({ ...p, soreness: v }))} />

            <Text style={styles.modalLabel}>Stress</Text>
            <ScaleSelector values={SCALE_1_TO_5} value={draft.stress} onChange={(v) => setDraft((p) => ({ ...p, stress: v }))} />

            <Text style={styles.modalLabel}>Mood</Text>
            <ScaleSelector values={SCALE_1_TO_5} value={draft.mood} onChange={(v) => setDraft((p) => ({ ...p, mood: v }))} />

            <Text style={styles.modalLabel}>Pain / injury flag</Text>
            <ScaleSelector values={SCALE_PAIN} value={draft.pain} onChange={(v) => setDraft((p) => ({ ...p, pain: v }))} />

            <TextInput
              value={draft.note}
              onChangeText={(v) => setDraft((p) => ({ ...p, note: v }))}
              placeholder="Optional note"
              placeholderTextColor="#7E8E93"
              style={styles.noteInput}
              multiline
              maxLength={220}
            />

            <View style={styles.rowActions}>
              <Pressable style={styles.modalGhost} onPress={() => setCheckinOpen(false)} disabled={savingCheckin}>
                <Text style={styles.modalGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalPrimary} onPress={() => void submitCheckin()} disabled={savingCheckin}>
                <Text style={styles.modalPrimaryText}>{savingCheckin ? 'Submitting…' : 'Submit'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 28 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 26 },
  subtitle: { color: '#86A6B0', marginTop: 4, fontWeight: '700' },
  iconBtn: {
    minHeight: 40,
    minWidth: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 16 },

  teamChip: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(20,20,20,0.9)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  teamChipText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  teamChipMeta: { color: '#86A6B0', marginTop: 4, fontWeight: '700', fontSize: 12 },

  rowActions: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  primaryBtn: { minHeight: 40, borderRadius: 12, backgroundColor: '#00D9FF', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#001018', fontWeight: '900', fontSize: 12 },
  secondaryBtn: { minHeight: 40, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(20,20,20,0.75)', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { color: '#D7F2FA', fontWeight: '800', fontSize: 12 },

  updateRow: { paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  updateTitle: { color: '#F3FCFF', fontWeight: '800' },
  updateMeta: { color: '#86A6B0', marginTop: 4, fontWeight: '700', fontSize: 12 },

  quickRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  quickBtn: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 64,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
    padding: 12,
    justifyContent: 'center',
  },
  quickEmoji: { fontSize: 18, marginBottom: 8 },
  quickText: { color: '#EAFBFF', fontWeight: '900' },

  insightsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  insightCell: {
    flexGrow: 1,
    flexBasis: '45%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(0,0,0,0.18)',
    padding: 12,
  },
  insightLabel: { color: '#86A6B0', fontWeight: '900', fontSize: 11, letterSpacing: 0.6 },
  insightValue: { color: '#FFFFFF', fontWeight: '900', fontSize: 18, marginTop: 6 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  info: { color: '#C7E0E9', fontWeight: '700' },
  warn: { color: '#FFB4A5', fontWeight: '700' },
  empty: { color: '#C7C7C7', fontWeight: '700', textAlign: 'center' },
  errorText: { color: '#FFB4A5', fontWeight: '700', marginTop: 8, textAlign: 'center' },
  centerCta: { marginTop: 10, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  centerCtaText: { color: '#001018', fontWeight: '900' },

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

  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)' },
  modalCard: { backgroundColor: '#0F0F0F', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, borderWidth: 1, borderColor: '#222' },
  modalTitle: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  modalSubtitle: { color: '#86A6B0', marginTop: 6, fontWeight: '700' },
  modalLabel: { color: '#B4CBD1', marginTop: 14, marginBottom: 6, fontWeight: '800', fontSize: 12 },
  noteInput: {
    marginTop: 12,
    minHeight: 70,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(20,20,20,0.8)',
    color: '#F3F3F3',
    paddingHorizontal: 12,
    paddingTop: 10,
    fontWeight: '600',
    textAlignVertical: 'top',
  },
  modalGhost: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  modalGhostText: { color: '#D7F2FA', fontWeight: '900' },
  modalPrimary: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  modalPrimaryText: { color: '#001018', fontWeight: '900' },

  scaleRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  scaleChip: {
    minWidth: 44,
    minHeight: 38,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(20,20,20,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleChipOn: { borderColor: '#00D9FF', backgroundColor: 'rgba(0,217,255,0.14)' },
  scaleChipText: { color: '#C7C7C7', fontWeight: '900' },
  scaleChipTextOn: { color: '#EAFBFF' },
});
