import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import WinningDayToast from "../../components/WinningDayToast";
import NumberPadTextInput from "../../components/inputs/NumberPadTextInput";
import ZenithScrollView from "../../components/layout/ZenithScrollView";
import ModalHeader from "../../components/ui/ModalHeader";
import {
  getDailyLog,
  getRecentDailyLogs,
  getUserProfile,
  saveDailyLog,
  todayKey,
  WorkoutEntry,
  WorkoutExerciseBlock,
  WorkoutSetEntry,
} from "../../utils/storageUtils";
import { calculateWorkoutCaloriesBurned, INTENSITY_HELP, Intensity, resolveWeightKg, WorkoutType } from "../../utils/calorieBurn";
import { evaluateWinningDay, getWinningSnapshot } from "../../utils/winningSystem";
import { computeEffort, getXpWeightForEngine, resolveEngineFromWorkout } from "../../utils/effortEngine";
import { getBehaviorMultipliers, settleBehaviorDay } from "../../utils/behavioralCore";
import { createWorkoutMetricVersionSet } from "../../utils/workoutMetricVersions";

type WorkoutTemplate = {
  label: string;
  type: WorkoutType;
  intensity: Intensity;
  minutes: number;
  exercises?: string[];
};

type SetType = "warmup" | "working" | "drop" | "failure";
type WeightUnit = "lb" | "kg";
type EditTarget = { exerciseIndex: number; setIndex: number } | null;
type DeletedSetPayload = {
  exerciseIndex: number;
  setIndex: number;
  exerciseName: string;
  set: WorkoutSetEntry;
} | null;

const WORKOUT_TEMPLATES: WorkoutTemplate[] = [
  { label: "Quick Lift", type: "strength", intensity: "moderate", minutes: 30, exercises: ["Bench Press", "Row"] },
  { label: "Conditioning", type: "cardio", intensity: "hard", minutes: 25 },
  { label: "Mobility Flow", type: "mobility", intensity: "easy", minutes: 20 },
  { label: "Main Session", type: "strength", intensity: "hard", minutes: 60, exercises: ["Squat", "Bench Press", "Deadlift"] },
];

const WORKOUT_TEMPLATES_KEY = "workoutTemplates";
const XP_PREVIEW_WORKOUT = 12;
const CTA_BAR_MIN_HEIGHT = 76;
const CTA_BUTTON_HEIGHT = 56;
const CTA_BUTTON_RADIUS = 18;
const CTA_HPAD = 16;
const CTA_BOTTOM_OFFSET = 10;

type SavedWorkoutTemplate = {
  id: string;
  name: string;
  type: WorkoutType;
  intensity: Intensity;
  minutes?: number;
  sessionNote?: string;
  exercises: WorkoutExerciseBlock[];
  createdAt: string;
};

