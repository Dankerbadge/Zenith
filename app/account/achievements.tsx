import { router } from 'expo-router'; import React, { useCallback, useMemo, useState } from 'react'; import { useFocusEffect } from '@react-navigation/native'; import { FlatList, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Chip from '../../components/ui/Chip';
import GlassCard from '../../components/ui/GlassCard';
import { computeAchievementMetrics, evaluateAchievement, listAchievements } from '../../utils/achievementsEngine';
import { captureException } from '../../utils/crashReporter';

type CategoryFilter =
  | 'all'
  | 'consistency'
  | 'volume'
  | 'discipline'
  | 'nutrition'
  | 'hydration'
  | 'running'
  | 'walking'
  | 'lifting'
  | 'recovery'
  | 'community'
  | 'special';

type SortMode = 'suggested' | 'xp_desc' | 'nearly' | 'newest';

export default function AchievementsScreen() {
  const [metrics, setMetrics] = useState<any | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('suggested');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      setMetrics(await computeAchievementMetrics());
      setLoadState('loaded');
    } catch (err) {
      setMetrics(null);
      setLoadState('error');
      void captureException(err, { feature: 'achievements', op: 'load_metrics' });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const all = useMemo(() => listAchievements(), []);

  const scored = useMemo(() => {
    if (!metrics) return [];
    return all.map((achievement, index) => {
      const result = evaluateAchievement(achievement, metrics);
      return { achievement, index, ...result };
    });
  }, [all, metrics]);

  const unlockedCount = useMemo(() => scored.filter((row) => row.unlocked).length, [scored]);
  const totalXpUnlocked = useMemo(
    () => scored.filter((row) => row.unlocked).reduce((sum, row) => sum + row.achievement.xp, 0),
    [scored]
  );

  const filters: { key: CategoryFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'consistency', label: 'Consistency' },
    { key: 'volume', label: 'Volume' },
    { key: 'discipline', label: 'Discipline' },
    { key: 'nutrition', label: 'Nutrition' },
    { key: 'hydration', label: 'Hydration' },
    { key: 'running', label: 'Running' },
    { key: 'walking', label: 'Walking' },
    { key: 'lifting', label: 'Lifting' },
    { key: 'recovery', label: 'Recovery' },
    { key: 'community', label: 'Community' },
    { key: 'special', label: 'Special' },
  ];

  const sortOptions: { key: SortMode; label: string }[] = [
    { key: 'suggested', label: 'Suggested' },
    { key: 'xp_desc', label: 'XP high → low' },
    { key: 'nearly', label: 'Nearly complete' },
    { key: 'newest', label: 'Newest' },
  ];

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = scored.filter((row) => {
      const categoryOk = filter === 'all' ? true : row.achievement.category === filter;
      const queryOk = !q ? true : row.achievement.title.toLowerCase().includes(q);
      return categoryOk && queryOk;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === 'xp_desc') return (b.achievement.xp || 0) - (a.achievement.xp || 0);
      if (sortMode === 'newest') return b.index - a.index;
      if (sortMode === 'nearly') {
        const aScore = a.unlocked ? -1 : a.progressPct;
        const bScore = b.unlocked ? -1 : b.progressPct;
        return bScore - aScore;
      }

      // Suggested: not unlocked first by progress, then by tier/xp.
      if (a.unlocked !== b.unlocked) return a.unlocked ? 1 : -1;
      if (!a.unlocked && !b.unlocked && a.progressPct !== b.progressPct) return b.progressPct - a.progressPct;
      if (a.achievement.tier !== b.achievement.tier) return a.achievement.tier - b.achievement.tier;
      return (a.achievement.xp || 0) - (b.achievement.xp || 0);
    });

    return sorted;
  }, [filter, query, scored, sortMode]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
        <Text style={styles.title}>Achievements</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(row) => row.achievement.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <GlassCard>
              <Text style={styles.kicker}>Progress Snapshot</Text>
              <Text style={styles.hero}>{unlockedCount} / {all.length}</Text>
              <Text style={styles.sub}>Unlocked achievements</Text>
              <Text style={styles.meta}>XP earned from achievements: {totalXpUnlocked}</Text>
            </GlassCard>

            <View style={styles.searchWrap}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search achievements…"
                placeholderTextColor="#777"
                value={query}
                onChangeText={setQuery}
              />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {filters.map((row) => (
                <Chip key={row.key} label={row.label} active={filter === row.key} onPress={() => setFilter(row.key)} />
              ))}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {sortOptions.map((row) => (
                <Chip key={row.key} label={row.label} active={sortMode === row.key} onPress={() => setSortMode(row.key)} />
              ))}
            </ScrollView>

            {loadState === 'loading' && !metrics ? (
              <GlassCard style={{ marginTop: 12 }}>
                <Text style={styles.loading}>Loading progress…</Text>
              </GlassCard>
            ) : null}
            {loadState === 'error' && !metrics ? (
              <GlassCard style={{ marginTop: 12 }}>
                <Text style={styles.errorTitle}>Couldn’t load achievements</Text>
                <Text style={styles.errorText}>Your progress data is unavailable right now.</Text>
                <Pressable
                  style={styles.retryBtn}
                  onPress={() => {
                    void load();
                  }}
                >
                  <Text style={styles.retryBtnText}>Retry</Text>
                </Pressable>
              </GlassCard>
            ) : null}
          </>
        }
        renderItem={({ item }) => (
          <AchievementRow
            title={item.achievement.title}
            description={item.achievement.description}
            category={item.achievement.category}
            badge={item.achievement.badge}
            tier={item.achievement.tier}
            xp={item.achievement.xp}
            unlocked={item.unlocked}
            progressPct={item.progressPct}
          />
        )}
        ListEmptyComponent={
          <GlassCard style={{ marginTop: 12 }}>
            {loadState === 'error' && !metrics ? (
              <>
                <Text style={styles.emptyTitle}>Load failed</Text>
                <Text style={styles.emptyText}>Try again to fetch achievement progress.</Text>
              </>
            ) : (
              <>
                <Text style={styles.emptyTitle}>No matches</Text>
                <Text style={styles.emptyText}>Try a different search or category.</Text>
              </>
            )}
          </GlassCard>
        }
      />
    </SafeAreaView>
  );
}

