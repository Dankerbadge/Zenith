import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View, Platform } from 'react-native';

import NumberPadTextInput from '../../components/inputs/NumberPadTextInput';
import Screen from '../../components/ui/Screen';
import Chip from '../../components/ui/Chip';
import GlassCard from '../../components/ui/GlassCard';
import HeroCard from '../../components/ui/HeroCard';
import ProgressRow from '../../components/ui/ProgressRow';
import SectionHeader from '../../components/ui/SectionHeader';
import StatTile from '../../components/ui/StatTile';
import { STATS_HIGHLIGHT_GLOSS, statsHighlightBorder, statsHighlightRail, statsHighlightWash } from '../../components/ui/statsHighlight';
import { NEON_THEME } from '../../constants/neonTheme';
import DailyBriefingCard from '../../components/DailyBriefingCard';
import ListGroup from '../../components/ui/ListGroup';
import ListRow from '../../components/ui/ListRow';
import FlameMark from '../../components/icons/FlameMark';
import { calculateCurrentRank, getNextRank, RANKS } from '../../constants/ranks';
import { APP_CONFIG } from '../../utils/appConfig';
import { subscribeDailyLogChanged } from '../../utils/dailyLogEvents';
import { getWinningSnapshot } from '../../utils/winningSystem';
import { formatHandle } from '../../utils/username';
import { getDailyLog, getUserProfile, setStorageItem, todayKey, USER_PROFILE_KEY, type DailyLog } from '../../utils/storageUtils';
import { getWatchWorkoutCarouselOrder } from '../../utils/watchWorkoutCarouselOrder';
import { WATCH_WORKOUT_PLANS } from '../../utils/watchWorkoutPlanCatalog';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

type Goals = {
  proteinTarget: number;
  waterTargetOz: number;
  activeRestTargetMin: number;
  caloriesTarget?: number;
};

type GoalKey = keyof Goals;

const DEFAULT_GOALS: Goals = {
  proteinTarget: 170,
  waterTargetOz: 120,
  activeRestTargetMin: 20,
  caloriesTarget: undefined,
};

const GOAL_META: Record<GoalKey, { title: string; unit: string; optional?: boolean; pick: (log: DailyLog) => number }> = {
  proteinTarget: { title: 'Protein', unit: 'g', pick: (log) => Number(log?.macros?.protein) || 0 },
  waterTargetOz: { title: 'Water', unit: 'oz', pick: (log) => Number(log?.water) || 0 },
  activeRestTargetMin: {
    title: 'Active Rest',
    unit: 'min',
    pick: (log) => (Array.isArray(log?.activeRest) ? log.activeRest.reduce((sum, r) => sum + (Number(r?.minutes) || 0), 0) : 0),
  },
  caloriesTarget: { title: 'Calories', unit: 'kcal', optional: true, pick: (log) => Number(log?.calories) || 0 },
};

type ProgressSnapshot = {
  totalXP: number;
  rankId: string;
  rankTier: string;
  rankName: string;
  rankColor: string;
  rankIcon: string;
  nextRankName?: string | null;
  nextRankXpRemaining?: number | null;
  currentStreak: number;
  bestStreak: number;
  totalWinningDays: number;
  xpToday: number;
};

function asNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function formatInt(n: number | undefined | null) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString();
}

function parseUserProgress(raw: string | null) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    const totalXP = Number(parsed?.totalXP) || 0;
    const totalWinningDays = Number(parsed?.totalWinningDays) || 0;
    return { totalXP, totalWinningDays };
  } catch {
    return { totalXP: 0, totalWinningDays: 0 };
  }
}

