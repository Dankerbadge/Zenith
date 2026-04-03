import { router } from 'expo-router'; import React, { useCallback, useEffect, useRef, useState } from 'react'; import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Chip from '../../components/ui/Chip';
import GlassCard from '../../components/ui/GlassCard';
import { getUserProfile, setStorageItem, USER_PROFILE_KEY } from '../../utils/storageUtils';

const AI_INSIGHTS_OPTIONS = ['Off', 'On'] as const;
const INSIGHT_FREQUENCY_OPTIONS = ['Minimal', 'Standard'] as const;
const INSIGHT_CATEGORY_OPTIONS = ['consistency', 'running', 'nutrition', 'lifting', 'recovery'] as const;

type Prefs = {
  aiOverlayEnabled: boolean;
  aiInsightFrequency: 'minimal' | 'standard';
  aiNeverDuringActivity: boolean;
  aiInsightCategories: Record<string, boolean>;
};

const DEFAULT_PREFS: Prefs = {
  aiOverlayEnabled: false,
  aiInsightFrequency: 'minimal',
  aiNeverDuringActivity: true,
  aiInsightCategories: {
    consistency: true,
    running: true,
    nutrition: true,
    lifting: true,
    recovery: true,
  },
};

export default function CoachingScreen() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [saved, setSaved] = useState<string | null>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const toastSaved = (label = 'Saved ✓') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaved(label);
    timerRef.current = setTimeout(() => setSaved(null), 1500);
  };

  const load = useCallback(async () => {
    const profile = await getUserProfile();
    const raw = (profile.preferences || {}) as any;
    const categories = { ...DEFAULT_PREFS.aiInsightCategories, ...(raw.aiInsightCategories || {}) };
    setPrefs({
      aiOverlayEnabled: Boolean(raw.aiOverlayEnabled),
      aiInsightFrequency: raw.aiInsightFrequency === 'standard' ? 'standard' : 'minimal',
      aiNeverDuringActivity: raw.aiNeverDuringActivity !== false,
      aiInsightCategories: categories,
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (next: Prefs) => {
      try {
        const profile = await getUserProfile();
        await setStorageItem(USER_PROFILE_KEY, {
          ...profile,
          preferences: {
            ...(profile.preferences || {}),
            aiOverlayEnabled: next.aiOverlayEnabled,
            aiInsightFrequency: next.aiInsightFrequency,
            aiNeverDuringActivity: next.aiNeverDuringActivity,
            aiInsightCategories: next.aiInsightCategories,
          },
        });
        toastSaved();
      } catch {
        Alert.alert('Save failed', 'Unable to save coaching settings right now.');
      }
    },
    []
  );

  const setAiInsights = (enabled: boolean) => {
    const next = { ...prefs, aiOverlayEnabled: enabled };
    setPrefs(next);
    void save(next);
  };

  const setFrequency = (freq: 'minimal' | 'standard') => {
    const next = { ...prefs, aiInsightFrequency: freq };
    setPrefs(next);
    void save(next);
  };

  const toggleCategory = (key: string) => {
    const next = {
      ...prefs,
      aiInsightCategories: { ...prefs.aiInsightCategories, [key]: !prefs.aiInsightCategories[key] },
    };
    setPrefs(next);
    void save(next);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Coaching</Text>
          <View style={{ width: 40 }} />
        </View>

        <GlassCard>
          <Text style={styles.label}>AI Insights</Text>
          <View style={styles.row}>
            {AI_INSIGHTS_OPTIONS.map((label) => (
              <Chip
                key={label}
                label={label}
                active={prefs.aiOverlayEnabled ? label === 'On' : label === 'Off'}
                onPress={() => setAiInsights(label === 'On')}
              />
            ))}
          </View>
          <Text style={styles.helperText}>Data-driven summaries and suggestions from your logs.</Text>

          {prefs.aiOverlayEnabled ? (
            <>
              <Text style={styles.label}>Insight frequency</Text>
              <View style={styles.row}>
                {INSIGHT_FREQUENCY_OPTIONS.map((label) => (
                  <Chip
                    key={label}
                    label={label}
                    active={prefs.aiInsightFrequency === (label === 'Standard' ? 'standard' : 'minimal')}
                    onPress={() => setFrequency(label === 'Standard' ? 'standard' : 'minimal')}
                  />
                ))}
              </View>

              <Text style={styles.label}>Insight categories</Text>
              <View style={styles.row}>
                {INSIGHT_CATEGORY_OPTIONS.map((key) => (
                  <Chip key={key} label={key} active={Boolean(prefs.aiInsightCategories[key])} onPress={() => toggleCategory(key)} />
                ))}
              </View>

              <Text style={styles.label}>Never during activity</Text>
              <View style={styles.row}>
                <Chip
                  label="On (required)"
                  active={prefs.aiNeverDuringActivity}
                  onPress={() => router.push('/account/coaching-policy' as any)}
                />
              </View>
              <Text style={styles.helperText}>Tap to view coaching policy details and why this is currently required.</Text>
            </>
          ) : null}

          {saved ? <Text style={styles.saved}>{saved}</Text> : null}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  back: { color: '#7EDCFF', fontWeight: '800' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  label: { color: '#E2E2E2', fontWeight: '800', marginTop: 10, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  helperText: { color: '#9BB9C2', fontWeight: '700', marginTop: 6, fontSize: 12 },
  saved: { color: '#97E9C8', fontWeight: '900', marginTop: 12, fontSize: 12 },
});
