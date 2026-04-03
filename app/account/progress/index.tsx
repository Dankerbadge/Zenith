import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import GlassCard from '../../../components/ui/GlassCard';
import ListGroup from '../../../components/ui/ListGroup';
import ListRow from '../../../components/ui/ListRow';
import PremiumGate from '../../../components/PremiumGate';
import Screen from '../../../components/ui/Screen';
import { NEON_THEME } from '../../../constants/neonTheme';

export default function ProgressHubScreen() {
  const open = useCallback((path: string) => router.push(path as any), []);

  return (
    <Screen edges={['top']} aura>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Progress</Text>
          <Text style={styles.subtitle}>Decisions, not dashboards. Grounded in your data.</Text>
        </View>

        <ListGroup title="Readiness & Load">
          <ListRow title="Readiness" subtitle="Score, recommendation, reasons" onPress={() => open('/account/progress/readiness')} />
          <ListRow title="Training Load" subtitle="Fitness · fatigue · form" onPress={() => open('/account/progress/training-load')} isLast />
        </ListGroup>

        <ListGroup title="Fueling">
          <ListRow title="Nutrition Insights" subtitle="Macros by meal · weekly digest" onPress={() => open('/account/progress/nutrition')} />
          <ListRow title="Export" subtitle="Nutrition CSV" onPress={() => open('/account/progress/export')} isLast />
        </ListGroup>

        <PremiumGate feature="aiInsights">
          <ListGroup title="Insights">
            <ListRow title="Insight Cards" subtitle="Rules-first, confidence-tiered" onPress={() => open('/account/progress/insights')} isLast />
          </ListGroup>
        </PremiumGate>

        <ListGroup title="Routes & Segments">
          <PremiumGate feature="routes">
            <ListRow title="Routes" subtitle="Saved routes + suggestions" onPress={() => open('/account/progress/routes')} />
          </PremiumGate>
          <PremiumGate feature="segments">
            <ListRow title="Segments" subtitle="Personal segments + PRs" onPress={() => open('/segments' as any)} isLast />
          </PremiumGate>
        </ListGroup>

        <ListGroup title="Body Map">
          <ListRow title="3D Body Map" subtitle="Muscle overlay + regional drill-in" onPress={() => open('/account/progress/body-map')} isLast />
        </ListGroup>

        <GlassCard style={styles.note}>
          <Text style={styles.noteTitle}>Accuracy Contract</Text>
          <Text style={styles.noteBody}>
            If inputs are missing or low-quality, Zenith will either show a lower confidence tier or skip the metric entirely.
          </Text>
        </GlassCard>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  header: { gap: 6 },
  title: { color: NEON_THEME.color.textPrimary, fontSize: 30, fontWeight: '900' },
  subtitle: { color: NEON_THEME.color.textSecondary, fontWeight: '700', lineHeight: 18 },
  note: { padding: 14 },
  noteTitle: { color: NEON_THEME.color.textPrimary, fontWeight: '900', fontSize: 14 },
  noteBody: { color: NEON_THEME.color.textSecondary, fontWeight: '700', marginTop: 6, lineHeight: 18 },
});
