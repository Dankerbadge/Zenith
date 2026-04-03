import { useLocalSearchParams, router } from 'expo-router'; import React, { useEffect, useState } from 'react'; import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { foodEntryPortionLabel, groupFoodEntriesByMeal } from '../../utils/foodLogGrouping';
import { getDailyLog, todayKey, type FoodEntry } from '../../utils/storageUtils';

function formatTimeLabel(ts?: string) {
  if (!ts) return null;
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return null;
  }
}

function formatQty(qty: number) {
  if (!Number.isFinite(qty) || qty <= 0) return '0';
  const rounded = Math.round(qty);
  if (Math.abs(qty - rounded) < 1e-6) return String(rounded);
  const s = qty.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

export default function TodayDetailScreen() {
  const params = useLocalSearchParams<{ focus?: string }>();
  const [log, setLog] = useState<any>({});
  const [showNutritionDetails, setShowNutritionDetails] = useState(false);

  useEffect(() => {
    const load = async () => setLog(await getDailyLog(todayKey()));
    void load();
  }, []);

  const workouts = Array.isArray(log.workouts) ? log.workouts : [];
  const activeRest = Array.isArray(log.activeRest) ? log.activeRest : [];
  const foodEntries = (Array.isArray(log.foodEntries) ? log.foodEntries : []) as FoodEntry[];
  const mealSections = groupFoodEntriesByMeal(foodEntries);
  const nutrientTotals = foodEntries.reduce(
    (acc, row) => {
      acc.carbs += Number((row as any)?.carbs) || 0;
      acc.fat += Number((row as any)?.fat) || 0;
      acc.fiber += Number((row as any)?.fiber) || 0;
      acc.sugar += Number((row as any)?.sugar) || 0;
      acc.sodiumMg += Number((row as any)?.sodiumMg) || 0;
      return acc;
    },
    { carbs: 0, fat: 0, fiber: 0, sugar: 0, sodiumMg: 0 }
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>Today Detail</Text>
          <View style={{ width: 40 }} />
        </View>

        {params.focus ? <Text style={styles.focus}>Focused: {params.focus}</Text> : null}

        <GlassCard>
          <Text style={styles.section}>Summary</Text>
          <Text style={styles.item}>Calories: {Math.round(Number(log.calories) || 0)}</Text>
          <Text style={styles.item}>Protein: {Math.round(Number(log.macros?.protein) || 0)}g</Text>
          <Text style={styles.item}>Carbs: {Math.round(Number(log.macros?.carbs) || 0)}g</Text>
          <Text style={styles.item}>Fat: {Math.round(Number(log.macros?.fat) || 0)}g</Text>
          <Pressable style={styles.detailsToggle} onPress={() => setShowNutritionDetails((v) => !v)}>
            <Text style={styles.detailsToggleText}>{showNutritionDetails ? 'Hide nutrient details' : 'Show nutrient details'}</Text>
          </Pressable>
          {showNutritionDetails ? (
            <>
              <Text style={styles.item}>Fiber: {nutrientTotals.fiber > 0 ? `${Math.round(nutrientTotals.fiber)}g` : '—'}</Text>
              <Text style={styles.item}>Sugar: {nutrientTotals.sugar > 0 ? `${Math.round(nutrientTotals.sugar)}g` : '—'}</Text>
              <Text style={styles.item}>Sodium: {nutrientTotals.sodiumMg > 0 ? `${Math.round(nutrientTotals.sodiumMg)} mg` : '—'}</Text>
            </>
          ) : null}
          <Text style={styles.item}>Water: {Math.round(Number(log.water) || 0)}oz</Text>
          <Text style={styles.item}>Weight: {typeof log.weight === 'number' ? `${log.weight.toFixed(1)} lb` : 'Not logged'}</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>What you ate today</Text>
          <Text style={styles.subtle}>Grouped by meal</Text>

          {foodEntries.length === 0 ? (
            <Text style={styles.emptyText}>No food logged yet today. Your entries will show up here grouped by meal.</Text>
          ) : (
            <View style={{ marginTop: 10 }}>
              {mealSections.map((section) => (
                <View key={section.meal} style={styles.mealBlock}>
                  <View style={styles.mealHeaderRow}>
                    <Text style={styles.mealHeaderText}>
                      {section.label} · {Math.round(section.caloriesTotal)} kcal
                    </Text>
                    {section.proteinTotal > 0 ? (
                      <Text style={styles.mealHeaderMeta}>{Math.round(section.proteinTotal)}g protein</Text>
                    ) : null}
                  </View>

                  {section.rows.length === 0 ? (
                    <Text style={styles.mealEmpty}>No items</Text>
                  ) : (
                    section.rows.map((row) => {
                      const entry = row.entry;
                      const time = formatTimeLabel(entry.ts);
                      const protein = Number(entry.protein) || 0;
                      const calories = Number(entry.calories) || 0;
                      const portion = `${formatQty(row.quantity)} × ${foodEntryPortionLabel(entry)}`;
                      const secondary = `${portion} · ${Math.round(calories)} kcal · ${Math.round(protein)} g protein${time ? ` · ${time}` : ''}`;
                      return (
                        <View key={entry.id} style={styles.entryRow}>
                          <Text style={styles.entryPrimary} numberOfLines={1}>
                            {String(entry.label || 'Food')}
                          </Text>
                          <Text style={styles.entrySecondary} numberOfLines={1}>
                            {secondary}
                          </Text>
                        </View>
                      );
                    })
                  )}
                </View>
              ))}
            </View>
          )}
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Timeline</Text>
          <Text style={styles.item}>Food entries: {foodEntries.length}</Text>
          <Text style={styles.item}>Workouts: {workouts.length}</Text>
          <Text style={styles.item}>Active rest entries: {activeRest.length}</Text>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 20 },
  focus: { color: '#8EDFFF', marginBottom: 8, fontWeight: '700' },
  section: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  item: { color: '#D0D0D0', fontWeight: '600', marginBottom: 6 },
  detailsToggle: {
    marginTop: 6,
    marginBottom: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2F2F2F',
    backgroundColor: '#161616',
  },
  detailsToggleText: { color: '#D3EDF6', fontWeight: '800', fontSize: 12 },
  subtle: { color: '#8FA9B5', fontWeight: '600', marginTop: -2 },
  emptyText: { color: '#C5C5C5', fontWeight: '600', marginTop: 10, lineHeight: 18 },

  mealBlock: { marginTop: 12 },
  mealHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mealHeaderText: { color: '#EAFBFF', fontWeight: '900' },
  mealHeaderMeta: { color: '#A5DDF0', fontWeight: '700', fontSize: 12 },
  mealEmpty: { color: '#8FA9B5', fontWeight: '600', marginTop: 6 },

  entryRow: { marginTop: 10 },
  entryPrimary: { color: '#FFF', fontWeight: '800' },
  entrySecondary: { color: '#B8B8B8', fontWeight: '600', marginTop: 2, fontSize: 12 },
});
