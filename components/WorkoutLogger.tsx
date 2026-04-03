import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { recordEvent } from "../utils/progressEngine";
import RankUpModal from "./RankUpModal";
import WinningDayToast from "./WinningDayToast";
import { captureException } from "../utils/crashReporter";
import NumberPadTextInput from "./inputs/NumberPadTextInput";

interface WorkoutLoggerProps {
  onClose: () => void;
}

export default function WorkoutLogger({ onClose }: WorkoutLoggerProps) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [duration, setDuration] = useState("");
  const [intensity, setIntensity] = useState("Medium");

  const [rankUp, setRankUp] = useState<{ name: string; color: string } | null>(null);
  const [showWinToast, setShowWinToast] = useState(false);

  const workoutTypes = [
    { id: "quick", name: "Quick Workout", icon: "⚡", met: 5.0 },
    { id: "cardio", name: "Cardio", icon: "🏃", met: 7.5 },
    { id: "lifting", name: "Lifting", icon: "💪", met: 6.0 },
    { id: "running", name: "Running", icon: "🏃‍♂️", met: 9.8 },
    { id: "sports", name: "Sports", icon: "⚽", met: 8.0 },
    { id: "active_rest", name: "Active Rest", icon: "🧘", met: 2.5 },
  ];

  const intensityLevels = [
    { id: "Low", name: "Low" },
    { id: "Medium", name: "Medium" },
    { id: "High", name: "High" },
    { id: "Extreme", name: "Extreme" },
  ];

  const handleLogWorkout = async () => {
    if (!selectedType) return Alert.alert("Error", "Please select a workout type");
    if (!duration || parseInt(duration) <= 0) return Alert.alert("Error", "Please enter a valid duration");

    const workout = workoutTypes.find((w) => w.id === selectedType);
    if (!workout) return;

    try {
      const res = await recordEvent("workout", {
        type: workout.name,
        icon: workout.icon,
        duration: parseInt(duration),
        intensity,
      });

      if (res.becameWinningDay) setShowWinToast(true);

      if (res.didRankUp && res.newRankName && res.newRankColor) {
        setRankUp({ name: res.newRankName, color: res.newRankColor });
        return;
      }

      const capText = res.xpAdded === 0 ? `Daily XP capped (50/50).` : `+${res.xpAdded} XP (Daily: ${res.dailyXPTotal}/50)`;

      Alert.alert(
        "Workout Logged! 💪",
        `${workout.name} - ${duration} min\n${capText}`,
        [{ text: "OK", onPress: onClose }]
      );

      setSelectedType(null);
      setDuration("");
      setIntensity("Medium");
    } catch (e) {
      if (__DEV__) {
        console.log("Error logging workout:", e);
      } else {
        void captureException(e, { feature: "log_workout", op: "record_event" });
      }
      Alert.alert("Error", "Failed to log workout. Please try again.");
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
            <Text style={styles.title}>Log Workout</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={styles.sectionTitle}>WORKOUT TYPE</Text>
            <View style={styles.typeGrid}>
              {workoutTypes.map((type) => (
                <TouchableOpacity
                  key={type.id}
                  style={[styles.typeCard, selectedType === type.id && styles.typeCardSelected]}
                  onPress={() => setSelectedType(type.id)}
                >
                  <Text style={styles.typeIcon}>{type.icon}</Text>
                  <Text style={styles.typeName}>{type.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionTitle}>DURATION (minutes)</Text>
            <NumberPadTextInput
              style={styles.input}
              placeholder="30"
              placeholderTextColor="#666"
              keyboardType="number-pad"
              value={duration}
              onChangeText={setDuration}
            />

            <Text style={styles.sectionTitle}>INTENSITY</Text>
            <View style={styles.intensityRow}>
              {intensityLevels.map((level) => (
                <TouchableOpacity
                  key={level.id}
                  style={[styles.intensityButton, intensity === level.id && styles.intensityButtonSelected]}
                  onPress={() => setIntensity(level.id)}
                >
                  <Text style={[styles.intensityText, intensity === level.id && styles.intensityTextSelected]}>
                    {level.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.logButton, (!selectedType || !duration) && styles.logButtonDisabled]}
              onPress={handleLogWorkout}
              disabled={!selectedType || !duration}
            >
              <LinearGradient
                colors={(!selectedType || !duration) ? ["#2A2A2A", "#2A2A2A"] : ["#00D9FF", "#8A2BE2"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.logGradient}
              >
                <Text style={styles.logButtonText}>LOG WORKOUT</Text>
              </LinearGradient>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>

          <WinningDayToast
            visible={showWinToast}
            title="Workout logged"
            subtitle="Great session. Keep stacking wins."
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
  typeGrid: { flexDirection: "row", flexWrap: "wrap" },
  typeCard: { width: "48%", aspectRatio: 1.6, backgroundColor: "#1A1A1A", borderRadius: 16, justifyContent: "center", alignItems: "center", borderWidth: 2, borderColor: "#2A2A2A", marginBottom: 12, marginRight: "4%" },
  typeCardSelected: { borderColor: "#00D9FF", backgroundColor: "#0A2A2A" },
  typeIcon: { fontSize: 32, marginBottom: 8 },
  typeName: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },
  input: { backgroundColor: "#1A1A1A", borderRadius: 16, padding: 18, color: "#FFFFFF", fontSize: 16, borderWidth: 2, borderColor: "#2A2A2A" },
  intensityRow: { flexDirection: "row", flexWrap: "wrap" },
  intensityButton: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, backgroundColor: "#1A1A1A", borderWidth: 1, borderColor: "#2A2A2A", marginRight: 10, marginBottom: 10 },
  intensityButtonSelected: { borderColor: "#8A2BE2", backgroundColor: "#1A0A2A" },
  intensityText: { color: "#888", fontWeight: "700" },
  intensityTextSelected: { color: "#8A2BE2" },
  logButton: { marginTop: 28, borderRadius: 16, overflow: "hidden" },
  logButtonDisabled: { opacity: 0.75 },
  logGradient: { padding: 20, alignItems: "center" },
  logButtonText: { fontSize: 18, fontWeight: "bold", color: "#FFFFFF", letterSpacing: 1 },
});
