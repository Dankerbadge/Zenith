import { useFocusEffect } from '@react-navigation/native';
import { Redirect, router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import BottomSheet from '../../components/ui/BottomSheet';
import Chip from '../../components/ui/Chip';
import EmptyState from '../../components/ui/EmptyState';
import EventCard from '../../components/ui/EventCard';
import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { getEventSource, splitUpcomingPast } from '../../utils/eventsUi';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

type Segment = 'upcoming' | 'past';
type SourceFilter = 'all' | 'team' | 'group' | 'personal';
type TypeFilter = 'all' | 'training' | 'social' | 'race' | 'meeting' | 'travel' | 'other';

type CreateGroupTarget = { groupId: string; name: string; kind: 'team' | 'group' };

function isCoachLikeTeamRole(role: string) {
  const r = String(role || '').trim().toLowerCase();
  return r === 'owner' || r === 'admin' || r === 'coach' || r === 'trainer';
}

export default function EventsCenterScreen() {
  const insets = useSafeAreaInsets();
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);

  const [segment, setSegment] = useState<Segment>('upcoming');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [groupTargets, setGroupTargets] = useState<CreateGroupTarget[]>([]);

  const load = useCallback(async () => {
    if (!viewerUserId || !isSupabaseConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 120);
      const to = new Date(now);
      to.setDate(to.getDate() + 365);
      const rows = await socialApi.getEventsForUser(viewerUserId, {
        limit: 240,
        fromIso: from.toISOString(),
        toIso: to.toISOString(),
        includeRsvpCounts: true,
      });
      setEvents(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      setError(String(err?.message || 'Unable to load events.'));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [viewerUserId]);

  const loadCreateTargets = useCallback(async () => {
    if (!viewerUserId || !isSupabaseConfigured) return;
    if (addLoading) return;
    setAddLoading(true);
    setAddError(null);
    try {
      const [myGroups, myTeams] = await Promise.all([socialApi.getMyGroups(viewerUserId), socialApi.getMyTeams(viewerUserId)]);
      const teamRows = Array.isArray(myTeams) ? myTeams : [];
      const coachTeamIds = new Set(
        teamRows
          .filter((row: any) => isCoachLikeTeamRole(String(row?.role || '')))
          .map((row: any) => String(row?.team_id || row?.teams?.id || '').trim())
          .filter(Boolean)
      );

      const groupRows = Array.isArray(myGroups) ? myGroups : [];
      const targets: CreateGroupTarget[] = groupRows
        .map((row: any) => {
          const group = row?.groups || null;
          const groupId = String(row?.group_id || group?.id || '').trim();
          if (!groupId) return null;
          const name = String(group?.name || 'Group').trim() || 'Group';
          const role = String(row?.role || '').trim().toLowerCase();
          const kind = String(group?.kind || '').trim().toLowerCase();
          const joinCode = String(group?.join_code || '').trim();

          if (joinCode.startsWith('dm:')) return null;

          const isGroupAdmin = role === 'owner' || role === 'admin' || role === 'mod';
          const isTeamGroup = kind === 'coaching_team' || joinCode.toLowerCase().startsWith('team:');
          if (isGroupAdmin) return { groupId, name, kind: isTeamGroup ? 'team' : 'group' } as const;

          if (isTeamGroup && joinCode.toLowerCase().startsWith('team:')) {
            const teamId = joinCode.split(':')[1] || '';
            if (teamId && coachTeamIds.has(teamId)) return { groupId, name, kind: 'team' } as const;
          }

          return null;
        })
        .filter(Boolean) as CreateGroupTarget[];

      targets.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'team' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setGroupTargets(targets);
    } catch (err: any) {
      setAddError(String(err?.message || 'Unable to load event creation targets.'));
      setGroupTargets([]);
    } finally {
      setAddLoading(false);
    }
  }, [viewerUserId, addLoading]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const { upcoming, past } = useMemo(() => splitUpcomingPast(events), [events]);

  const filtered = useMemo(() => {
    const base = segment === 'upcoming' ? upcoming : past;
    return (Array.isArray(base) ? base : []).filter((ev: any) => {
      const source = getEventSource(ev);
      if (sourceFilter !== 'all' && source !== sourceFilter) return false;
      const type = String(ev?.event_type || '').trim().toLowerCase();
      if (typeFilter !== 'all' && type !== typeFilter) return false;
      return true;
    });
  }, [segment, past, upcoming, sourceFilter, typeFilter]);

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;
  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}><Text style={styles.empty}>Sign in to view events.</Text></View>
      </SafeAreaView>
    );
  }
  if (!isSupabaseConfigured) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Cloud sync is required to use events.</Text>
          <Pressable style={styles.centerCta} onPress={() => router.push('/auth/login' as any)}>
            <Text style={styles.centerCtaText}>Sign in</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor='#8FDBFF' />}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Events</Text>
          <Pressable
            onPress={() => {
              setAddOpen(true);
              void loadCreateTargets();
            }}
            style={styles.addBtn}
            accessibilityRole="button"
            accessibilityLabel="Add event"
          >
            <Text style={styles.addText}>+ Add</Text>
          </Pressable>
        </View>

        <View style={styles.segmentRow}>
          {(['upcoming', 'past'] as const).map((key) => {
            const active = segment === key;
            return (
              <Pressable key={key} onPress={() => setSegment(key)} style={[styles.segment, active && styles.segmentOn]}>
                <Text style={[styles.segmentText, active && styles.segmentTextOn]}>{key === 'upcoming' ? 'Upcoming' : 'Past'}</Text>
              </Pressable>
            );
          })}
        </View>

        <GlassCard>
          <Text style={styles.kicker}>Filters</Text>
          <View style={styles.filterRow}>
            {([
              { key: 'all', label: 'All' },
              { key: 'team', label: 'Team' },
              { key: 'group', label: 'Groups' },
              { key: 'personal', label: 'Personal' },
            ] as const).map((opt) => (
              <Chip key={opt.key} label={opt.label} active={sourceFilter === opt.key} onPress={() => setSourceFilter(opt.key)} />
            ))}
          </View>
          <View style={[styles.filterRow, { marginTop: 10 }]}>
            {([
              { key: 'all', label: 'Type: All' },
              { key: 'race', label: 'Race' },
              { key: 'training', label: 'Training' },
              { key: 'social', label: 'Social' },
              { key: 'meeting', label: 'Meeting' },
              { key: 'travel', label: 'Travel' },
              { key: 'other', label: 'Other' },
            ] as const).map((opt) => (
              <Chip key={opt.key} label={opt.label} active={typeFilter === opt.key} onPress={() => setTypeFilter(opt.key)} />
            ))}
          </View>
        </GlassCard>

        {error ? (
          <GlassCard style={{ marginTop: 12 }}>
            <Text style={styles.empty}>Events backend error.</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={loading}>
              <Text style={styles.retryText}>{loading ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        <SectionHeader title={segment === 'upcoming' ? 'UPCOMING' : 'PAST'} />
        <View style={{ gap: 10 }}>
          {loading ? <Text style={styles.empty}>Loading events…</Text> : null}
          {!loading && !filtered.length ? (
            <GlassCard>
              <EmptyState
                icon="🏁"
                title={segment === 'upcoming' ? 'No upcoming events' : 'No past events'}
                body="Create a personal event, or create a group/team event if you have permissions."
                primaryAction={{ label: 'Add event', onPress: () => { setAddOpen(true); void loadCreateTargets(); } }}
              />
            </GlassCard>
          ) : null}
          {!loading && filtered.length
            ? filtered.map((ev: any) => (
                <EventCard
                  key={String(ev?.id || Math.random())}
                  event={ev}
                  variant="hero"
                  onPress={() => router.push(`/events/${String(ev.id)}` as any)}
                  onRsvpPress={() => router.push(`/events/${String(ev.id)}?rsvp=1` as any)}
                />
              ))
            : null}
        </View>
      </ScrollView>

      <BottomSheet
        visible={addOpen}
        title="Add event"
        subtitle="Personal events are private. Group/team events require permissions."
        onClose={() => setAddOpen(false)}
        scroll
        footer={
          <Pressable style={styles.sheetClose} onPress={() => setAddOpen(false)}>
            <Text style={styles.sheetCloseText}>Close</Text>
          </Pressable>
        }
      >
        <Pressable
          style={styles.sheetPrimary}
          onPress={() => {
            setAddOpen(false);
            router.push('/events/create' as any);
          }}
        >
          <Text style={styles.sheetPrimaryText}>Create personal event</Text>
        </Pressable>

        <Text style={styles.sheetKicker}>Create group/team event</Text>
        {addLoading ? <Text style={styles.sheetHint}>Loading groups…</Text> : null}
        {addError ? <Text style={[styles.sheetHint, { color: '#FFB4A5' }]}>{addError}</Text> : null}
        {!addLoading && !addError && !groupTargets.length ? <Text style={styles.sheetHint}>No eligible groups found.</Text> : null}
        {groupTargets.map((g) => (
          <Pressable
            key={g.groupId}
            style={styles.sheetRow}
            onPress={() => {
              setAddOpen(false);
              router.push(`/events/create?groupId=${encodeURIComponent(g.groupId)}` as any);
            }}
          >
            <Text style={styles.sheetRowText}>{g.name}</Text>
            <Text style={styles.sheetRowMeta}>{g.kind === 'team' ? 'Team' : 'Group'}</Text>
          </Pressable>
        ))}

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
  backText: { color: '#7EDCFF', fontWeight: '800' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 22 },
  addBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,217,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { color: '#BFF3FF', fontWeight: '900' },

  segmentRow: { flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 12 },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(20,20,20,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: { borderColor: 'rgba(0,217,255,0.55)', backgroundColor: 'rgba(0,217,255,0.14)' },
  segmentText: { color: '#C7C7C7', fontWeight: '900' },
  segmentTextOn: { color: '#EAFBFF' },

  kicker: { color: '#9EB8C1', fontWeight: '900', fontSize: 11, letterSpacing: 1, marginBottom: 8 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  empty: { color: '#C7C7C7', fontWeight: '700', textAlign: 'center', marginTop: 10 },
  errorText: { color: '#FFB4A5', fontWeight: '700', marginTop: 8, textAlign: 'center' },
  retryBtn: { marginTop: 10, minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#001018', fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  centerCta: { marginTop: 10, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  centerCtaText: { color: '#001018', fontWeight: '900' },

  sheetPrimary: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPrimaryText: { color: '#001018', fontWeight: '900' },
  sheetKicker: { color: '#9EB8C1', fontWeight: '900', fontSize: 11, letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  sheetHint: { color: '#9BB9C2', fontWeight: '700', marginTop: 8 },
  sheetRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetRowText: { color: '#EAEAEA', fontWeight: '900' },
  sheetRowMeta: { color: '#86A6B0', fontWeight: '800', fontSize: 12 },
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