function categoryIcon(category: string) {
  switch (category) {
    case 'consistency':
      return '🔥';
    case 'volume':
      return '⚡';
    case 'nutrition':
      return '🍽️';
    case 'hydration':
      return '💧';
    case 'running':
      return '🏃';
    case 'walking':
      return '🚶';
    case 'lifting':
      return '💪';
    case 'recovery':
      return '🧘';
    case 'community':
      return '👥';
    case 'special':
      return '✨';
    default:
      return '🏅';
  }
}

function badgeColor(badge: string) {
  switch (badge) {
    case 'bronze':
      return '#CD7F32';
    case 'silver':
      return '#C0C0C0';
    case 'gold':
      return '#FFD700';
    case 'platinum':
      return '#E5E4E2';
    case 'diamond':
      return '#B9F2FF';
    case 'zenith':
      return '#00D9FF';
    default:
      return '#888';
  }
}

function AchievementRow(props: {
  title: string;
  description: string;
  category: string;
  badge: string;
  tier: number;
  xp: number;
  unlocked: boolean;
  progressPct: number;
}) {
  const color = badgeColor(props.badge);
  return (
    <GlassCard style={[styles.row, props.unlocked ? styles.rowUnlocked : null]}>
      <View style={styles.rowTop}>
        <View style={styles.left}>
          <Text style={styles.icon}>{categoryIcon(props.category)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{props.title}</Text>
            <Text style={styles.desc}>{props.description}</Text>
          </View>
        </View>
        <View style={[styles.tierTag, { borderColor: color }]}>
          <Text style={[styles.tierText, { color }]}>
            T{props.tier} · {props.badge.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, props.progressPct))}%` }]} />
      </View>

      <View style={styles.rowBottom}>
        <Text style={styles.progressText}>{props.unlocked ? 'Unlocked' : `${props.progressPct}% complete`}</Text>
        <Text style={styles.xpText}>{props.xp} XP</Text>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 44, gap: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 20 },

  kicker: { color: '#9EC1CF', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  hero: { color: '#FFFFFF', fontSize: 32, fontWeight: '900', marginTop: 4 },
  sub: { color: '#AFC4CB', fontSize: 13, fontWeight: '600' },
  meta: { color: '#87A9B6', marginTop: 8, fontSize: 12, fontWeight: '600' },
  loading: { color: '#AFC4CB', fontWeight: '700' },
  errorTitle: { color: '#FFD7D7', fontWeight: '900', fontSize: 14 },
  errorText: { color: '#FFB7B7', fontWeight: '700', marginTop: 6 },
  retryBtn: {
    marginTop: 10,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,89,89,0.35)',
    backgroundColor: 'rgba(255,89,89,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: { color: '#FFD7D7', fontWeight: '900' },
  searchWrap: { marginTop: 12 },
  searchInput: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontWeight: '700',
  },
  chipRow: { gap: 10, paddingVertical: 12 },
  row: { borderColor: 'rgba(255,255,255,0.08)' },
  rowUnlocked: { borderColor: 'rgba(0,255,136,0.35)' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  icon: { fontSize: 20 },
  name: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  desc: { color: '#9CB0B8', fontWeight: '600', fontSize: 12, marginTop: 2 },
  tierTag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  tierText: { fontWeight: '800', fontSize: 10, letterSpacing: 0.6 },
  progressTrack: {
    marginTop: 10,
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  progressFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#00D9FF',
  },
  rowBottom: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressText: { color: '#B6CCD4', fontSize: 11, fontWeight: '700' },
  xpText: { color: '#8EDFFF', fontSize: 11, fontWeight: '800' },
  emptyTitle: { color: '#FFF', fontWeight: '900', fontSize: 14 },
  emptyText: { color: '#B6C4CA', fontWeight: '600', marginTop: 6 },
  blockedWrap: { flex: 1, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 10 },
  blockedTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  blockedText: { color: '#B6C4CA', fontWeight: '600', textAlign: 'center' },
  blockedBtn: {
    marginTop: 6,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2D4B55',
    backgroundColor: '#132229',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockedBtnText: { color: '#D8F4FF', fontWeight: '800' },
});
