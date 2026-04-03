import { useFocusEffect } from '@react-navigation/native'; import { router } from 'expo-router'; import React, { useCallback, useState } from 'react'; import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { formatDuration, formatPace } from '../../utils/gpsService';
import { getSegmentChallengeBoards, type SegmentChallengeBoard } from '../../utils/segmentService';

export default function SegmentHistoryScreen() {
  const [boards, setBoards] = useState<SegmentChallengeBoard[]>([]);

  const load = useCallback(async () => {
    const rows = await getSegmentChallengeBoards();
    setBoards(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Segment History</Text>
          <View style={{ width: 40 }} />
        </View>

        {boards.length ? (
          boards.map((board) => (
            <GlassCard key={board.segmentId}>
              <Text style={styles.name}>{board.name}</Text>
              <Text style={styles.meta}>
                {board.history.attempts} attempts · {board.history.distanceMiles.toFixed(2)} mi · Trend {board.history.trendLabel}
              </Text>
              <Text style={styles.meta}>
                PR {formatDuration(Math.round(board.history.bestDurationSec))} ({formatPace(board.history.bestPaceMinPerMile)}/mi)
              </Text>
              <Text style={styles.meta}>
                Last {formatDuration(Math.round(board.history.lastDurationSec))} ({formatPace(board.history.lastPaceMinPerMile)}/mi)
              </Text>

              <View style={styles.challengeWrap}>
                {board.challenges.map((challenge) => (
                  <View key={challenge.type} style={styles.challengeRow}>
                    <Text style={styles.challengeTitle}>{challenge.title}</Text>
                    <Text style={[styles.challengeStatus, challenge.status === 'completed' ? styles.challengeDone : styles.challengeLive]}>
                      {challenge.status === 'completed' ? 'DONE' : 'LIVE'}
                    </Text>
                    <Text style={styles.challengeProgress}>{challenge.progressText}</Text>
                  </View>
                ))}
              </View>
            </GlassCard>
          ))
        ) : (
          <GlassCard>
            <Text style={styles.name}>No segment attempts yet</Text>
            <Text style={styles.meta}>Create a segment, complete matching runs, and stats will show up here.</Text>
          </GlassCard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 36, gap: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 20 },
  name: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  meta: { color: '#AAD4DF', marginTop: 4, fontWeight: '600' },
  challengeWrap: { marginTop: 10, gap: 8 },
  challengeRow: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    padding: 10,
  },
  challengeTitle: { color: '#E9F8FF', fontWeight: '800', fontSize: 13 },
  challengeStatus: { fontWeight: '800', marginTop: 4, fontSize: 11 },
  challengeDone: { color: '#00E38C' },
  challengeLive: { color: '#FFD15D' },
  challengeProgress: { color: '#AFD5E1', marginTop: 4, fontWeight: '600', fontSize: 12 },
});
