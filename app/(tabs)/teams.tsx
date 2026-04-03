import { Redirect, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import Screen from '../../components/ui/Screen';
import ActionCard from '../../components/ui/ActionCard';
import { STATS_HIGHLIGHT_GLOSS, statsHighlightBorder, statsHighlightRail, statsHighlightWash } from '../../components/ui/statsHighlight';
import { NEON_THEME } from '../../constants/neonTheme';
import { APP_CONFIG } from '../../utils/appConfig';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { devErrorDetail, userFacingErrorMessage } from '../../utils/userFacingErrors';
import { useAuth } from '../context/authcontext';

const SCALE_1_TO_5 = [1, 2, 3, 4, 5] as const;
const SCALE_PAIN = [0, 1, 2] as const;

type TeamCardRow = {
  row: any;
  teamId: string;
  team: any | null;
  role: string;
  hasFeed: boolean;
  urgency: number;
  membersCount: number;
};

type TeamCheckin = {
  id: string;
  teamId: string;
  userId: string;
  date: string;
  submittedAtIso: string;
  sleep: number;
  fatigue: number;
  soreness: number;
  stress: number;
  mood: number;
  pain: number;
  note?: string;
};

type CheckinDraft = {
  sleep: number;
  fatigue: number;
  soreness: number;
  stress: number;
  mood: number;
  pain: number;
  note: string;
};

function roleLabel(raw: string) {
  const role = String(raw || '').trim().toLowerCase();
  if (role === 'owner') return 'Coach';
  if (role === 'admin') return 'Admin';
  if (role === 'coach' || role === 'trainer') return 'Coach';
  return 'Athlete';
}

function isCoachLike(raw: string) {
  const role = String(raw || '').trim().toLowerCase();
  return role === 'owner' || role === 'admin' || role === 'coach' || role === 'trainer';
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

function dateKey(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function weekdayStrip() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + mondayOffset + i);
    return {
      key: dateKey(d),
      short: d.toLocaleDateString(undefined, { weekday: 'short' }),
      day: d.getDate(),
      isToday: dateKey(d) === dateKey(now),
    };
  });
}