function ToggleRow<T extends string>({
  values,
  selected,
  onSelect,
}: {
  values: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.row}>
      {values.map((value) => (
        <Pressable key={value} onPress={() => onSelect(value)} style={[styles.pill, selected === value && styles.pillOn]}>
          <Text style={[styles.pillText, selected === value && styles.pillTextOn]}>{value}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function normalizeExercise(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function estimateWorkoutBaseXP(input: {
  durationMin?: number;
  totalSets: number;
  effortScore: number;
}) {
  const duration = Math.max(0, Number(input.durationMin) || 0);
  const sets = Math.max(0, Number(input.totalSets) || 0);
  const effortScore = Math.max(0, Number(input.effortScore) || 0);
  const raw = 4 + duration * 0.15 + sets * 0.9 + effortScore * 0.06;
  return Math.max(4, Math.round(raw));
}

export default function WorkoutModal() {
  const params = useLocalSearchParams<{
    repeatDate?: string;
    repeatSessionId?: string;
    presetType?: string;
    presetIntensity?: string;
    presetTemplate?: string;
    presetNote?: string;
  }>();
  const insets = useSafeAreaInsets();
  const [type, setType] = useState<WorkoutType>("strength");
  const [intensity, setIntensity] = useState<Intensity>("moderate");
  const [minutes, setMinutes] = useState("");
  const [templateLabel, setTemplateLabel] = useState<string | undefined>();
  const [sessionNote, setSessionNote] = useState("");

  const [exerciseName, setExerciseName] = useState("");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("lb");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState("");
  const [restSec, setRestSec] = useState("");
  const [setNotes, setSetNotes] = useState("");
  const [setTag, setSetTag] = useState<SetType>("working");
  const [showMoreFields, setShowMoreFields] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);

  const [exercises, setExercises] = useState<WorkoutExerciseBlock[]>([]);
  const [collapsedExercises, setCollapsedExercises] = useState<Record<string, boolean>>({});
  const [deletedSet, setDeletedSet] = useState<DeletedSetPayload>(null);

  const [recentWorkouts, setRecentWorkouts] = useState<WorkoutEntry[]>([]);
  const [recentExercises, setRecentExercises] = useState<string[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<SavedWorkoutTemplate[]>([]);
  const [weightKg, setWeightKg] = useState(80);
  const [repeatLoaded, setRepeatLoaded] = useState(false);
  const [presetApplied, setPresetApplied] = useState(false);

  const [saving, setSaving] = useState(false);
  const [sessionSetupCollapsed, setSessionSetupCollapsed] = useState(true);
  const [winningBefore, setWinningBefore] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastTitle, setToastTitle] = useState("Saved");
  const [toastSubtitle, setToastSubtitle] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    const loadContext = async () => {
      const [todayLog, profile, days] = await Promise.all([getDailyLog(todayKey()), getUserProfile(), getRecentDailyLogs(30)]);
      if (!alive) return;
      setWeightKg(resolveWeightKg(todayLog, profile).weightKg);
      const prefUnits = (profile as any)?.preferences?.units;
      setWeightUnit(prefUnits === "kg-ml" ? "kg" : "lb");
      const winningEval = evaluateWinningDay(todayLog, {
        activeRestTargetMin: Number((profile as any)?.goals?.activeRestTargetMin) || 20,
        caloriesTarget: Number((profile as any)?.goals?.caloriesTarget) || undefined,
      });
      setWinningBefore(winningEval.winningDay);

      const workouts = days
        .flatMap((row) => (Array.isArray(row.log.workouts) ? row.log.workouts : []))
        .filter((row): row is WorkoutEntry => typeof row?.type === "string")
        .slice(0, 12);
      setRecentWorkouts(workouts);

      const exerciseNames = days
        .flatMap((row) => (Array.isArray(row.log.workouts) ? row.log.workouts : []))
        .flatMap((workout) => (Array.isArray(workout?.exercises) ? workout.exercises : []))
        .map((block) => normalizeExercise(String(block?.name || "")))
        .filter(Boolean);
      setRecentExercises(Array.from(new Set(exerciseNames)).slice(0, 12));

      const rawTemplates = await AsyncStorage.getItem(WORKOUT_TEMPLATES_KEY);
      let parsedTemplates: SavedWorkoutTemplate[] = [];
      try {
        parsedTemplates = rawTemplates ? (JSON.parse(rawTemplates) as SavedWorkoutTemplate[]) : [];
      } catch {
        parsedTemplates = [];
      }
      setSavedTemplates(Array.isArray(parsedTemplates) ? parsedTemplates : []);
    };
    void loadContext();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (repeatLoaded) return;
    const repeatDate = typeof params.repeatDate === "string" ? params.repeatDate : "";
    const repeatSessionId = typeof params.repeatSessionId === "string" ? params.repeatSessionId : "";
    if (!repeatDate || !repeatSessionId) return;
    let alive = true;
    const loadRepeat = async () => {
      const sourceLog = await getDailyLog(repeatDate);
      const sourceSessions = (Array.isArray(sourceLog.workouts) ? sourceLog.workouts : []) as WorkoutEntry[];
      const source = sourceSessions.find((session) => session.id === repeatSessionId);
      if (!alive || !source) return;
      setType(source.type);
      setIntensity(source.intensity);
      setMinutes(source.durationMin ? String(source.durationMin) : source.minutes ? String(source.minutes) : "");
      setTemplateLabel(source.label || "Repeated Session");
      setSessionNote(source.note || "Repeated from history");
      setExercises(cloneExercises((source.exercises || []) as WorkoutExerciseBlock[]));
      setExerciseName(source.exercises?.[0]?.name || "");
      showFeedback("Session loaded", repeatDate);
      setRepeatLoaded(true);
    };
    void loadRepeat();
    return () => {
      alive = false;
    };
  }, [params.repeatDate, params.repeatSessionId, repeatLoaded]);

  useEffect(() => {
    if (presetApplied || repeatLoaded) return;
    const presetType = String(params.presetType || "").toLowerCase();
    const presetIntensity = String(params.presetIntensity || "").toLowerCase();
    const presetTemplate = String(params.presetTemplate || "").trim();
    const presetNote = String(params.presetNote || "").trim();

    const nextType: WorkoutType =
      presetType === "cardio" || presetType === "mobility" || presetType === "strength"
        ? (presetType as WorkoutType)
        : "strength";
    const nextIntensity: Intensity =
      presetIntensity === "easy" || presetIntensity === "hard" || presetIntensity === "moderate"
        ? (presetIntensity as Intensity)
        : "moderate";

    if (!presetTemplate && !presetType && !presetIntensity && !presetNote) return;

    setType(nextType);
    setIntensity(nextIntensity);
    setTemplateLabel(presetTemplate || undefined);
    if (presetNote) setSessionNote(presetNote);
    setPresetApplied(true);
    showFeedback("Preset loaded", presetTemplate || `${nextType} ${nextIntensity}`);
  }, [params.presetIntensity, params.presetNote, params.presetTemplate, params.presetType, presetApplied, repeatLoaded]);

  const sessionSummary = useMemo(() => {
    const sets = exercises.flatMap((block) => block.sets);
    const totalSets = sets.length;
    const totalReps = sets.reduce((sum, row) => sum + (Number(row.reps) || 0), 0);
    const totalVolume = sets.reduce((sum, row) => sum + (Number(row.weight) || 0) * (Number(row.reps) || 0), 0);
    const exerciseCount = exercises.length;
    const estimatedSessionLoad = weightKg > 0 ? Number((totalVolume / weightKg).toFixed(1)) : undefined;
    return { totalSets, totalReps, totalVolume, exerciseCount, estimatedSessionLoad };
  }, [exercises, weightKg]);

  const draftMinutes = Math.max(0, Number(minutes) || 0);
  const draftBurnKcal = draftMinutes > 0
    ? calculateWorkoutCaloriesBurned({
        type,
        intensity,
        minutes: draftMinutes,
        weightKg,
      })
    : 0;

  const hasUnsavedDraft =
    exercises.length > 0 ||
    Boolean(exerciseName.trim() || weight.trim() || reps.trim() || minutes.trim() || sessionNote.trim());

  const canFinalize = sessionSummary.totalSets > 0 || draftMinutes > 0;
  const canAddSet =
    !!normalizeExercise(exerciseName) &&
    Number.isFinite(Number(weight)) &&
    Number(weight) > 0 &&
    Number.isFinite(Number(reps)) &&
    Number(reps) > 0;

  const showFeedback = (title: string, subtitle?: string) => {
    setToastTitle(title);
    setToastSubtitle(subtitle);
    setShowToast(true);
  };

  useEffect(() => {
    if (sessionSummary.totalSets > 0 && !sessionSetupCollapsed) {
      setSessionSetupCollapsed(true);
    }
  }, [sessionSummary.totalSets, sessionSetupCollapsed]);

  const clearSetInput = () => {
    setWeight("");
    setReps("");
    setRpe("");
    setRestSec("");
    setSetNotes("");
    setSetTag("working");
    setEditTarget(null);
  };

  const cloneExercises = (blocks: WorkoutExerciseBlock[]) =>
    blocks.map((block) => ({
      name: block.name,
      sets: block.sets.map((set, idx) => ({
        ...set,
        setIndex: idx + 1,
      })),
    }));

  const applyTemplate = (template: WorkoutTemplate) => {
    setType(template.type);
    setIntensity(template.intensity);
    setMinutes(String(template.minutes));
    setTemplateLabel(template.label);
    setSessionNote(template.label);
    if (template.exercises?.length) {
      setExercises(
        template.exercises.map((name) => ({
          name,
          sets: [],
        }))
      );
      setExerciseName(template.exercises[0]);
    } else {
      setExercises([]);
    }
    showFeedback("Template applied", template.label);
  };

  const applySavedTemplate = (template: SavedWorkoutTemplate, feedback = "Template applied") => {
    setType(template.type);
    setIntensity(template.intensity);
    setMinutes(template.minutes ? String(template.minutes) : "");
    setTemplateLabel(template.name);
    setSessionNote(template.sessionNote || template.name);
    setExercises(cloneExercises(template.exercises || []));
    setExerciseName(template.exercises?.[0]?.name || "");
    showFeedback(feedback, template.name);
  };

  const onWeightUnitChange = (nextUnit: WeightUnit) => {
    if (nextUnit === weightUnit) return;
    const value = Number(weight);
    if (Number.isFinite(value) && value > 0) {
      const converted = nextUnit === "kg" ? value / 2.20462 : value * 2.20462;
      setWeight(String(Number(converted.toFixed(1))));
    }
    setWeightUnit(nextUnit);
  };

  const moveExercise = (index: number, direction: "up" | "down") => {
    setExercises((prev) => {
      const next = [...prev];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return prev;
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return next;
    });
  };

  const moveSet = (exerciseIndex: number, setIndex: number, direction: "up" | "down") => {
    setExercises((prev) => {
      const next = prev.map((block) => ({ ...block, sets: [...block.sets] }));
      const block = next[exerciseIndex];
      if (!block) return prev;
      const target = direction === "up" ? setIndex - 1 : setIndex + 1;
      if (target < 0 || target >= block.sets.length) return prev;
      const temp = block.sets[setIndex];
      block.sets[setIndex] = block.sets[target];
      block.sets[target] = temp;
      block.sets = block.sets.map((row, idx) => ({ ...row, setIndex: idx + 1 }));
      return next;
    });
  };

  const updateSet = (exerciseIndex: number, setIndex: number, updater: (set: WorkoutSetEntry) => WorkoutSetEntry) => {
    setExercises((prev) => {
      const next = prev.map((block) => ({ ...block, sets: [...block.sets] }));
      const block = next[exerciseIndex];
      if (!block) return prev;
      const target = block.sets[setIndex];
      if (!target) return prev;
      block.sets[setIndex] = updater(target);
      return next;
    });
  };

  const onIncrementReps = (exerciseIndex: number, setIndex: number) => {
    updateSet(exerciseIndex, setIndex, (set) => ({ ...set, reps: Math.max(1, (Number(set.reps) || 0) + 1) }));
  };

  const onDecrementReps = (exerciseIndex: number, setIndex: number) => {
    updateSet(exerciseIndex, setIndex, (set) => ({ ...set, reps: Math.max(1, (Number(set.reps) || 0) - 1) }));
  };

  const upsertSet = () => {
    const name = normalizeExercise(exerciseName);
    const weightNumber = Number(weight);
    const repsNumber = Number(reps);
    if (!name || !Number.isFinite(weightNumber) || weightNumber <= 0 || !Number.isFinite(repsNumber) || repsNumber <= 0) {
      showFeedback("Missing set data", "Exercise, weight, and reps are required");
      return;
    }

    setExercises((prev) => {
      const next = prev.map((block) => ({ ...block, sets: [...block.sets] }));
      if (editTarget) {
        const block = next[editTarget.exerciseIndex];
        if (!block) return prev;
        block.sets[editTarget.setIndex] = {
          ...block.sets[editTarget.setIndex],
          weight: weightNumber,
          reps: repsNumber,
          rpe: Number(rpe) || undefined,
          restSec: Number(restSec) || undefined,
          setType: setTag,
          notes: setNotes.trim() || undefined,
          timestamp: new Date().toISOString(),
        };
        return next;
      }

      const exerciseIndex = next.findIndex((block) => normalizeExercise(block.name).toLowerCase() === name.toLowerCase());
      const setPayload: WorkoutSetEntry = {
        setIndex: 1,
        weight: weightNumber,
        weightUnit,
        reps: repsNumber,
        rpe: Number(rpe) || undefined,
        restSec: Number(restSec) || undefined,
        setType: setTag,
        notes: setNotes.trim() || undefined,
        timestamp: new Date().toISOString(),
      };

      if (exerciseIndex >= 0) {
        const block = next[exerciseIndex];
        setPayload.setIndex = block.sets.length + 1;
        block.sets.push(setPayload);
      } else {
        next.push({
          name,
          sets: [{ ...setPayload, setIndex: 1 }],
        });
      }
      return next;
    });

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    showFeedback(editTarget ? "Set updated" : "Set added");
    clearSetInput();
  };

  const onEditSet = (exerciseIndex: number, setIndex: number) => {
    const target = exercises[exerciseIndex]?.sets[setIndex];
    if (!target) return;
    setExerciseName(exercises[exerciseIndex].name);
    setWeight(String(target.weight));
    setWeightUnit(target.weightUnit || "lb");
    setReps(String(target.reps));
    setRpe(target.rpe ? String(target.rpe) : "");
    setRestSec(target.restSec ? String(target.restSec) : "");
    setSetNotes(target.notes || "");
    setSetTag((target.setType as SetType) || "working");
    setEditTarget({ exerciseIndex, setIndex });
  };

  const onDeleteSet = (exerciseIndex: number, setIndex: number) => {
    setExercises((prev) => {
      const next = prev.map((block) => ({ ...block, sets: [...block.sets] }));
      const block = next[exerciseIndex];
      if (!block) return prev;
      const target = block.sets[setIndex];
      if (!target) return prev;
      setDeletedSet({
        exerciseIndex,
        setIndex,
        exerciseName: block.name,
        set: target,
      });
      block.sets.splice(setIndex, 1);
      block.sets = block.sets.map((row, idx) => ({ ...row, setIndex: idx + 1 }));
      const cleaned = next.filter((row) => row.sets.length > 0);
      return cleaned;
    });
    showFeedback("Set removed", "Tap Undo to restore");
  };

  const onDuplicateSet = (exerciseIndex: number, setIndex: number) => {
    setExercises((prev) => {
      const next = prev.map((block) => ({ ...block, sets: [...block.sets] }));
      const block = next[exerciseIndex];
      if (!block) return prev;
      const target = block.sets[setIndex];
      if (!target) return prev;
      block.sets.splice(setIndex + 1, 0, {
        ...target,
        timestamp: new Date().toISOString(),
      });
      block.sets = block.sets.map((row, idx) => ({ ...row, setIndex: idx + 1 }));
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    showFeedback("Set duplicated");
  };

  const undoDeleteSet = () => {
    if (!deletedSet) return;
    setExercises((prev) => {
      const next = prev.map((block) => ({ ...block, sets: [...block.sets] }));
      let block = next.find((row) => normalizeExercise(row.name).toLowerCase() === normalizeExercise(deletedSet.exerciseName).toLowerCase());
      if (!block) {
        block = { name: deletedSet.exerciseName, sets: [] };
        next.push(block);
      }
      block.sets.splice(deletedSet.setIndex, 0, deletedSet.set);
      block.sets = block.sets.map((row, idx) => ({ ...row, setIndex: idx + 1 }));
      return next;
    });
    setDeletedSet(null);
    showFeedback("Set restored");
  };

  const copyLastSet = () => {
    const name = normalizeExercise(exerciseName);
    if (!name) return;
    const block = exercises.find((row) => normalizeExercise(row.name).toLowerCase() === name.toLowerCase());
    const last = block?.sets[block.sets.length - 1];
    if (!last) return;
    setWeight(String(last.weight));
    setWeightUnit(last.weightUnit || "lb");
    setReps(String(last.reps));
    setRpe(last.rpe ? String(last.rpe) : "");
    setRestSec(last.restSec ? String(last.restSec) : "");
    setSetTag((last.setType as SetType) || "working");
    setSetNotes(last.notes || "");
  };

  const buildWorkoutPayload = async (): Promise<WorkoutEntry | null> => {
    const durationMin = Number(minutes) || undefined;
    if (!durationMin && sessionSummary.totalSets <= 0) return null;
    const date = todayKey();
    const current = await getDailyLog(date);
    const profile = await getUserProfile();
    const { weightKg: resolvedWeightKg, source } = resolveWeightKg(current, profile);
    const caloriesBurned =
      typeof durationMin === "number" && durationMin > 0
        ? calculateWorkoutCaloriesBurned({ type, intensity, minutes: durationMin, weightKg: resolvedWeightKg })
        : undefined;
    const engineType = resolveEngineFromWorkout({ type, label: templateLabel });
    const effort = computeEffort({
      durationMin: durationMin || 0,
      activeCalories: caloriesBurned,
      engine: engineType,
      intensity,
      setCount: sessionSummary.totalSets,
    });
    const xpBase = estimateWorkoutBaseXP({
      durationMin,
      totalSets: sessionSummary.totalSets,
      effortScore: effort.effortScore,
    });
    const xpWeight = await getXpWeightForEngine(engineType);
    const behavior = await getBehaviorMultipliers(date);
    const xpAwarded = Math.max(1, Math.round(xpBase * xpWeight * behavior.xpEfficiency));
    const nowIso = new Date().toISOString();

    return {
      id: String(Date.now()),
      ts: nowIso,
      type,
      intensity,
      minutes: durationMin,
      durationMin,
      label: templateLabel?.trim() || undefined,
      note: sessionNote.trim() || undefined,
      exercises: exercises.length ? exercises : undefined,
      totalSets: sessionSummary.totalSets || undefined,
      totalReps: sessionSummary.totalReps || undefined,
      totalVolume: sessionSummary.totalVolume || undefined,
      exerciseCount: sessionSummary.exerciseCount || undefined,
      estimatedSessionLoad: sessionSummary.estimatedSessionLoad,
      caloriesBurned,
      weightSource: source,
      workoutClass: "manual",
      engineType,
      effortUnits: effort.effortUnits,
      effortScore: effort.effortScore,
      intensityBand: effort.intensityBand,
      effortConfidence: effort.confidence,
      verifiedEffort: false,
      setCount: sessionSummary.totalSets || undefined,
      sourceAuthority: "phone",
      xpBase,
      xpWeight,
      xpEfficiency: behavior.xpEfficiency,
      xpAwarded,
      metricVersions: createWorkoutMetricVersionSet(),
      metricsLock: {
        metricsImmutable: true,
        metricsLockedAtUtc: nowIso,
        sessionIntegrityState: 'finalized',
      },
    };
  };

  const onFinalize = async () => {
    if (saving) return;
    const payload = await buildWorkoutPayload();
    if (!payload) {
      showFeedback("Add duration or at least one set");
      return;
    }
    Alert.alert(
      "Confirm Workout Log",
      `XP +${payload.xpAwarded || XP_PREVIEW_WORKOUT} · Winning Day settles from verified sessions · ${payload.totalSets || 0} sets`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log Workout",
          onPress: async () => {
            setSaving(true);
            try {
              const beforeSnapshot = await getWinningSnapshot();
              const date = todayKey();
              const current = await getDailyLog(date);
              await saveDailyLog(date, {
                ...current,
                workouts: [payload, ...(current.workouts || [])],
              });
              await settleBehaviorDay(date);
              const afterSnapshot = await getWinningSnapshot();
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              showFeedback(
                "Workout logged",
                `+${payload.xpAwarded || XP_PREVIEW_WORKOUT} XP · Streak ${beforeSnapshot.currentStreak}->${afterSnapshot.currentStreak} · Winning ${afterSnapshot.today.winningDay ? "YES" : "NO"}`
              );
              setTimeout(() => router.back(), 420);
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const onBack = () => {
    if (!hasUnsavedDraft) {
      router.back();
      return;
    }
    Alert.alert("Discard this session?", "You have unsaved workout changes.", [
      { text: "Cancel", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  };

  const exerciseHint = useMemo(() => {
    const name = normalizeExercise(exerciseName);
    if (!name) return null;
    for (const workout of recentWorkouts) {
      const blocks = Array.isArray(workout.exercises) ? workout.exercises : [];
      const block = blocks.find((row) => normalizeExercise(row.name).toLowerCase() === name.toLowerCase());
      const last = block?.sets?.[block.sets.length - 1];
      if (last) return `Last: ${last.weight} ${last.weightUnit} x ${last.reps}`;
    }
    return null;
  }, [exerciseName, recentWorkouts]);

  return (
    <SafeAreaView style={styles.screen}>
      <ZenithScrollView
        contentContainerStyle={[styles.container, { paddingBottom: CTA_BAR_MIN_HEIGHT + insets.bottom + CTA_BOTTOM_OFFSET + 16 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      >
          <ModalHeader title="Log Workout" onBack={onBack} rightLabel="Done" onRight={onFinalize} rightDisabled={!canFinalize || saving} />
          <Text style={styles.hook}>Log a session to earn XP and protect your streak.</Text>

          <View style={styles.sessionCard}>
            <Pressable style={styles.sessionHeader} onPress={() => setSessionSetupCollapsed((prev) => !prev)}>
              <Text style={styles.label}>Details</Text>
              <Text style={styles.sessionToggle}>{sessionSetupCollapsed ? "Show" : "Hide"}</Text>
            </Pressable>
            {!sessionSetupCollapsed ? (
              <>
                <Text style={styles.label}>Quick templates</Text>
                <View style={styles.rowWrap}>
                  {WORKOUT_TEMPLATES.map((template) => (
                    <Pressable
                      key={template.label}
                      style={[styles.quickChip, templateLabel === template.label && styles.quickChipActive]}
                      onPress={() => applyTemplate(template)}
                    >
                      <Text style={styles.quickChipText}>{template.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {savedTemplates.length ? <Text style={styles.label}>Saved templates</Text> : null}
                {savedTemplates.length ? (
                  <View style={styles.rowWrap}>
                    {savedTemplates.slice(0, 6).map((template) => (
                      <Pressable key={template.id} style={styles.recentChip} onPress={() => applySavedTemplate(template)}>
                        <Text style={styles.recentChipText}>{template.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                <Text style={styles.label}>Type</Text>
                <ToggleRow values={["strength", "cardio", "mobility"] as const} selected={type} onSelect={setType} />

                <Text style={styles.label}>Intensity</Text>
                <ToggleRow values={["easy", "moderate", "hard"] as const} selected={intensity} onSelect={setIntensity} />
                <Text style={styles.intensityHelp}>{INTENSITY_HELP[intensity]}</Text>

                <NumberPadTextInput
                  style={styles.input}
                  placeholder="Duration minutes (optional)"
                  placeholderTextColor="#888"
                  keyboardType="number-pad"
                  value={minutes}
                  onChangeText={setMinutes}
                />

                {sessionSummary.totalSets > 0 || Number(minutes) > 0 ? (
                  <View style={styles.impactCard}>
                    <Text style={styles.impactTitle}>Impact Preview</Text>
                    <Text style={styles.impactLine}>Before: {winningBefore ? "Winning Day YES" : "Winning Day NO"}</Text>
                    <Text style={styles.impactLine}>After log: evaluated from verified sessions</Text>
                    <Text style={styles.impactLine}>XP preview: +{XP_PREVIEW_WORKOUT}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>

          {sessionSummary.totalSets > 0 ? (
            <View style={styles.summaryStrip}>
              <Text style={styles.summaryText}>Sets {sessionSummary.totalSets}</Text>
              <Text style={styles.summaryText}>Reps {sessionSummary.totalReps}</Text>
              <Text style={styles.summaryText}>Volume {Math.round(sessionSummary.totalVolume)} {weightUnit}*reps</Text>
              <Text style={styles.summaryText}>Est burn {Math.round(draftBurnKcal)} kcal</Text>
            </View>
          ) : null}

          <Text style={styles.label}>Add set</Text>
          <TextInput
            style={styles.input}
            placeholder="Exercise (e.g., Bench Press)"
            placeholderTextColor="#888"
            value={exerciseName}
            onChangeText={setExerciseName}
          />
          {recentExercises.length ? (
            <View style={styles.rowWrap}>
              {recentExercises.slice(0, 6).map((name) => (
                <Pressable key={name} style={styles.recentChip} onPress={() => setExerciseName(name)}>
                  <Text style={styles.recentChipText}>{name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {exerciseHint ? <Text style={styles.hintText}>{exerciseHint}</Text> : null}

          <View style={styles.row}>
            <NumberPadTextInput
              style={[styles.input, styles.col]}
              placeholder={`Weight (${weightUnit})`}
              placeholderTextColor="#888"
              keyboardType="decimal-pad"
              value={weight}
              onChangeText={setWeight}
            />
            <NumberPadTextInput
              style={[styles.input, styles.col]}
              placeholder="Reps"
              placeholderTextColor="#888"
              keyboardType="number-pad"
              value={reps}
              onChangeText={setReps}
            />
          </View>

          <View style={styles.rowWrap}>
            <ToggleRow values={["lb", "kg"] as const} selected={weightUnit} onSelect={onWeightUnitChange} />
          </View>

          <View style={styles.rowWrap}>
            <ToggleRow values={["warmup", "working", "drop", "failure"] as const} selected={setTag} onSelect={setSetTag} />
          </View>

          <View style={styles.rowWrap}>
            <Pressable style={styles.secondaryChip} onPress={copyLastSet}>
              <Text style={styles.secondaryChipText}>Copy last set</Text>
            </Pressable>
            <Pressable style={styles.secondaryChip} onPress={() => setShowMoreFields((prev) => !prev)}>
              <Text style={styles.secondaryChipText}>{showMoreFields ? "Hide more" : "More"}</Text>
            </Pressable>
          </View>

          {showMoreFields ? (
            <>
              <View style={styles.row}>
                <NumberPadTextInput
                  style={[styles.input, styles.col]}
                  placeholder="RPE (optional)"
                  placeholderTextColor="#888"
                  keyboardType="decimal-pad"
                  value={rpe}
                  onChangeText={setRpe}
                />
                <NumberPadTextInput
                  style={[styles.input, styles.col]}
                  placeholder="Rest sec"
                  placeholderTextColor="#888"
                  keyboardType="number-pad"
                  value={restSec}
                  onChangeText={setRestSec}
                />
              </View>
              <TextInput
                style={[styles.input, styles.note]}
                placeholder="Set notes (optional)"
                placeholderTextColor="#888"
                value={setNotes}
                onChangeText={setSetNotes}
                multiline
              />
            </>
          ) : null}

          <Pressable style={[styles.secondaryButton, (!canAddSet || saving) && styles.buttonDisabled]} onPress={upsertSet} disabled={!canAddSet || saving}>
            <Text style={styles.secondaryButtonText}>{editTarget ? "Update Set" : "Add Set"}</Text>
          </Pressable>

          <Text style={styles.label}>Current session</Text>
          {exercises.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No sets yet. Add one below.</Text>
            </View>
          ) : null}

          {exercises.map((exercise, exerciseIndex) => {
            const collapsed = collapsedExercises[exercise.name];
            return (
              <View key={`${exercise.name}-${exerciseIndex}`} style={styles.exerciseCard}>
                <View style={styles.exerciseHeader}>
                  <Pressable
                    style={styles.exerciseHeaderMain}
                    onPress={() =>
                      setCollapsedExercises((prev) => ({
                        ...prev,
                        [exercise.name]: !prev[exercise.name],
                      }))
                    }
                  >
                    <Text style={styles.exerciseTitle}>{exercise.name}</Text>
                    <Text style={styles.exerciseCount}>{exercise.sets.length} sets</Text>
                  </Pressable>
                  <View style={styles.exerciseHeaderRight}>
                    <Pressable
                      onPress={exerciseIndex > 0 ? () => moveExercise(exerciseIndex, "up") : undefined}
                      style={[styles.reorderButton, exerciseIndex === 0 && styles.reorderDisabled]}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: exerciseIndex === 0 }}
                    >
                      <Text style={styles.reorderText}>↑</Text>
                    </Pressable>
                    <Pressable
                      onPress={exerciseIndex < exercises.length - 1 ? () => moveExercise(exerciseIndex, "down") : undefined}
                      style={[styles.reorderButton, exerciseIndex >= exercises.length - 1 && styles.reorderDisabled]}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: exerciseIndex >= exercises.length - 1 }}
                    >
                      <Text style={styles.reorderText}>↓</Text>
                    </Pressable>
                  </View>
                </View>
                {!collapsed
                  ? exercise.sets.map((set, setIndex) => (
                      <Swipeable
                        key={`${exercise.name}-${setIndex}`}
                        overshootLeft={false}
                        overshootRight={false}
                        renderLeftActions={() => (
                          <Pressable style={styles.swipeDup} onPress={() => onDuplicateSet(exerciseIndex, setIndex)}>
                            <Text style={styles.swipeText}>Duplicate</Text>
                          </Pressable>
                        )}
                        renderRightActions={() => (
                          <Pressable style={styles.swipeDelete} onPress={() => onDeleteSet(exerciseIndex, setIndex)}>
                            <Text style={styles.swipeText}>Delete</Text>
                          </Pressable>
                        )}
                      >
                        <View style={styles.setRow}>
                          <Pressable style={{ flex: 1 }} onPress={() => onEditSet(exerciseIndex, setIndex)}>
                            <Text style={styles.setText}>
                              #{set.setIndex} · {set.weight}{set.weightUnit} x {set.reps}
                              {typeof set.rpe === "number" ? ` @RPE ${set.rpe}` : ""}
                              {set.setType ? ` · ${set.setType}` : ""}
                            </Text>
                          </Pressable>
                          <View style={styles.adjustWrap}>
                            <Pressable
                              onPress={() => onDecrementReps(exerciseIndex, setIndex)}
                              style={[styles.adjustButton, Number(set.reps) <= 1 && styles.adjustDisabled]}
                              disabled={Number(set.reps) <= 1}
                            >
                              <Text style={styles.adjustText}>−</Text>
                            </Pressable>
                            <Text style={styles.adjustValue}>{set.reps}</Text>
                            <Pressable onPress={() => onIncrementReps(exerciseIndex, setIndex)} style={styles.adjustButton}>
                              <Text style={styles.adjustText}>+</Text>
                            </Pressable>
                          </View>
                          <Pressable
                            onPress={setIndex > 0 ? () => moveSet(exerciseIndex, setIndex, "up") : undefined}
                            style={[styles.reorderButton, setIndex === 0 && styles.reorderDisabled]}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: setIndex === 0 }}
                          >
                            <Text style={styles.reorderText}>↑</Text>
                          </Pressable>
                          <Pressable
                            onPress={setIndex < exercise.sets.length - 1 ? () => moveSet(exerciseIndex, setIndex, "down") : undefined}
                            style={[styles.reorderButton, setIndex >= exercise.sets.length - 1 && styles.reorderDisabled]}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: setIndex >= exercise.sets.length - 1 }}
                          >
                            <Text style={styles.reorderText}>↓</Text>
                          </Pressable>
                        </View>
                      </Swipeable>
                    ))
                  : null}
              </View>
            );
          })}

          {deletedSet ? (
            <View style={styles.undoCard}>
              <Text style={styles.undoText}>Set removed</Text>
              <Pressable onPress={undoDeleteSet}>
                <Text style={styles.undoAction}>Undo</Text>
              </Pressable>
            </View>
          ) : null}

          <TextInput
            style={[styles.input, styles.note]}
            placeholder="Session notes (optional)"
            placeholderTextColor="#888"
            value={sessionNote}
            onChangeText={setSessionNote}
            multiline
          />
      </ZenithScrollView>
      <View
        pointerEvents="box-none"
        style={[
          styles.ctaBar,
          {
            left: CTA_HPAD,
            right: CTA_HPAD,
            bottom: insets.bottom + CTA_BOTTOM_OFFSET,
            minHeight: CTA_BAR_MIN_HEIGHT,
          },
        ]}
      >
        <Pressable style={[styles.ctaButton, (!canFinalize || saving) && styles.buttonDisabled]} onPress={onFinalize} disabled={!canFinalize || saving}>
          <Text style={styles.buttonText}>{saving ? "SAVING..." : "DONE"}</Text>
        </Pressable>
      </View>

      <WinningDayToast visible={showToast} title={toastTitle} subtitle={toastSubtitle} onHide={() => setShowToast(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0A0A0A" },
  keyboard: { flex: 1 },
  container: { flexGrow: 1, padding: 18 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  hook: { color: "#9EC6D4", marginTop: -10, marginBottom: 12, fontWeight: "600" },
  back: { color: "#00D9FF", fontWeight: "700" },
  title: { color: "#FFF", fontSize: 22, fontWeight: "800" },
  label: { color: "#FFF", fontWeight: "700", marginBottom: 8, marginTop: 4 },
  sessionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#24343D",
    backgroundColor: "#10181D",
    padding: 10,
    marginBottom: 10,
  },
  sessionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sessionToggle: { color: "#8FCBE1", fontWeight: "700", fontSize: 12 },

  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  row: { flexDirection: "row", gap: 8, marginBottom: 6 },
  col: { flex: 1 },

  pill: {
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#252525",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pillOn: { borderColor: "#00D9FF", backgroundColor: "rgba(0,217,255,0.18)" },
  pillText: { color: "#AAA", fontWeight: "700" },
  pillTextOn: { color: "#E6FAFF" },

  quickChip: {
    backgroundColor: "rgba(0,217,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(0,217,255,0.45)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  quickChipActive: { borderColor: "#00D9FF", backgroundColor: "rgba(0,217,255,0.30)" },
  quickChipText: { color: "#DDF6FF", fontWeight: "700", fontSize: 12 },
  recentChip: {
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#2A2A2A",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  recentChipText: { color: "#DDD", fontWeight: "700", fontSize: 12 },
  secondaryChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2D3A40",
    backgroundColor: "#131E22",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  secondaryChipText: { color: "#BFE6F3", fontWeight: "700", fontSize: 12 },

  summaryStrip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#24343D",
    backgroundColor: "#10181D",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  summaryText: { color: "#AED5E4", fontSize: 12, fontWeight: "700" },
  impactCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1F3A2E",
    backgroundColor: "#0E1A14",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  impactTitle: { color: "#D3FFE7", fontSize: 12, fontWeight: "800", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  impactLine: { color: "#B6EED0", fontSize: 12, fontWeight: "600", marginBottom: 2 },
  intensityHelp: { color: "#9AB7C2", marginTop: -4, marginBottom: 12, fontSize: 12, fontWeight: "600" },

  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#253238",
    backgroundColor: "#12181B",
    padding: 12,
    marginBottom: 12,
  },
  emptyText: { color: "#A9B6BD", fontWeight: "600" },
  exerciseCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#232323",
    backgroundColor: "#121212",
    marginBottom: 10,
  },
  exerciseHeader: { paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", justifyContent: "space-between", gap: 10 },
  exerciseHeaderMain: { flex: 1 },
  exerciseHeaderRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  exerciseTitle: { color: "#FFF", fontWeight: "800" },
  exerciseCount: { color: "#95B8C4", fontWeight: "700", fontSize: 12 },
  setRow: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  setText: { color: "#D9F3FC", fontWeight: "700", fontSize: 12 },
  swipeDup: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#13331F",
    borderRadius: 10,
    marginBottom: 8,
    paddingHorizontal: 14,
    minWidth: 86,
  },
  swipeDelete: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#3A1717",
    borderRadius: 10,
    marginBottom: 8,
    paddingHorizontal: 14,
    minWidth: 86,
  },
  swipeText: { color: "#EAF8FF", fontSize: 11, fontWeight: "800" },
  reorderButton: {
    borderWidth: 1,
    borderColor: "#2E3C44",
    borderRadius: 6,
    backgroundColor: "#172126",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  reorderText: { color: "#CBEAF5", fontWeight: "900", fontSize: 11 },
  reorderDisabled: { opacity: 0.35 },

  adjustWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  adjustButton: {
    width: 28,
    height: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(0,217,255,0.25)",
    backgroundColor: "rgba(0,217,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  adjustDisabled: { opacity: 0.35 },
  adjustText: { color: "#E6FAFF", fontWeight: "900", fontSize: 16, marginTop: -1 },
  adjustValue: { color: "#E6FAFF", fontWeight: "900", width: 22, textAlign: "center", fontSize: 12 },
  deleteText: { color: "#FF9A9A", fontWeight: "800", fontSize: 12 },
  undoCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#4B3B2A",
    backgroundColor: "#231B12",
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  undoText: { color: "#F7D9A7", fontWeight: "700" },
  undoAction: { color: "#FFD179", fontWeight: "900" },
  hintText: { color: "#8FBFD1", fontWeight: "700", marginBottom: 10, marginTop: -4, fontSize: 12 },

  input: {
    backgroundColor: "#151515",
    color: "#FFF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#232323",
  },
  note: { minHeight: 72, textAlignVertical: "top" },

  secondaryButton: {
    marginTop: 4,
    marginBottom: 10,
    backgroundColor: "#1A2428",
    borderColor: "#2D3A40",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#D4F2FD", fontWeight: "900", fontSize: 14 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#00131A", fontWeight: "900", fontSize: 15 },
  ctaBar: {
    position: "absolute",
    borderRadius: 22,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(9,9,9,0.98)",
  },
  ctaButton: {
    backgroundColor: "#00D9FF",
    height: CTA_BUTTON_HEIGHT,
    borderRadius: CTA_BUTTON_RADIUS,
    alignItems: "center",
    justifyContent: "center",
  },
});
