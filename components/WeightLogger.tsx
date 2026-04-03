import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { recordEvent } from "../utils/progressEngine";
import {
  getDailyLog,
  getUserProfile,
  safeParseJson,
  saveDailyLog,
  setStorageItem,
  todayKey,
  USER_PROFILE_KEY,
  WEIGHT_LOG_KEY,
  WeightLogEntry,
} from "../utils/storageUtils";
import RankUpModal from "./RankUpModal";
import WinningDayToast from "./WinningDayToast";
import { captureException } from "../utils/crashReporter";
import NumberPadTextInput from "./inputs/NumberPadTextInput";

interface WeightLoggerProps {
  onClose: () => void;
}

export default function WeightLogger({ onClose }: WeightLoggerProps) {
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState<"lbs" | "kg">("lbs");
  const [rankUp, setRankUp] = useState<{ name: string; color: string } | null>(null);
  const [showWinToast, setShowWinToast] = useState(false);

  const handleLogWeight = async () => {
    if (!weight || parseFloat(weight) <= 0) return Alert.alert("Error", "Please enter a valid weight");

    try {
      const weightValue = parseFloat(weight);
      const weightLbs = unit === "kg" ? weightValue * 2.20462 : weightValue;

      const weightData = {
        id: String(Date.now()),
        weight: weightLbs,
        unit: "lbs",
        ts: new Date().toISOString(),
        date: todayKey(),
      } as WeightLogEntry;

      const current = await getDailyLog(weightData.date);
      await saveDailyLog(weightData.date, { ...current, weight: weightLbs });

      const rawWeightLog = await AsyncStorage.getItem(WEIGHT_LOG_KEY);
      const parsedWeightLog = safeParseJson<WeightLogEntry[]>(rawWeightLog, []);
      const nextWeightLog = [weightData, ...(Array.isArray(parsedWeightLog) ? parsedWeightLog : [])];
      await AsyncStorage.setItem(WEIGHT_LOG_KEY, JSON.stringify(nextWeightLog));

      const profile = await getUserProfile();
      if (profile && Object.keys(profile).length > 0) {
        profile.currentWeight = weightLbs;
        profile.weightLog = nextWeightLog;
        await setStorageItem(USER_PROFILE_KEY, profile);
      }

      const res = await recordEvent("weight", { weight: weightLbs });

      if (res.becameWinningDay) setShowWinToast(true);

      if (res.didRankUp && res.newRankName && res.newRankColor) {
        setRankUp({ name: res.newRankName, color: res.newRankColor });
        return;
      }

      const capText = res.xpAdded === 0 ? `Daily XP capped (50/50).` : `+${res.xpAdded} XP (Daily: ${res.dailyXPTotal}/50)`;

      Alert.alert(
        "Weight Logged! ⚖️",
        `${weight} ${unit} recorded\n${capText}`,
        [{ text: "OK", onPress: onClose }]
      );

      setWeight("");
    } catch (e) {
      if (__DEV__) {
        console.log("Error logging weight:", e);
      } else {
        void captureException(e, { feature: "log_weight", op: "record_event" });
      }
      Alert.alert("Error", "Failed to log weight. Please try again.");
    }
  };

  return (
    <>
      <Modal visible animationType="slide" presentationStyle="pageSheet">
        <Pressable style={styles.container} onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Log Weight</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={styles.sectionTitle}>UNIT</Text>
            <View style={styles.unitRow}>
              <TouchableOpacity style={[styles.unitButton, unit === "lbs" && styles.unitButtonSelected]} onPress={() => setUnit("lbs")}>
                <Text style={[styles.unitText, unit === "lbs" && styles.unitTextSelected]}>lbs</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.unitButton, unit === "kg" && styles.unitButtonSelected]} onPress={() => setUnit("kg")}>
                <Text style={[styles.unitText, unit === "kg" && styles.unitTextSelected]}>kg</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>WEIGHT</Text>
            <NumberPadTextInput
              style={styles.input}
              placeholder={unit === "lbs" ? "180" : "82"}
              placeholderTextColor="#666"
              keyboardType="decimal-pad"
              value={weight}
              onChangeText={setWeight}
            />

            <View style={styles.infoCard}>
              <Text style={styles.infoIcon}>ℹ️</Text>
              <Text style={styles.infoText}>Morning weight is most consistent. Log daily for clean trendlines.</Text>
            </View>

            <TouchableOpacity style={[styles.logButton, !weight && styles.logButtonDisabled]} onPress={handleLogWeight} disabled={!weight}>
              <LinearGradient colors={!weight ? ["#2A2A2A", "#2A2A2A"] : ["#8A2BE2", "#00D9FF"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logGradient}>
                <Text style={styles.logButtonText}>LOG WEIGHT</Text>
              </LinearGradient>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>

          <WinningDayToast
            visible={showWinToast}
            title="Progress logged"
            subtitle="Weight entry saved."
            onHide={() => setShowWinToast(false)}
          />
        </Pressable>
      </Modal>

      <RankUpModal
        visible={!!rankUp}
        rankName={rankUp?.name || ""}
        rankColor={rankUp?.color || "#00D9FF"}
        onClose={() => {
          setRankUp(null);
          onClose();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 60, paddingHorizontal: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: "#2A2A2A" },
  closeButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  closeText: { fontSize: 28, color: "#888", fontWeight: "300" },
  title: { fontSize: 20, fontWeight: "bold", color: "#FFFFFF" },
  content: { flex: 1, padding: 20 },
  sectionTitle: { fontSize: 12, fontWeight: "bold", color: "#888", letterSpacing: 1, marginTop: 24, marginBottom: 12 },
  unitRow: { flexDirection: "row" },
  unitButton: { flex: 1, backgroundColor: "#1A1A1A", borderRadius: 12, padding: 20, alignItems: "center", borderWidth: 2, borderColor: "#2A2A2A", marginRight: 10 },
  unitButtonSelected: { borderColor: "#8A2BE2", backgroundColor: "#1A0A2A" },
  unitText: { fontSize: 18, fontWeight: "700", color: "#888" },
  unitTextSelected: { color: "#8A2BE2" },
  input: { backgroundColor: "#1A1A1A", borderRadius: 16, padding: 18, color: "#FFFFFF", fontSize: 16, borderWidth: 2, borderColor: "#2A2A2A" },
  infoCard: { flexDirection: "row", backgroundColor: "#111", borderWidth: 1, borderColor: "#222", borderRadius: 16, padding: 14, marginTop: 16 },
  infoIcon: { marginRight: 10, fontSize: 16 },
  infoText: { flex: 1, color: "#9A9A9A", fontWeight: "700", lineHeight: 18 },
  logButton: { marginTop: 28, borderRadius: 16, overflow: "hidden" },
  logButtonDisabled: { opacity: 0.75 },
  logGradient: { padding: 20, alignItems: "center" },
  logButtonText: { fontSize: 18, fontWeight: "bold", color: "#FFFFFF", letterSpacing: 1 },
});