function emptyDraft(): CheckinDraft {
  return { sleep: 3, fatigue: 3, soreness: 3, stress: 3, mood: 3, pain: 0, note: '' };
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

function HighlightPanel(props: { children: React.ReactNode; color: string; style?: any }) {
  return (
    <View style={[props.style, styles.highlightPanel, { borderColor: statsHighlightBorder(props.color) }]}>
      <LinearGradient
        pointerEvents="none"
        colors={statsHighlightWash(props.color)}
        start={{ x: 0.1, y: 0.0 }}
        end={{ x: 0.9, y: 1.0 }}
        style={styles.highlightPanelWash}
      />
      <LinearGradient
        pointerEvents="none"
        colors={STATS_HIGHLIGHT_GLOSS}
        start={{ x: 0.5, y: 0.0 }}
        end={{ x: 0.5, y: 1.0 }}
        style={styles.highlightPanelWash}
      />
      <LinearGradient
        pointerEvents="none"
        colors={statsHighlightRail(props.color)}
        start={{ x: 0.5, y: 0.0 }}
        end={{ x: 0.5, y: 1.0 }}
        style={styles.highlightPanelRail}
      />
      {props.children}
    </View>
  );
}

export default function TeamsTabScreen() {
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<TeamCardRow[]>([]);
  const [membersByTeam, setMembersByTeam] = useState<Record<string, any[]>>({});
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [checkins, setCheckins] = useState<TeamCheckin[]>([]);
  const [checkinsLoading, setCheckinsLoading] = useState(false);
  const [checkinsError, setCheckinsError] = useState<string | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [draft, setDraft] = useState<CheckinDraft>(emptyDraft());
  const [savingCheckin, setSavingCheckin] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const mapRowToCheckin = useCallback((row: any): TeamCheckin => {
    return {
      id: String(row?.id || ''),
      teamId: String(row?.team_id || ''),
      userId: String(row?.user_id || ''),
      date: String(row?.checkin_date || ''),
      submittedAtIso: String(row?.submitted_at || row?.updated_at || row?.created_at || new Date().toISOString()),
      sleep: Number(row?.sleep_quality || 0),
      fatigue: Number(row?.fatigue_level || 0),
      soreness: Number(row?.soreness_level || 0),
      stress: Number(row?.stress_level || 0),
      mood: Number(row?.mood_level || 0),
      pain: Number(row?.pain_flag || 0),
      note: row?.note ? String(row.note) : undefined,
    };
  }, []);

  const loadTeamCheckins = useCallback(
    async (teamId: string) => {
      if (!teamId || !viewerUserId || !isSupabaseConfigured) {
        setCheckins([]);
        setCheckinsError(null);
        return;
      }
      setCheckinsLoading(true);
      setCheckinsError(null);
      try {
        const rows = await socialApi.getTeamCheckins(teamId, { limit: 400 });
        const mapped = (Array.isArray(rows) ? rows : []).map(mapRowToCheckin);
        setCheckins(mapped);
      } catch (err: any) {
        setCheckins([]);
        const message = userFacingErrorMessage(err, 'Unable to load check-ins.');
        const detail = __DEV__ ? devErrorDetail(err) : '';
        setCheckinsError(detail ? `${message}\n${detail}` : message);
      } finally {
        setCheckinsLoading(false);
      }
    },
    [viewerUserId, mapRowToCheckin]
  );

  const load = useCallback(async () => {
    if (!viewerUserId || !isSupabaseConfigured) return;
    setError(null);
    setLoading(true);
    try {
      const mine = await socialApi.getMyTeams(viewerUserId);
      const rows = Array.isArray(mine) ? mine : [];
      const enriched = await Promise.all(
        rows.map(async (row: any) => {
          const team = row?.teams || null;
          const teamId = String(row?.team_id || team?.id || '');
          const role = String(row?.role || 'member');
          let hasFeed = false;
          let memberRows: any[] = [];
          if (teamId) {
            try {
              const [group, members] = await Promise.all([socialApi.getTeamGroup(teamId), socialApi.getTeamMembers(teamId)]);
              hasFeed = Boolean(group?.id);
              memberRows = Array.isArray(members) ? members : [];
            } catch {
              hasFeed = false;
              memberRows = [];
            }
          }
          const membersCount = Number(team?.members_count || 0) || memberRows.length || 0;
          const urgency = (!hasFeed ? 2 : 0) + (isCoachLike(role) ? 1 : 0);
          return { row, teamId, team, role, hasFeed, urgency, membersCount, memberRows } as TeamCardRow & { memberRows: any[] };
        })
      );

      enriched.sort((a, b) => {
        if (b.urgency !== a.urgency) return b.urgency - a.urgency;
        const aTs = Date.parse(String(a.team?.updated_at || a.team?.created_at || 0)) || 0;
        const bTs = Date.parse(String(b.team?.updated_at || b.team?.created_at || 0)) || 0;
        return bTs - aTs;
      });

      const nextCards: TeamCardRow[] = enriched.map(({ memberRows: _mr, ...rest }) => rest);
      const nextMembersByTeam: Record<string, any[]> = {};
      enriched.forEach((entry) => {
        if (entry.teamId) nextMembersByTeam[entry.teamId] = entry.memberRows;
      });

      setCards(nextCards);
      setMembersByTeam(nextMembersByTeam);
      setActiveTeamId((prev) => {
        if (prev && nextCards.some((c) => c.teamId === prev)) return prev;
        return nextCards[0]?.teamId || null;
      });
    } catch (err: any) {
      const message = userFacingErrorMessage(err, 'Unable to load team hub.');
      const detail = __DEV__ ? devErrorDetail(err) : '';
      setError(detail ? `${message}\n${detail}` : message);
      setCards([]);
      setMembersByTeam({});
      setActiveTeamId(null);
    } finally {
      setLoading(false);
    }
  }, [viewerUserId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
      if (activeTeamId) await loadTeamCheckins(activeTeamId);
    } finally {
      setRefreshing(false);
    }
  }, [load, activeTeamId, loadTeamCheckins]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!activeTeamId) {
      setCheckins([]);
      setCheckinsError(null);
      return;
    }
    void loadTeamCheckins(activeTeamId);
  }, [activeTeamId, loadTeamCheckins]);

  const counts = useMemo(() => {
    const total = cards.length;
    const needsAttention = cards.filter((c) => !c.hasFeed).length;
    const coachTeams = cards.filter((c) => isCoachLike(c.role)).length;
    return { total, needsAttention, coachTeams };
  }, [cards]);

  const activeCard = useMemo(() => cards.find((c) => c.teamId === activeTeamId) || null, [cards, activeTeamId]);
  const activeMembers = useMemo(() => (activeTeamId ? membersByTeam[activeTeamId] || [] : []), [membersByTeam, activeTeamId]);
  const activeRoleIsCoach = useMemo(() => (activeCard ? isCoachLike(activeCard.role) : false), [activeCard]);

  const myLatestCheckin = useMemo(() => {
    if (!viewerUserId) return null;
    return (
      checkins
        .filter((c) => c.userId === viewerUserId)
        .sort((a, b) => Date.parse(b.submittedAtIso) - Date.parse(a.submittedAtIso))[0] || null
    );
  }, [checkins, viewerUserId]);

  const checkinDue = useMemo(() => {
    if (!myLatestCheckin) return true;
    return myLatestCheckin.date !== dateKey();
  }, [myLatestCheckin]);

  const triage = useMemo(() => {
    if (!activeTeamId) return { missing: 0, flagged: 0, highPain: 0, highFatigue: 0, items: [] as { userId: string; name: string; reason: string }[] };
    const latestByUser = new Map<string, TeamCheckin>();
    checkins.forEach((c) => {
      const existing = latestByUser.get(c.userId);
      if (!existing || Date.parse(c.submittedAtIso) > Date.parse(existing.submittedAtIso)) latestByUser.set(c.userId, c);
    });

    let missing = 0;
    let highPain = 0;
    let highFatigue = 0;
    const items: { userId: string; name: string; reason: string }[] = [];

    activeMembers
      .filter((m) => String(m?.role || '').toLowerCase() !== 'owner')
      .forEach((m) => {
        const userId = String(m?.user_id || '');
        const name = String(m?.profiles?.display_name || m?.profiles?.username || 'Athlete');
        const latest = latestByUser.get(userId);
        if (!latest || latest.date !== dateKey()) {
          missing += 1;
          items.push({ userId, name, reason: 'Missing daily check-in' });
          return;
        }
        if (latest.pain >= 2) {
          highPain += 1;
          items.push({ userId, name, reason: 'Pain flag submitted' });
          return;
        }
        if (latest.fatigue >= 5 || latest.soreness >= 5 || latest.stress >= 5 || latest.mood <= 2) {
          highFatigue += 1;
          items.push({ userId, name, reason: 'Recovery risk indicators' });
        }
      });

    const flagged = highPain + highFatigue;
    return { missing, flagged, highPain, highFatigue, items: items.slice(0, 5) };
  }, [activeMembers, activeTeamId, checkins]);

  const days = useMemo(() => weekdayStrip(), []);

  const openCheckin = useCallback(() => {
    if (!activeTeamId) {
      Alert.alert('No team selected', 'Select a team first.');
      return;
    }
    setDraft(emptyDraft());
    setCheckinOpen(true);
  }, [activeTeamId]);

  const submitCheckin = useCallback(async () => {
    if (!viewerUserId || !activeTeamId || savingCheckin) return;
    setSavingCheckin(true);
    try {
      await socialApi.upsertTeamCheckin({
        teamId: activeTeamId,
        userId: viewerUserId,
        checkinDate: dateKey(),
        sleepQuality: draft.sleep,
        fatigueLevel: draft.fatigue,
        sorenessLevel: draft.soreness,
        stressLevel: draft.stress,
        moodLevel: draft.mood,
        painFlag: draft.pain,
        note: draft.note.trim() || null,
      });
      await loadTeamCheckins(activeTeamId);
      setCheckinOpen(false);
    } catch (err: any) {
      const message = userFacingErrorMessage(err, 'Unable to submit check-in. Please try again.');
      const detail = __DEV__ ? devErrorDetail(err) : '';
      Alert.alert('Check-in failed', detail ? `${message}\n\n${detail}` : message);
    } finally {
      setSavingCheckin(false);
    }
  }, [viewerUserId, activeTeamId, savingCheckin, draft, loadTeamCheckins]);

  const openJoin = () => {
    setJoinCode('');
    setJoinOpen(true);
  };

  const openCreate = () => {
    setNewTeamName('');
    setNewTeamDesc('');
    setCreateOpen(true);
  };

  const createTeam = useCallback(async () => {
    if (!viewerUserId || actionBusy) return;
    const name = newTeamName.trim();
    if (!name) return;
    setActionBusy(true);
    try {
      const created = await socialApi.createTeam(viewerUserId, name, 'coaching_team', newTeamDesc.trim() || undefined);
      const teamId = String((created as any)?.id || '').trim();
      setCreateOpen(false);
      await load();
      if (teamId) {
        setActiveTeamId(teamId);
        router.push(`/teams/${teamId}` as any);
      }
    } catch (err: any) {
      const message = userFacingErrorMessage(err, 'Could not create team. Please try again.');
      const detail = __DEV__ ? devErrorDetail(err) : '';
      Alert.alert('Create failed', detail ? `${message}\n\n${detail}` : message);
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, load, newTeamDesc, newTeamName, viewerUserId]);

  const joinTeam = useCallback(async () => {
    if (!viewerUserId || actionBusy) return;
    setActionBusy(true);
    try {
      const res = await socialApi.joinTeamByInviteCode(viewerUserId, joinCode);
      const teamId = String((res as any)?.teamId || '').trim();
      if (!teamId) throw new Error('Join succeeded but team id was missing.');
      setJoinOpen(false);
      await load();
      setActiveTeamId(teamId);
      router.push(`/teams/${teamId}` as any);
    } catch (err: any) {
      const message = userFacingErrorMessage(err, 'Could not join team. Please try again.');
      const detail = __DEV__ ? devErrorDetail(err) : '';
      Alert.alert('Join failed', detail ? `${message}\n\n${detail}` : message);
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, joinCode, load, viewerUserId]);

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;

  if (!viewerUserId) {
    return (
      <Screen aura>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Teams requires sign-in</Text>
          <Text style={styles.emptyText}>Sign in to access your team hub, announcements, and check-ins.</Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.push('/auth/login' as any)}>
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <Screen aura>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Cloud sync required</Text>
          <Text style={styles.emptyText}>Teams relies on cloud sync and team membership data.</Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.push('/auth/login' as any)}>
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen aura>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={NEON_THEME.color.neonCyan} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Teams</Text>
            <Text style={styles.subtitle}>Role-aware command center for plan, check-ins, comms, and roster.</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable style={styles.headerBtn} onPress={openJoin} disabled={actionBusy}>
              <Text style={styles.headerBtnText}>Join</Text>
            </Pressable>
            <Pressable style={styles.headerBtn} onPress={openCreate} disabled={actionBusy}>
              <Text style={styles.headerBtnText}>Create</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.kpiRow}>
          <HighlightPanel style={styles.kpiCard} color="#FFB000">
            <Text style={styles.kpiValue}>{counts.needsAttention}</Text>
            <Text style={styles.kpiLabel}>Needs attention</Text>
          </HighlightPanel>
          <HighlightPanel style={styles.kpiCard} color="#00D9FF">
            <Text style={styles.kpiValue}>{counts.total}</Text>
            <Text style={styles.kpiLabel}>Active teams</Text>
          </HighlightPanel>
          <HighlightPanel style={styles.kpiCard} color="#A855F7">
            <Text style={styles.kpiValue}>{counts.coachTeams}</Text>
            <Text style={styles.kpiLabel}>Coach views</Text>
          </HighlightPanel>
        </View>

        {loading ? <Text style={styles.info}>Loading team hub…</Text> : null}
        {error ? (
          <HighlightPanel style={styles.errorCard} color="#FF5A7A">
            <Text style={styles.errorTitle}>Team hub sync issue</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={loading || refreshing}>
              <Text style={styles.retryBtnText}>{loading || refreshing ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </HighlightPanel>
        ) : null}

        {!loading && !error && !cards.length ? (
          <HighlightPanel style={styles.emptyCard} color="#4E5BFF">
            <Text style={styles.emptyTitle}>No teams yet</Text>
            <Text style={styles.emptyText}>Join a team, preview the dashboard, or explore programs.</Text>
            <View style={{ gap: 10, marginTop: 12 }}>
              <ActionCard emoji="🔢" label="Join a team" subtitle="Use a 6-digit invite code" onPress={openJoin} />
              <ActionCard emoji="✨" label="Create a team" subtitle="Coach or self-managed group" onPress={openCreate} />
              <ActionCard emoji="🧭" label="Explore directory" subtitle="Browse teams and programs" onPress={() => router.push('/teams' as any)} />
            </View>
          </HighlightPanel>
        ) : null}

        {!!cards.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Teams</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.teamSwitchRow}>
              {cards.map((card, index) => {
                const active = card.teamId === activeTeamId;
                const label = String(card.team?.name || `Team ${index + 1}`);
                return (
                  <Pressable
                    key={`${card.teamId || `team-${index}`}`}
                    style={[styles.teamSwitchChip, active && styles.teamSwitchChipOn]}
                    onPress={() => setActiveTeamId(card.teamId || null)}
                  >
                    <Text style={[styles.teamSwitchText, active && styles.teamSwitchTextOn]} numberOfLines={1}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {activeCard ? (
          <>
            <HighlightPanel style={styles.moduleCard} color="#00D9FF">
              <View style={styles.moduleHeader}>
                <Text style={styles.moduleTitle}>Today</Text>
                <View style={[styles.roleBadge, activeRoleIsCoach ? styles.roleBadgeCoach : styles.roleBadgeAthlete]}>
                  <Text style={styles.roleBadgeText}>{roleLabel(activeCard.role)}</Text>
                </View>
              </View>
              <Text style={styles.moduleBody}>
                {activeRoleIsCoach
                  ? `${triage.items.length} athletes currently need review.`
                  : checkinsLoading
                  ? 'Loading your latest check-in…'
                  : checkinDue
                  ? 'Daily check-in is due. Complete in about 15 seconds.'
                  : `Check-in submitted ${formatRelative(myLatestCheckin?.submittedAtIso)}.`}
              </Text>
              <View style={styles.rowActions}>
                {activeRoleIsCoach ? (
                  <Pressable style={styles.primaryBtn} onPress={() => router.push(`/teams/${activeCard.teamId}` as any)}>
                    <Text style={styles.primaryBtnText}>Open triage</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.primaryBtn} onPress={openCheckin}>
                    <Text style={styles.primaryBtnText}>{checkinDue ? 'Complete check-in' : 'Update check-in'}</Text>
                  </Pressable>
                )}
                <Pressable style={styles.secondaryBtn} onPress={() => router.push(`/teams/${activeCard.teamId}` as any)}>
                  <Text style={styles.secondaryBtnText}>Open team</Text>
                </Pressable>
              </View>
            </HighlightPanel>

            <HighlightPanel style={styles.moduleCard} color="#FFB000">
              <Text style={styles.moduleTitle}>Check-ins</Text>
              {checkinsLoading ? <Text style={styles.moduleBody}>Loading check-ins…</Text> : null}
              {checkinsError ? <Text style={styles.moduleBody}>Check-ins unavailable: {checkinsError}</Text> : null}
              {activeRoleIsCoach ? (
                <>
                  <Text style={styles.moduleBody}>
                    Missing {triage.missing} · Flags {triage.flagged} · Pain {triage.highPain} · Recovery risk {triage.highFatigue}
                  </Text>
                  {triage.items.length ? (
                    triage.items.map((item) => (
                      <View key={`${item.userId}-${item.reason}`} style={styles.triageRow}>
                        <Text style={styles.triageName}>{item.name}</Text>
                        <Text style={styles.triageReason}>{item.reason}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.moduleBody}>No current triage flags.</Text>
                  )}
                </>
              ) : (
                <>
                  {myLatestCheckin ? (
                    <Text style={styles.moduleBody}>
                      Sleep {myLatestCheckin.sleep}/5 · Fatigue {myLatestCheckin.fatigue}/5 · Soreness {myLatestCheckin.soreness}/5 · Stress {myLatestCheckin.stress}/5 · Mood {myLatestCheckin.mood}/5 · Pain {myLatestCheckin.pain}/2
                    </Text>
                  ) : (
                    <Text style={styles.moduleBody}>No check-in submitted yet for this team.</Text>
                  )}
                </>
              )}
            </HighlightPanel>

            <HighlightPanel style={styles.moduleCard} color="#4E5BFF">
              <Text style={styles.moduleTitle}>Plan (7-day preview)</Text>
              <View style={styles.weekRow}>
                {days.map((d) => (
                  <View key={d.key} style={[styles.dayChip, d.isToday && styles.dayChipToday]}>
                    <Text style={[styles.dayChipTop, d.isToday && styles.dayChipTopToday]}>{d.short}</Text>
                    <Text style={[styles.dayChipDay, d.isToday && styles.dayChipDayToday]}>{d.day}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.rowActions}>
                <Pressable style={styles.secondaryBtn} onPress={() => router.push(`/teams/${activeCard.teamId}` as any)}>
                  <Text style={styles.secondaryBtnText}>View full plan</Text>
                </Pressable>
              </View>
            </HighlightPanel>

            <HighlightPanel style={styles.moduleCard} color="#60A5FA">
              <Text style={styles.moduleTitle}>Communication</Text>
              <View style={styles.rowActions}>
                <Pressable style={styles.secondaryBtn} onPress={() => router.push(`/teams/${activeCard.teamId}` as any)}>
                  <Text style={styles.secondaryBtnText}>Announcements</Text>
                </Pressable>
                <Pressable style={styles.secondaryBtn} onPress={() => router.push('/groups' as any)}>
                  <Text style={styles.secondaryBtnText}>Channels</Text>
                </Pressable>
              </View>
              <View style={styles.rowActions}>
                <Pressable style={styles.secondaryBtn} onPress={() => router.push('/messages' as any)}>
                  <Text style={styles.secondaryBtnText}>Direct Messages</Text>
                </Pressable>
                <Pressable style={styles.secondaryBtn} onPress={() => router.push('/(tabs)/community/index' as any)}>
                  <Text style={styles.secondaryBtnText}>Community</Text>
                </Pressable>
              </View>
            </HighlightPanel>

            <HighlightPanel style={styles.moduleCard} color="#A855F7">
              <Text style={styles.moduleTitle}>Roster Snapshot</Text>
              {activeMembers.length ? (
                activeMembers.slice(0, 6).map((m: any, idx: number) => (
                  <View key={`${m?.id || m?.user_id || idx}`} style={styles.rosterRow}>
                    <Text style={styles.rosterName}>{String(m?.profiles?.display_name || m?.profiles?.username || 'Athlete')}</Text>
                    <Text style={styles.rosterRole}>{roleLabel(String(m?.role || 'member'))}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.moduleBody}>No roster entries loaded yet.</Text>
              )}
            </HighlightPanel>
          </>
        ) : null}
      </ScrollView>

      <Modal visible={checkinOpen} transparent animationType='slide' onRequestClose={() => setCheckinOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Daily Check-in</Text>
            <Text style={styles.modalSubtitle}>Complete in ~15 seconds. Scores are shared with your team coach.</Text>

            <Text style={styles.modalLabel}>Sleep quality</Text>
            <ScaleSelector
              values={SCALE_1_TO_5}
              value={draft.sleep}
              onChange={(v) => setDraft((p) => ({ ...p, sleep: v }))}
            />

            <Text style={styles.modalLabel}>Fatigue</Text>
            <ScaleSelector
              values={SCALE_1_TO_5}
              value={draft.fatigue}
              onChange={(v) => setDraft((p) => ({ ...p, fatigue: v }))}
            />

            <Text style={styles.modalLabel}>Soreness</Text>
            <ScaleSelector
              values={SCALE_1_TO_5}
              value={draft.soreness}
              onChange={(v) => setDraft((p) => ({ ...p, soreness: v }))}
            />

            <Text style={styles.modalLabel}>Stress</Text>
            <ScaleSelector
              values={SCALE_1_TO_5}
              value={draft.stress}
              onChange={(v) => setDraft((p) => ({ ...p, stress: v }))}
            />

            <Text style={styles.modalLabel}>Mood</Text>
            <ScaleSelector
              values={SCALE_1_TO_5}
              value={draft.mood}
              onChange={(v) => setDraft((p) => ({ ...p, mood: v }))}
            />

            <Text style={styles.modalLabel}>Pain / injury flag</Text>
            <ScaleSelector
              values={SCALE_PAIN}
              value={draft.pain}
              onChange={(v) => setDraft((p) => ({ ...p, pain: v }))}
            />

            <TextInput
              value={draft.note}
              onChangeText={(v) => setDraft((p) => ({ ...p, note: v }))}
              placeholder='Optional note'
              placeholderTextColor='#7E8E93'
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
      <Modal visible={joinOpen} animationType='slide' transparent onRequestClose={() => setJoinOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Join a Team</Text>
            <Text style={styles.modalSubtitle}>Enter a 6-digit invite code.</Text>
            <TextInput
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder="123456"
              placeholderTextColor="#7E8E93"
              style={styles.codeInput}
              keyboardType="number-pad"
              maxLength={10}
            />
            <View style={styles.rowActions}>
              <Pressable style={styles.modalGhost} onPress={() => setJoinOpen(false)} disabled={actionBusy}>
                <Text style={styles.modalGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalPrimary} onPress={() => void joinTeam()} disabled={actionBusy}>
                <Text style={styles.modalPrimaryText}>{actionBusy ? 'Joining…' : 'Join'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={createOpen} animationType='slide' transparent onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create a Team</Text>
            <Text style={styles.modalSubtitle}>Name your team. You can invite athletes later.</Text>
            <TextInput
              value={newTeamName}
              onChangeText={setNewTeamName}
              placeholder="Team name"
              placeholderTextColor="#7E8E93"
              style={styles.fieldInput}
              maxLength={60}
            />
            <TextInput
              value={newTeamDesc}
              onChangeText={setNewTeamDesc}
              placeholder="Optional description"
              placeholderTextColor="#7E8E93"
              style={[styles.fieldInput, { marginTop: 10, minHeight: 84 }]}
              multiline
              maxLength={180}
            />
            <View style={styles.rowActions}>
              <Pressable style={styles.modalGhost} onPress={() => setCreateOpen(false)} disabled={actionBusy}>
                <Text style={styles.modalGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalPrimary} onPress={() => void createTeam()} disabled={actionBusy || !newTeamName.trim()}>
                <Text style={styles.modalPrimaryText}>{actionBusy ? 'Creating…' : 'Create'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  highlightPanel: { overflow: 'hidden', borderWidth: 1, borderRadius: 16 },
  highlightPanelWash: { ...StyleSheet.absoluteFillObject, opacity: 0.9 },
  highlightPanelRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, opacity: 0.95 },
  screen: { flex: 1, backgroundColor: NEON_THEME.color.bg0 },
  content: { padding: 16, paddingBottom: 36 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12 },
  title: { color: NEON_THEME.color.textPrimary, fontSize: 28, fontWeight: '900' },
  subtitle: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 4, lineHeight: 18, maxWidth: 290 },
  headerBtn: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(14,210,244,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(14,210,244,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBtnText: { color: NEON_THEME.color.textPrimary, fontWeight: '900' },
  kpiRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  kpiCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    backgroundColor: NEON_THEME.color.surface0,
    paddingVertical: 12,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  kpiValue: { color: NEON_THEME.color.textPrimary, fontSize: 22, fontWeight: '900' },
  kpiLabel: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 4, fontSize: 12 },
  info: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginBottom: 10 },
  section: { marginTop: 12, marginBottom: 12 },
  sectionTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 16, marginBottom: 10 },
  teamSwitchRow: { gap: 8, paddingRight: 4 },
  teamSwitchChip: {
    minHeight: 38,
    maxWidth: 190,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    backgroundColor: NEON_THEME.color.surface1,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  teamSwitchChipOn: { borderColor: 'rgba(14,210,244,0.55)', backgroundColor: 'rgba(14,210,244,0.18)' },
  teamSwitchText: { color: NEON_THEME.color.textSecondary, fontWeight: '800' },
  teamSwitchTextOn: { color: NEON_THEME.color.textPrimary },
  moduleCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    backgroundColor: NEON_THEME.color.surface1,
    padding: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  moduleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 },
  moduleTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 16 },
  moduleBody: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 8, lineHeight: 18 },
  roleBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  roleBadgeCoach: { borderColor: 'rgba(255,170,0,0.35)', backgroundColor: 'rgba(255,170,0,0.16)' },
  roleBadgeAthlete: { borderColor: 'rgba(0,217,255,0.30)', backgroundColor: 'rgba(0,217,255,0.12)' },
  roleBadgeText: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 11 },
  triageRow: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 10,
  },
  triageName: { color: NEON_THEME.color.textPrimary, fontWeight: '800' },
  triageReason: { color: NEON_THEME.color.textSecondary, marginTop: 4, fontWeight: '700', fontSize: 12 },
  weekRow: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 8 },
  dayChip: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    paddingVertical: 8,
  },
  dayChipToday: { borderColor: 'rgba(0,217,255,0.35)', backgroundColor: 'rgba(0,217,255,0.18)' },
  dayChipTop: { color: NEON_THEME.color.textSecondary, fontWeight: '800', fontSize: 11 },
  dayChipTopToday: { color: NEON_THEME.color.textPrimary },
  dayChipDay: { color: NEON_THEME.color.textPrimary, fontWeight: '900', marginTop: 3 },
  dayChipDayToday: { color: NEON_THEME.color.textPrimary },
  rosterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rosterName: { color: NEON_THEME.color.textPrimary, fontWeight: '800' },
  rosterRole: { color: NEON_THEME.color.textSecondary, fontWeight: '700', fontSize: 12 },
  rowActions: { flexDirection: 'row', gap: 12, marginTop: 12, marginBottom: 0 },
  primaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: NEON_THEME.color.neonCyan,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  primaryBtnText: { color: '#01212A', fontWeight: '900' },
  secondaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  secondaryBtnText: { color: '#D9E7EC', fontWeight: '800' },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  emptyTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 18, textAlign: 'center' },
  emptyText: { color: NEON_THEME.color.textSecondary, fontWeight: '700', textAlign: 'center', marginTop: 8, lineHeight: 18 },
  errorCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,106,106,0.28)',
    backgroundColor: 'rgba(255,106,106,0.10)',
    padding: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  errorTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900' },
  errorBody: { color: NEON_THEME.color.textSecondary, marginTop: 6, fontWeight: '700' },
  retryBtn: {
    marginTop: 10,
    minHeight: 40,
    borderRadius: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    backgroundColor: '#00D9FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryBtnText: { color: '#01212A', fontWeight: '900' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  modalCard: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#101010',
    padding: 14,
    paddingBottom: 20,
  },
  modalTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 18 },
  modalSubtitle: { color: '#9DA8AD', fontWeight: '700', marginTop: 6, marginBottom: 10, lineHeight: 18 },
  modalLabel: { color: '#D9E7EC', fontWeight: '800', marginTop: 8, marginBottom: 6 },
  scaleRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  scaleChip: {
    minWidth: 42,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleChipOn: { borderColor: 'rgba(0,217,255,0.35)', backgroundColor: 'rgba(0,217,255,0.18)' },
  scaleChipText: { color: '#D9E7EC', fontWeight: '800' },
  scaleChipTextOn: { color: '#BFF3FF' },
  noteInput: {
    minHeight: 68,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: '#FFFFFF',
    padding: 10,
    marginTop: 10,
  },
  fieldInput: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    fontWeight: '800',
  },
  codeInput: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: 2,
    textAlign: 'center',
  },
  modalGhost: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalGhostText: { color: '#D9E7EC', fontWeight: '800' },
  modalPrimary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryText: { color: '#01212A', fontWeight: '900' },
});
