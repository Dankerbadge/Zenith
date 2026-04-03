import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Screen from '../../components/ui/Screen';
import GlassCard from '../../components/ui/GlassCard';
import StatTile from '../../components/ui/StatTile';
import ListGroup from '../../components/ui/ListGroup';
import ListRow from '../../components/ui/ListRow';
import Badge from '../../components/ui/Badge';

type AthleteRow = { name: string; status: 'on_track' | 'behind' | 'flagged' };

function statusDot(status: AthleteRow['status']) {
  if (status === 'on_track') return { color: '#22C55E', label: 'On track' };
  if (status === 'behind') return { color: '#FBBF24', label: 'Behind' };
  return { color: '#F87171', label: 'Flagged' };
}

export default function DemoTeamDashboard() {
  const roster: AthleteRow[] = useMemo(
    () => [
      { name: 'Jordan K.', status: 'on_track' },
      { name: 'Maya S.', status: 'behind' },
      { name: 'Chris P.', status: 'on_track' },
      { name: 'Renee L.', status: 'flagged' },
      { name: 'Sam D.', status: 'on_track' },
      { name: 'Taylor R.', status: 'behind' },
    ],
    []
  );

  return (
    <Screen aura>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
            <MaterialIcons name="arrow-back" size={20} color="#D9F6FF" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Demo Team</Text>
            <Text style={styles.subtitle}>Preview: Teams HQ (mock data)</Text>
          </View>
          <Badge label="Preview" tone="muted" />
        </View>

        <GlassCard style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.teamName}>Zenith Endurance</Text>
              <Text style={styles.teamMeta}>Role: Coach · 24 athletes · Week 3</Text>
            </View>
            <View style={styles.heroBadges}>
              <Badge label="Coach" tone="accent" />
              <Badge label="Private" tone="muted" />
            </View>
          </View>

          <View style={styles.heroActions}>
            <Pressable style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]} onPress={() => router.push('/messages' as any)}>
              <Text style={styles.actionText}>Message</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]} onPress={() => router.push('/(tabs)/community/index' as any)}>
              <Text style={styles.actionText}>Feed</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]} onPress={() => router.push('/teams' as any)}>
              <Text style={styles.actionText}>Directory</Text>
            </Pressable>
          </View>
        </GlassCard>

        <Text style={styles.sectionTitle}>At A Glance</Text>
        <View style={styles.tilesRow}>
          <View style={{ flex: 1 }}>
            <StatTile icon="📈" label="This week" value="76%" hint="Completion" />
          </View>
          <View style={{ flex: 1 }}>
            <StatTile icon="⏭️" label="Next up" value="Intervals" hint="Tomorrow 6:00 AM" />
          </View>
          <View style={{ flex: 1 }}>
            <StatTile icon="🚩" label="Flags" value="2" hint="Need review" />
          </View>
        </View>

        <ListGroup title="Roster Snapshot">
          {roster.map((a, idx) => {
            const s = statusDot(a.status);
            return (
              <View key={a.name}>
                <View style={styles.rosterRow}>
                  <View style={styles.rosterLeft}>
                    <View style={[styles.dot, { backgroundColor: s.color }]} />
                    <Text style={styles.rosterName} numberOfLines={1}>
                      {a.name}
                    </Text>
                  </View>
                  <Text style={styles.rosterStatus} numberOfLines={1}>
                    {s.label}
                  </Text>
                </View>
                {idx === roster.length - 1 ? null : <View style={styles.divider} />}
              </View>
            );
          })}
        </ListGroup>

        <ListGroup title="Announcements">
          <ListRow
            icon={<Text style={styles.emoji}>📌</Text>}
            title="Saturday long run"
            subtitle="Keep it easy. Fuel early. Check-in after."
            showChevron={false}
          />
          <ListRow
            icon={<Text style={styles.emoji}>🧠</Text>}
            title="Recovery priority"
            subtitle="Sleep is the lever this week."
            showChevron={false}
            isLast
          />
        </ListGroup>

        <GlassCard style={styles.ctaCard}>
          <Text style={styles.ctaTitle}>Make this real</Text>
          <Text style={styles.ctaBody}>Join a team with an invite code, or create one in seconds.</Text>
          <View style={styles.ctaRow}>
            <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]} onPress={() => router.push('/(tabs)/teams' as any)}>
              <Text style={styles.primaryText}>Back to Teams</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]} onPress={() => router.push('/teams' as any)}>
              <Text style={styles.secondaryText}>Open Directory</Text>
            </Pressable>
          </View>
        </GlassCard>

        <View style={{ height: 30 }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  title: { color: '#FFF', fontSize: 20, fontWeight: '900' },
  subtitle: { marginTop: 2, color: 'rgba(255,255,255,0.62)', fontWeight: '700' },
  pressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },

  hero: { padding: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  teamName: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  teamMeta: { marginTop: 6, color: 'rgba(255,255,255,0.62)', fontWeight: '700' },
  heroBadges: { gap: 8, alignItems: 'flex-end' },
  heroActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { color: '#D9E7EC', fontWeight: '900' },

  sectionTitle: { marginTop: 18, marginBottom: 10, color: '#C5C5C5', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  tilesRow: { flexDirection: 'row', gap: 10 },

  rosterRow: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rosterLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rosterName: { color: '#EAEAEA', fontWeight: '900', flex: 1 },
  rosterStatus: { color: 'rgba(255,255,255,0.62)', fontWeight: '800' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginLeft: 14 },
  emoji: { fontSize: 14 },

  ctaCard: { padding: 14, marginTop: 14 },
  ctaTitle: { color: '#FFF', fontWeight: '900', fontSize: 16 },
  ctaBody: { marginTop: 6, color: 'rgba(255,255,255,0.65)', fontWeight: '700', lineHeight: 18 },
  ctaRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primaryBtn: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#01212A', fontWeight: '900' },
  secondaryBtn: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#D9E7EC', fontWeight: '900' },
});

