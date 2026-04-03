import { router } from 'expo-router'; import React, { useEffect, useState } from 'react'; import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import NumberPadTextInput from '../../components/inputs/NumberPadTextInput';
import { getUserProfile, setStorageItem, USER_PROFILE_KEY } from '../../utils/storageUtils';

export default function GoalsEditorScreen() {
  const [protein, setProtein] = useState('170');
  const [water, setWater] = useState('120');
  const [rest, setRest] = useState('20');
  const [calories, setCalories] = useState('');

  useEffect(() => {
    const load = async () => {
      const profile = await getUserProfile();
      setProtein(String(Number(profile.goals?.proteinTarget) || 170));
      setWater(String(Number(profile.goals?.waterTargetOz) || 120));
      setRest(String(Number(profile.goals?.activeRestTargetMin) || 20));
      setCalories(profile.goals?.caloriesTarget ? String(profile.goals.caloriesTarget) : '');
    };
    void load();
  }, []);

  const save = async () => {
    Keyboard.dismiss();
    const p = Number(protein);
    const w = Number(water);
    const r = Number(rest);
    const c = calories.trim() ? Number(calories) : undefined;
    if (!(p > 0 && w > 0 && r > 0) || (typeof c === 'number' && !(c > 0))) {
      Alert.alert('Invalid', 'Please enter positive values.');
      return;
    }
    const profile = await getUserProfile();
    await setStorageItem(USER_PROFILE_KEY, {
      ...profile,
      goals: {
        proteinTarget: p,
        waterTargetOz: w,
        activeRestTargetMin: r,
        caloriesTarget: c,
      },
    });
    Alert.alert('Saved', 'Goals updated.');
    router.back();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>Goals Editor</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={styles.note}>These goals power your Log progress bars and Stats summaries.</Text>

        <GlassCard>
          <Text style={styles.label}>Protein Target (g)</Text>
          <NumberPadTextInput style={styles.input} keyboardType="number-pad" value={protein} onChangeText={setProtein} />
          <Text style={styles.label}>Water Target (oz)</Text>
          <NumberPadTextInput style={styles.input} keyboardType="number-pad" value={water} onChangeText={setWater} />
          <Text style={styles.label}>Active Rest Target (min)</Text>
          <NumberPadTextInput style={styles.input} keyboardType="number-pad" value={rest} onChangeText={setRest} />
          <Text style={styles.label}>Calories Target (optional)</Text>
          <NumberPadTextInput style={styles.input} keyboardType="number-pad" value={calories} onChangeText={setCalories} />

          <Pressable style={styles.button} onPress={save}><Text style={styles.buttonText}>Save Goals</Text></Pressable>
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
  note: { color: '#B5B5B5', fontWeight: '600', marginBottom: 10 },
  label: { color: '#E2E2E2', fontWeight: '700', marginTop: 4, marginBottom: 8 },
  input: { backgroundColor: '#0E0E0E', borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 12, color: '#FFF', paddingHorizontal: 12, paddingVertical: 11 },
  button: { marginTop: 12, backgroundColor: '#00D9FF', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#041A22', fontWeight: '900', fontSize: 15 },
});
