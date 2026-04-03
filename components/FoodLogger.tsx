import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { recordEvent } from "../utils/progressEngine";
import RankUpModal from "./RankUpModal";
import WinningDayToast from "./WinningDayToast";
import { captureException } from "../utils/crashReporter";
import NumberPadTextInput from "./inputs/NumberPadTextInput";

interface FoodLoggerProps {
  onClose: () => void;
}

export default function FoodLogger({ onClose }: FoodLoggerProps) {
  const [selectedMeal, setSelectedMeal] = useState<string | null>(null);
  const [foodName, setFoodName] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fats, setFats] = useState("");

  const [rankUp, setRankUp] = useState<{ name: string; color: string } | null>(null);
  const [showWinToast, setShowWinToast] = useState(false);

  const meals = [
    { id: "breakfast", name: "Breakfast", icon: "🌅" },
    { id: "lunch", name: "Lunch", icon: "☀️" },
    { id: "dinner", name: "Dinner", icon: "🌙" },
    { id: "snacks", name: "Snacks", icon: "🍎" },
  ];

  const handleLogFood = async () => {
    if (!selectedMeal) return Alert.alert("Error", "Please select a meal");
    if (!foodName.trim()) return Alert.alert("Error", "Please enter a food name");
    if (!calories || parseInt(calories) <= 0) return Alert.alert("Error", "Please enter valid calories");

    try {
      const res = await recordEvent("food", {
        name: foodName,
        calories: parseInt(calories),
        protein: protein ? parseInt(protein) : 0,
        carbs: carbs ? parseInt(carbs) : 0,
        fats: fats ? parseInt(fats) : 0,
        meal: selectedMeal,
      });

      if (res.becameWinningDay) setShowWinToast(true);

      if (res.didRankUp && res.newRankName && res.newRankColor) {
        setRankUp({ name: res.newRankName, color: res.newRankColor });
        return;
      }

      const capText = res.xpAdded === 0 ? `Daily XP capped (50/50).` : `+${res.xpAdded} XP (Daily: ${res.dailyXPTotal}/50)`;
      const mealName = meals.find(m => m.id === selectedMeal)?.name || "Meal";

      Alert.alert(
        "Food Logged! 🍎",
        `${foodName} - ${calories} cal\nAdded to ${mealName}\n${capText}`,
        [{ text: "OK", onPress: onClose }]
      );

      setSelectedMeal(null);
      setFoodName("");
      setCalories("");
      setProtein("");
      setCarbs("");
      setFats("");
    } catch (e) {
      if (__DEV__) {
        console.log("Error logging food:", e);
      } else {
        void captureException(e, { feature: "log_food", op: "record_event" });
      }
      Alert.alert("Error", "Failed to log food. Please try again.");
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
            <Text style={styles.title}>Log Food</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={styles.sectionTitle}>MEAL</Text>
            <View style={styles.mealGrid}>
              {meals.map((meal) => (
                <TouchableOpacity
                  key={meal.id}
                  style={[styles.mealCard, selectedMeal === meal.id && styles.mealCardSelected]}
                  onPress={() => setSelectedMeal(meal.id)}
                >
                  <Text style={styles.mealIcon}>{meal.icon}</Text>
                  <Text style={styles.mealName}>{meal.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionTitle}>FOOD NAME</Text>
            <TextInput style={styles.input} placeholder="Chicken breast, rice, etc." placeholderTextColor="#666" value={foodName} onChangeText={setFoodName} />

            <Text style={styles.sectionTitle}>CALORIES</Text>
            <NumberPadTextInput
              style={styles.input}
              placeholder="200"
              placeholderTextColor="#666"
              keyboardType="number-pad"
              value={calories}
              onChangeText={setCalories}
            />

            <Text style={styles.sectionTitle}>MACROS (optional)</Text>
            <View style={styles.macroRow}>
              <View style={styles.macroInput}>
                <Text style={styles.macroLabel}>Protein (g)</Text>
                <NumberPadTextInput
                  style={styles.input}
                  placeholder="20"
                  placeholderTextColor="#666"
                  keyboardType="number-pad"
                  value={protein}
                  onChangeText={setProtein}
                />
              </View>
              <View style={styles.macroInput}>
                <Text style={styles.macroLabel}>Carbs (g)</Text>
                <NumberPadTextInput
                  style={styles.input}
                  placeholder="30"
                  placeholderTextColor="#666"
                  keyboardType="number-pad"
                  value={carbs}
                  onChangeText={setCarbs}
                />
              </View>
              <View style={styles.macroInput}>
                <Text style={styles.macroLabel}>Fats (g)</Text>
                <NumberPadTextInput
                  style={styles.input}
                  placeholder="10"
                  placeholderTextColor="#666"
                  keyboardType="number-pad"
                  value={fats}
                  onChangeText={setFats}
                />
              </View>
            </View>

            <TouchableOpacity style={[styles.logButton, (!selectedMeal || !foodName || !calories) && styles.logButtonDisabled]} onPress={handleLogFood} disabled={!selectedMeal || !foodName || !calories}>
              <LinearGradient colors={(!selectedMeal || !foodName || !calories) ? ["#2A2A2A", "#2A2A2A"] : ["#00FF88", "#00D9FF"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logGradient}>
                <Text style={styles.logButtonText}>LOG FOOD</Text>
              </LinearGradient>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>

          <WinningDayToast
            visible={showWinToast}
            title="Winning day secured"
            subtitle="Food logged successfully."
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
  mealGrid: { flexDirection: "row", flexWrap: "wrap" },
  mealCard: { width: "48%", aspectRatio: 2, backgroundColor: "#1A1A1A", borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#2A2A2A", marginBottom: 12, marginRight: "4%" },
  mealCardSelected: { borderColor: "#00FF88", backgroundColor: "#0A2A1A" },
  mealIcon: { fontSize: 18, marginRight: 8 },
  mealName: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  input: { backgroundColor: "#1A1A1A", borderRadius: 16, padding: 18, color: "#FFFFFF", fontSize: 16, borderWidth: 2, borderColor: "#2A2A2A" },
  macroRow: { flexDirection: "row" },
  macroInput: { flex: 1, marginRight: 10 },
  macroLabel: { color: "#777", fontWeight: "700", marginBottom: 8 },
  logButton: { marginTop: 28, borderRadius: 16, overflow: "hidden" },
  logButtonDisabled: { opacity: 0.75 },
  logGradient: { padding: 20, alignItems: "center" },
  logButtonText: { fontSize: 18, fontWeight: "bold", color: "#FFFFFF", letterSpacing: 1 },
});