function GoalEditorModal(props: {
  visible: boolean;
  title: string;
  unit: string;
  optional?: boolean;
  initialValue?: number;
  onClose: () => void;
  onSave: (value: number | undefined) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.visible) return;
    if (props.initialValue == null) setText('');
    else setText(String(Math.round(props.initialValue)));
    setError(null);
  }, [props.visible, props.initialValue]);

  const save = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      if (props.optional) {
        props.onSave(undefined);
        props.onClose();
        return;
      }
      setError('Enter a value.');
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter a positive number.');
      return;
    }
    setError(null);
    props.onSave(n);
    props.onClose();
  };

  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{props.title}</Text>
          <Text style={styles.modalSub}>
            {props.optional ? `Set a target (${props.unit}) or leave blank.` : `Set your target in ${props.unit}.`}
          </Text>
          <NumberPadTextInput
            style={styles.modalInput}
            keyboardType="number-pad"
            value={text}
            onChangeText={(v) => {
              setText(v);
              if (error) setError(null);
            }}
            placeholder={props.optional ? 'Optional' : 'e.g. 170'}
            placeholderTextColor="#777"
          />
          {error ? <Text style={styles.modalError}>{error}</Text> : null}
          <View style={styles.modalActions}>
            <Pressable style={styles.modalGhost} onPress={props.onClose}>
              <Text style={styles.modalGhostText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.modalPrimary} onPress={save}>
              <Text style={styles.modalPrimaryText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function QuickAction(props: { icon: React.ReactNode; label: string; onPress: () => void; colors?: readonly [string, string] }) {
  const colors = props.colors;
  const c1 = colors?.[0] || '#2A2A2A';

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => [styles.quickAction, { borderColor: statsHighlightBorder(c1) }, pressed && styles.pressed]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={statsHighlightWash(c1)}
        start={{ x: 0.1, y: 0.0 }}
        end={{ x: 0.9, y: 1.0 }}
        style={styles.quickActionBg}
      />
      <LinearGradient
        pointerEvents="none"
        colors={STATS_HIGHLIGHT_GLOSS}
        start={{ x: 0.5, y: 0.0 }}
        end={{ x: 0.5, y: 1.0 }}
        style={styles.quickActionGloss}
      />
      <LinearGradient
        pointerEvents="none"
        colors={statsHighlightRail(c1)}
        start={{ x: 0.5, y: 0.0 }}
        end={{ x: 0.5, y: 1.0 }}
        style={styles.quickActionRail}
      />
      <View style={styles.quickIcon}>{props.icon}</View>
      <Text style={styles.quickLabel} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

export default function ProfileHome() {
  const { profile: cloudProfile, profileReady } = useAuth();

  const achievementsEnabled = APP_CONFIG.FEATURES.ACHIEVEMENTS_ENABLED;
  const garminEnabled = APP_CONFIG.FEATURES.GARMIN_CONNECT_ENABLED;
  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;

  const [name, setName] = useState('Athlete');
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('@unknown');
  const [tags, setTags] = useState<string[]>(['lifting']);
  const [level, setLevel] = useState<'amateur' | 'pro'>('amateur');

  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [todayLog, setTodayLog] = useState<DailyLog>({});
  const [progress, setProgress] = useState<ProgressSnapshot>({
    totalXP: 0,
    rankId: 'iron_4',
    rankTier: 'Iron',
    rankName: 'Iron IV',
    rankColor: '#8B7355',
    rankIcon: '⚙️',
    nextRankName: null,
    nextRankXpRemaining: null,
    currentStreak: 0,
    bestStreak: 0,
    totalWinningDays: 0,
    xpToday: 0,
  });

  const [goalEditorKey, setGoalEditorKey] = useState<GoalKey | null>(null);
  const isMountedRef = useRef(true);

  const [watchCarouselPreview, setWatchCarouselPreview] = useState<string>('Tap to customize.');
  const [socialCounts, setSocialCounts] = useState<{ followers: number; following: number; posts: number }>({ followers: 0, following: 0, posts: 0 });
  const isIos = Platform.OS === 'ios';

  const planLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of WATCH_WORKOUT_PLANS) {
      map.set(p.planId, p.subtitle ? `${p.label} · ${p.subtitle}` : p.label);
    }
    return map;
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadAll = useCallback(async () => {
    const [profile, winning, today, rawProgress] = await Promise.all([
      getUserProfile(),
      getWinningSnapshot(),
      getDailyLog(todayKey()),
      AsyncStorage.getItem('userProgress'),
    ]);

    const profileGoals = (profile.goals || {}) as any;
    const { totalXP } = parseUserProgress(rawProgress);
    const rank = calculateCurrentRank(totalXP, winning.totalWinningDays);
    const next = getNextRank(rank.id);
    const xpRemaining = next ? Math.max(0, next.pointsRequired - totalXP) : null;

    if (!isMountedRef.current) return;

    setName((profile.firstName as string) || 'Athlete');
    setEmail((profile.email as string) || '');
    // Cloud handle is the single source of truth.
    setHandle((prev) => {
      const cloud = formatHandle(cloudProfile?.username);
      return cloud !== '@unknown' ? cloud : prev;
    });
    setTags(Array.isArray(profile.sportTags) && profile.sportTags.length ? (profile.sportTags as string[]) : ['lifting']);
    setLevel(profile.level === 'pro' ? 'pro' : 'amateur');

    setGoals({
      proteinTarget: asNumber(profileGoals.proteinTarget) || 170,
      waterTargetOz: asNumber(profileGoals.waterTargetOz) || 120,
      activeRestTargetMin: asNumber(profileGoals.activeRestTargetMin) || 20,
      caloriesTarget: asNumber(profileGoals.caloriesTarget),
    });

    setTodayLog(today || {});

    setProgress({
      totalXP,
      rankId: rank.id,
      rankTier: rank.tier,
      rankName: rank.name,
      rankColor: rank.color,
      rankIcon: rank.icon,
      nextRankName: next?.name || null,
      nextRankXpRemaining: xpRemaining,
      currentStreak: winning.currentStreak,
      bestStreak: winning.bestStreak,
      totalWinningDays: winning.totalWinningDays,
      xpToday: Number((today as any)?.dailyXP) || 0,
    });

    if (socialEnabled && isSupabaseConfigured && cloudProfile?.id) {
      try {
        const [followers, following, posts] = await Promise.all([
          socialApi.getFollowers(cloudProfile.id),
          socialApi.getFollowing(cloudProfile.id),
          socialApi.getUserPosts(cloudProfile.id),
        ]);
        if (!isMountedRef.current) return;
        setSocialCounts({
          followers: Array.isArray(followers) ? followers.length : 0,
          following: Array.isArray(following) ? following.length : 0,
          posts: Array.isArray(posts) ? posts.length : 0,
        });
      } catch {
        if (!isMountedRef.current) return;
        setSocialCounts({ followers: 0, following: 0, posts: 0 });
      }
    } else {
      setSocialCounts({ followers: 0, following: 0, posts: 0 });
    }
  }, [cloudProfile?.id, cloudProfile?.username, socialEnabled]);

  useEffect(() => {
    if (!isIos) return;
    let alive = true;
    void (async () => {
      try {
        const order = await getWatchWorkoutCarouselOrder();
        if (!alive) return;
        const labels = order.map((id) => planLabelById.get(id) || id).slice(0, 4);
        const suffix = order.length > 4 ? ` +${order.length - 4} more` : '';
        setWatchCarouselPreview(order.length > 0 ? `Current: ${labels.join(', ')}${suffix}` : 'Tap to customize.');
      } catch {
        if (alive) setWatchCarouselPreview('Tap to customize.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [isIos, planLabelById]);

  useEffect(() => {
    if (!profileReady) return;
    const cloud = formatHandle(cloudProfile?.username);
    if (cloud !== '@unknown') setHandle(cloud);
  }, [cloudProfile?.username, profileReady]);

  useEffect(() => {
    const unsubscribe = subscribeDailyLogChanged(() => void loadAll());
    return unsubscribe;
  }, [loadAll]);

  useFocusEffect(
    useCallback(() => {
      void loadAll();
    }, [loadAll])
  );

  const saveProfile = useCallback(
    async (patch: Partial<{ tags: string[]; level: 'amateur' | 'pro'; goals: Goals }>) => {
      const profile = await getUserProfile();
      const nextProfile = {
        ...profile,
        sportTags: patch.tags ?? tags,
        level: patch.level ?? level,
        goals: patch.goals ?? goals,
      };
      await setStorageItem(USER_PROFILE_KEY, nextProfile);
      void loadAll();
    },
    [goals, level, loadAll, tags]
  );

  const toggleTag = (tag: string) => {
    setTags((prev) => {
      const active = prev.includes(tag);
      const next = active ? prev.filter((t) => t !== tag) : [...prev, tag];
      void saveProfile({ tags: next });
      return next;
    });
  };

  const xpLine = useMemo(() => {
    const next = progress.nextRankName ? `Next: ${progress.nextRankName} in ${formatInt(progress.nextRankXpRemaining)} XP` : 'Max rank reached';
    return `XP ${formatInt(progress.totalXP)} · ${next}`;
  }, [progress.nextRankName, progress.nextRankXpRemaining, progress.totalXP]);

  const xpProgress = useMemo(() => {
    const current = RANKS.find((r) => r.id === progress.rankId);
    const next = progress.nextRankName ? getNextRank(progress.rankId) : null;
    if (!current || !next) return 1;
    const denom = Math.max(1, next.pointsRequired - current.pointsRequired);
    const pct = (progress.totalXP - current.pointsRequired) / denom;
    return Math.max(0, Math.min(1, pct));
  }, [progress.rankId, progress.nextRankName, progress.totalXP]);

  const goalRows = useMemo(() => {
    return (Object.keys(GOAL_META) as GoalKey[]).map((key) => {
      const meta = GOAL_META[key];
      const current = meta.pick(todayLog);
      const target = goals[key];
      const hasTarget = target != null && Number.isFinite(Number(target)) && Number(target) > 0;
      const progress01 = hasTarget ? Math.max(0, Math.min(1, current / Number(target))) : 0;
      const value = hasTarget ? `${formatInt(current)} / ${formatInt(Number(target))} ${meta.unit}` : meta.optional ? 'Optional' : '—';
      return { key, meta, current, target, progress01, value };
    });
  }, [goals, todayLog]);

  const badges = useMemo(() => {
    const out: { label: string; tone?: any }[] = [];
    out.push({ label: `${progress.rankTier} Athlete`, tone: 'muted' });
    if (level === 'pro') out.push({ label: 'Pro', tone: 'success' });
    if (level === 'pro') out.push({ label: 'Verified', tone: 'accent' });
    return out;
  }, [level, progress.rankTier]);

  const activeGoalKey = goalEditorKey;
  const goalEditorMeta = activeGoalKey ? GOAL_META[activeGoalKey] : null;

  return (
    <Screen aura contentStyle={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
          <Pressable onPress={() => router.push('/account/settings' as any)} style={({ pressed }) => [styles.gearBtn, pressed && styles.pressed]}>
            <MaterialIcons name="settings" size={22} color="#D9F6FF" />
          </Pressable>
        </View>

        <HeroCard
          name={name}
          handle={handle}
          email={email || undefined}
          avatarLabel={String(name || 'A').charAt(0).toUpperCase()}
          badges={badges}
          xpLine={xpLine}
          xpProgress={xpProgress}
          xpColor={progress.rankColor}
          onPressXp={() => router.push('/account/ranks-xp' as any)}
        >
          <Text style={styles.kicker}>Training focus</Text>
          <View style={styles.chipsRow}>
            {['lifting', 'running', 'calisthenics', 'mixed'].map((tag) => (
              <Chip key={tag} label={tag} active={tags.includes(tag)} onPress={() => toggleTag(tag)} />
            ))}
          </View>
        </HeroCard>

        <View style={styles.quickRow}>
          <QuickAction
            icon={<Text style={styles.quickEmoji}>✏️</Text>}
            label="Edit"
            onPress={() => router.push('/account/manage-profile' as any)}
            colors={['#7EDCFF', '#00D9FF']}
          />
          <QuickAction
            icon={<Text style={styles.quickEmoji}>🏅</Text>}
            label="Ranks"
            onPress={() => router.push('/account/ranks-xp' as any)}
            colors={['#A855F7', '#4E5BFF']}
          />
          <QuickAction
            icon={<Text style={styles.quickEmoji}>⌚</Text>}
            label="Devices"
            onPress={() => router.push('/wearables' as any)}
            colors={['#60A5FA', '#2563EB']}
          />
          <QuickAction
            icon={<Text style={styles.quickEmoji}>{socialEnabled ? '🏁' : '🛟'}</Text>}
            label={socialEnabled ? 'Challenges' : 'Safety'}
            onPress={() => router.push((socialEnabled ? '/challenges' : '/account/safety') as any)}
            colors={socialEnabled ? (['#34D399', '#00FF88'] as const) : (['#FFAA00', '#FF4F6A'] as const)}
          />
        </View>

        {socialEnabled && cloudProfile?.id ? (
          <GlassCard style={styles.socialCountsCard} highlightColor="#00D9FF">
            <View style={styles.socialCountsRow}>
              <Pressable style={styles.socialCountBtn} onPress={() => router.push(`/profile/${cloudProfile.id}/followers` as any)}>
                <Text style={styles.socialCountValue}>{socialCounts.followers}</Text>
                <Text style={styles.socialCountLabel}>Followers</Text>
              </Pressable>
              <Pressable style={styles.socialCountBtn} onPress={() => router.push(`/profile/${cloudProfile.id}/following` as any)}>
                <Text style={styles.socialCountValue}>{socialCounts.following}</Text>
                <Text style={styles.socialCountLabel}>Following</Text>
              </Pressable>
              <Pressable style={styles.socialCountBtn} onPress={() => router.push(`/profile/${cloudProfile.id}/posts` as any)}>
                <Text style={styles.socialCountValue}>{socialCounts.posts}</Text>
                <Text style={styles.socialCountLabel}>Posts</Text>
              </Pressable>
            </View>
          </GlassCard>
        ) : null}

        <Text style={styles.sectionTitle}>Performance</Text>
        <View style={styles.tilesRow}>
          <View style={{ flex: 1 }}>
            <StatTile
              icon={<FlameMark size={14} color={progress.currentStreak > 0 ? '#FF9F0A' : 'rgba(255,255,255,0.45)'} />}
              label="Streak"
              value={formatInt(progress.currentStreak)}
              hint={`Best ${formatInt(progress.bestStreak)}`}
              accent="#FF9F0A"
              onPress={() => router.push('/account/streak-history' as any)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <StatTile
              icon={progress.rankIcon}
              label="Rank"
              value={progress.rankTier}
              hint={formatInt(progress.totalWinningDays) + ' wins'}
              accent={progress.rankColor}
              onPress={() => router.push('/account/ranks-xp' as any)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <StatTile
              icon="⭐"
              label="XP today"
              value={`+${formatInt(progress.xpToday)}`}
              hint="Tap for stats"
              accent="#7C5CFF"
              onPress={() => router.push('/account/progress' as any)}
            />
          </View>
        </View>

        <SectionHeader title="DAILY BRIEFING" />
        <View style={styles.briefingBlock}>
          <DailyBriefingCard onOpenDetails={() => router.push('/account/progress/readiness' as any)} />
        </View>

        <StatTile
          icon="📊"
          label="Stats"
          value="Progress Hub"
          hint="Readiness, load, nutrition, insights"
          accent="#00D9FF"
          onPress={() => router.push('/account/progress' as any)}
          style={styles.statsTile}
        />

        {isIos ? (
          <GlassCard style={styles.statsLinkCard} onPress={() => router.push('/wearables/watch-carousel' as any)} highlightColor="#4E5BFF">
            <View style={styles.statsLinkRow}>
              <View style={styles.statsLinkIcon}>
                <MaterialIcons name="watch" size={20} color="#D8F4FF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.statsLinkTitle}>Watch carousel</Text>
                <Text style={styles.statsLinkSub} numberOfLines={2}>
                  {watchCarouselPreview}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="rgba(255,255,255,0.35)" />
            </View>
          </GlassCard>
        ) : null}

        <Text style={styles.sectionTitle}>Goals</Text>
        <GlassCard style={{ paddingVertical: 6 }}>
          {goalRows.map((row, idx) => (
            <View key={row.key} style={[styles.goalRow, idx === goalRows.length - 1 && { borderBottomWidth: 0 }]}>
              <ProgressRow title={row.meta.title} value={row.value} progress={row.progress01} color="#00D9FF" onPress={() => setGoalEditorKey(row.key)} />
            </View>
          ))}
        </GlassCard>

        <ListGroup title="History & Achievements">
          {achievementsEnabled ? (
            <ListRow icon={<Text style={styles.rowEmoji}>🏆</Text>} title="Achievements" onPress={() => router.push('/account/achievements' as any)} />
          ) : null}
          <ListRow icon={<Text style={styles.rowEmoji}>🏅</Text>} title="Ranks & XP" value={progress.rankTier} onPress={() => router.push('/account/ranks-xp' as any)} />
          <ListRow icon={<Text style={styles.rowEmoji}>🏃</Text>} title="Run history" onPress={() => router.push('/account/run-history' as any)} />
          <ListRow icon={<FlameMark size={14} color="#FF9F0A" />} title="Streak history" onPress={() => router.push('/account/streak-history' as any)} isLast />
        </ListGroup>

        {socialEnabled ? (
          <>
            <SectionHeader title='CHALLENGES' />
            <ListGroup>
              <ListRow
                icon={<Text style={styles.rowEmoji}>🏁</Text>}
                title="Challenge inbox"
                subtitle="Join, accept, and track"
                onPress={() => router.push('/challenges' as any)}
                isLast
              />
            </ListGroup>
          </>
        ) : null}

        <ListGroup title="Devices & Integrations">
          <ListRow
            icon={<Text style={styles.rowEmoji}>⌚</Text>}
            title="Wearables hub"
            subtitle={garminEnabled ? 'Apple Health, Garmin, permissions' : 'Apple Health, permissions'}
            onPress={() => router.push('/wearables' as any)}
            isLast
          />
        </ListGroup>

        <View style={{ height: 24 }} />
        <Text style={styles.footHint}>
          Settings, privacy, exports, restore, and data controls are in Settings (tap the gear).
        </Text>
        <View style={{ height: 32 }} />
      </ScrollView>

      <GoalEditorModal
        visible={goalEditorKey != null}
        title={goalEditorMeta?.title || 'Goal'}
        unit={goalEditorMeta?.unit || ''}
        optional={goalEditorMeta?.optional}
        initialValue={goalEditorKey ? (goals[goalEditorKey] as any) : undefined}
        onClose={() => setGoalEditorKey(null)}
        onSave={(value) => {
          if (!goalEditorKey) return;
          const next = { ...goals, [goalEditorKey]: value } as Goals;
          setGoals(next);
          void saveProfile({ goals: next });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  headerTitle: { color: NEON_THEME.color.textPrimary, fontSize: 28, fontWeight: '900', letterSpacing: 0.2 },
  gearBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NEON_THEME.color.surface1,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
  },

  kicker: { color: NEON_THEME.color.textSecondary, fontWeight: '800', marginTop: 4, marginBottom: 8, fontSize: 11, letterSpacing: 1 },
  chipsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },

  quickRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  quickAction: {
    flex: 1,
    minHeight: 72,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: NEON_THEME.color.strokeSubtle,
    backgroundColor: NEON_THEME.color.surface0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    overflow: 'hidden',
  },
  quickActionBg: { ...StyleSheet.absoluteFillObject },
  quickActionGloss: { ...StyleSheet.absoluteFillObject, opacity: 0.55 },
  quickActionRail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, opacity: 0.95 },
  quickIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  quickEmoji: { fontSize: 16 },
  quickLabel: { color: NEON_THEME.color.textPrimary, fontWeight: '900', marginTop: 8, fontSize: 12 },
  socialCountsCard: { marginTop: 12 },
  socialCountsRow: { flexDirection: 'row', gap: 10 },
  socialCountBtn: {
    flex: 1,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialCountValue: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 18 },
  socialCountLabel: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 4, fontSize: 12 },

  sectionTitle: { marginTop: 24, marginBottom: 12, color: NEON_THEME.color.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  tilesRow: { flexDirection: 'row', gap: 12 },
  briefingBlock: { marginTop: 6, marginBottom: 10 },
  statsTile: { marginTop: 12, minHeight: 92 },

  statsLinkCard: { marginTop: 12, borderColor: 'rgba(34,211,238,0.20)', overflow: 'hidden' },
  statsLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statsLinkIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  statsLinkTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 14 },
  statsLinkSub: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 8, fontSize: 12 },

  goalRow: { paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },

  rowEmoji: { fontSize: 14 },

  footHint: { color: NEON_THEME.color.textTertiary, fontWeight: '700', fontSize: 12, lineHeight: 16 },

  pressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.66)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#121212',
    padding: 16,
  },
  modalTitle: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  modalSub: { color: 'rgba(255,255,255,0.70)', fontWeight: '700', marginTop: 8, lineHeight: 18 },
  modalInput: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#0F0F0F',
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#FFF',
    fontWeight: '900',
    fontSize: 18,
  },
  modalError: { color: '#FCA5A5', marginTop: 12, fontWeight: '800' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  modalGhost: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalGhostText: { color: '#EAEAEA', fontWeight: '900' },
  modalPrimary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  modalPrimaryText: { color: '#041A22', fontWeight: '900' },
});
