import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import WinningDayToast from "../../components/WinningDayToast";
import NumberPadTextInput from "../../components/inputs/NumberPadTextInput";
import ZenithScrollView from "../../components/layout/ZenithScrollView";
import ModalHeader from "../../components/ui/ModalHeader";
import type { CanonicalFoodItem, FoodUsageStatsRow } from "../../utils/foodSearchService";
import {
  addFoodToDailyLog,
  classifyFoodTier,
  computeMacrosForCanonical,
  convertSelectionToCanonical,
  filterFoodsForQuery,
  getCommonFoodsQuickAdd,
  getCommonFoodsForQuery,
  getCachedSearchFoods,
  getFoodFavorites,
  getFoodRecents,
  getFoodResultTags,
  getFoodUnitSelection,
  getFoodUsageStats,
  isServingFirstFoodItem,
  lookupFoodBarcode,
  parseFoodPhrase,
  normalizeUnitKeyFromLabel,
  prewarmFoodSearchCache,
  previewEquivalents,
  rankLocalFoodsForQuery,
  searchFoods,
  toggleFavoriteFood,
} from "../../utils/foodSearchService";
import { checkMacroCalories } from "../../utils/nutritionIntegrity";
import { collapseIdenticalFoodEntries, foodEntryIdentityKey, foodEntryPortionLabel, foodEntryQuantity } from "../../utils/foodLogGrouping";
import type { FoodEntry } from "../../utils/storageUtils";
import {
  getDailyLog,
  getUserProfile,
  saveDailyLog,
  setStorageItem,
  todayKey,
  USER_PROFILE_KEY,
} from "../../utils/storageUtils";
import { evaluateWinningDay, getWinningSnapshot } from "../../utils/winningSystem";

type MealType = "breakfast" | "lunch" | "dinner" | "snack";
type EntryMode = "search" | "manual";

const MEALS: { id: MealType; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snack", label: "Snack" },
];

const XP_PER_FOOD_LOG = 6;
const CTA_BAR_MIN_HEIGHT = 76;
const CTA_BUTTON_HEIGHT = 56;
const CTA_BUTTON_RADIUS = 18;
const CTA_HPAD = 16;
const CTA_BOTTOM_OFFSET = 10;

function clamp(n: number, low: number, high: number) {
  return Math.max(low, Math.min(high, n));
}

function formatEnergy(value: number) {
  return `${Math.round(value)} kcal`;
}

function formatQty(qty: number) {
  if (!Number.isFinite(qty) || qty <= 0) return "0";
  const rounded = Math.round(qty);
  if (Math.abs(qty - rounded) < 1e-6) return String(rounded);
  const s = qty.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function mealForDate(ts?: string): MealType {
  const d = ts ? new Date(ts) : new Date();
  const h = d.getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

function mealLabel(meal: MealType) {
  return MEALS.find((row) => row.id === meal)?.label || "Meal";
}

function dedupeFoods(rows: CanonicalFoodItem[]) {
  const map = new Map<string, CanonicalFoodItem>();
  rows.forEach((item) => map.set(item.id, item));
  return Array.from(map.values());
}

export default function FoodModal() {
  const params = useLocalSearchParams<{ barcode?: string }>();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<EntryMode>("search");
  const [meal, setMeal] = useState<MealType>(mealForDate());
  const [sessionSetupCollapsed, setSessionSetupCollapsed] = useState(true);
  const [notesCollapsed, setNotesCollapsed] = useState(true);
  const [showSummaryBar, setShowSummaryBar] = useState(false);
  const [unitsPref, setUnitsPref] = useState<"lb-oz" | "kg-ml">("lb-oz");

  const [todayEntries, setTodayEntries] = useState<FoodEntry[]>([]);
  const [todayCalories, setTodayCalories] = useState(0);
  const [todayProtein, setTodayProtein] = useState(0);
  const [goalsCalories, setGoalsCalories] = useState<number | undefined>(undefined);
  const [goalsProtein, setGoalsProtein] = useState<number | undefined>(undefined);

  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  // Default to a non-empty local-first suggestion pool so the UI never appears "blank" before effects run.
  const [searchResults, setSearchResults] = useState<CanonicalFoodItem[]>(() => getCommonFoodsQuickAdd().slice(0, 25));
  const [searchFocused, setSearchFocused] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [recents, setRecents] = useState<CanonicalFoodItem[]>([]);
  const [favorites, setFavorites] = useState<CanonicalFoodItem[]>([]);
  const [usageStats, setUsageStats] = useState<Record<string, FoodUsageStatsRow>>({});
  const [selectedFood, setSelectedFood] = useState<CanonicalFoodItem | null>(null);
  const [portionOpen, setPortionOpen] = useState(false);
  const [selectedUnitKey, setSelectedUnitKey] = useState<string>("serving:100g");
  const [amount, setAmount] = useState("1");
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [showNutrientDetails, setShowNutrientDetails] = useState(false);

  const [manualCalories, setManualCalories] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");
  const [manualPortionLabel, setManualPortionLabel] = useState("serving");
  const [manualQuantity, setManualQuantity] = useState("1");

  const [note, setNote] = useState("");
  const [deletedEntries, setDeletedEntries] = useState<FoodEntry[] | null>(null);
  const [qtyEditorOpen, setQtyEditorOpen] = useState(false);
  const [qtyEditorMeal, setQtyEditorMeal] = useState<MealType>("breakfast");
  const [qtyEditorIdentityKey, setQtyEditorIdentityKey] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastTitle, setToastTitle] = useState("Logged");
  const [toastSubtitle, setToastSubtitle] = useState<string | undefined>(undefined);

  const searchRequestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  const [regionCountry, setRegionCountry] = useState("US");
  const [regionAdmin, setRegionAdmin] = useState<string | undefined>(undefined);
  const locale = useMemo(() => {
    const resolved = Intl.DateTimeFormat?.().resolvedOptions?.().locale || "en-US";
    const language = String(resolved.split("-")[0] || "en").toLowerCase();
    const admin = String(regionAdmin || "").trim() || undefined;
    return { language, country: regionCountry, admin };
  }, [regionCountry, regionAdmin]);

  const loadContext = async () => {
    const [log, profile, recentFoods, favoriteFoods, usage] = await Promise.all([
      getDailyLog(todayKey()),
      getUserProfile(),
      getFoodRecents(),
      getFoodFavorites(),
      getFoodUsageStats(),
    ]);

    const entries = (Array.isArray(log.foodEntries) ? log.foodEntries : []) as FoodEntry[];
    setTodayEntries(entries);
    setTodayCalories(Number(log.calories) || 0);
    setTodayProtein(Number(log.macros?.protein) || 0);

    setGoalsCalories(Number((profile as any)?.goals?.caloriesTarget) || undefined);
    setGoalsProtein(Number((profile as any)?.goals?.proteinTarget) || undefined);
    setUnitsPref((profile as any)?.preferences?.units === "kg-ml" ? "kg-ml" : "lb-oz");
    const prefCountry = String((profile as any)?.preferences?.foodRegionCountry || "").trim();
    const prefAdmin = String((profile as any)?.preferences?.foodRegionAdmin || "").trim();
    if (prefCountry) {
      setRegionCountry(prefCountry.toUpperCase());
    } else {
      const resolved = Intl.DateTimeFormat?.().resolvedOptions?.().locale || "en-US";
      const inferred = String(resolved.split("-")[1] || "US").toUpperCase();
      setRegionCountry(inferred);
    }
    setRegionAdmin(prefAdmin ? prefAdmin.toUpperCase() : undefined);
    const rememberedMeal = (profile as any)?.uiPrefs?.lastFoodMeal as MealType | undefined;
    if (rememberedMeal && MEALS.some((row) => row.id === rememberedMeal)) {
      setMeal(rememberedMeal);
    }

    setRecents(recentFoods);
    setFavorites(favoriteFoods);
    setUsageStats(usage);
  };

  useEffect(() => {
    void loadContext();
    void prewarmFoodSearchCache(locale);
  }, [locale]);

  useEffect(() => {
    const barcode = (params.barcode || "").trim();
    if (!barcode) return;
    let alive = true;

    const lookup = async () => {
      setSearching(true);
      const found = await lookupFoodBarcode(barcode);
      if (!alive) return;
      if (found) {
        setSelectedFood(found);
        const sel = getFoodUnitSelection(found, unitsPref);
        setSelectedUnitKey(sel.defaultUnitKey);
        setAmount(sel.kind === "drink" ? (unitsPref === "kg-ml" ? "250" : "8") : "1");
        setPortionOpen(true);
        setToastTitle("Barcode ready");
        setToastSubtitle("Set portion and add to meal.");
      } else {
        setToastTitle("Barcode not found");
        setToastSubtitle("Try search or manual mode.");
      }
      setShowToast(true);
      setSearching(false);
    };

    void lookup();
    return () => {
      alive = false;
    };
  }, [params.barcode, unitsPref]);

  const rankedDiscover = useMemo(() => {
    const popular = dedupeFoods([
      ...getCachedSearchFoods("chicken", locale).slice(0, 5),
      ...getCachedSearchFoods("rice", locale).slice(0, 5),
    ]);

    const pool = dedupeFoods([...recents, ...favorites, ...popular]);
    const scored = pool
      .map((item, idx) => {
        const usage = usageStats[item.id];
        const timesUsed = usage?.timesUsed || 0;
        const ageHours = usage ? Math.max(0, (Date.now() - new Date(usage.lastUsedAt).getTime()) / (1000 * 60 * 60)) : 1e9;
        const recentBoost = Math.max(0, 50 - idx);
        const frequentBoost = Math.min(timesUsed * 120, 720);
        const usageRecencyBoost = usage ? clamp(72 - ageHours, 0, 72) : 0;
        const favoriteBoost = favorites.some((row) => row.id === item.id) ? 70 : 0;
        const tierBoost = classifyFoodTier(item) === "ESSENTIAL" ? 45 : classifyFoodTier(item) === "STAPLE" ? 18 : 4;
        return { item, score: frequentBoost + usageRecencyBoost + favoriteBoost + recentBoost + tierBoost };
      })
      .sort((a, b) => b.score - a.score)
      .map((row) => row.item);

    return scored;
  }, [favorites, locale, recents, usageStats]);

  // Results should remain visible even after dismissing the keyboard (users often want to browse without
  // the keyboard covering the list). The close button is the explicit way to exit.
  const showSearchResults = !resultsCollapsed && (resultsOpen || searching || Boolean(searchQuery.trim()));

  useEffect(() => {
    const q = searchQuery.trim();
    const requestId = ++searchRequestRef.current;

    abortRef.current?.abort();
    abortRef.current = null;

    if (!q) {
      // Never show an empty state just because the persistent search cache isn't warm yet.
      // Default to a "discover" pool that is always populated (common + your usage where available).
      const discover = dedupeFoods([
        ...getCommonFoodsQuickAdd({ usage: usageStats }).slice(0, 24),
        ...rankedDiscover,
      ]).slice(0, 30);
      setSearchResults(discover);
      setSearching(false);
      return;
    }

    if (q.length < 2) {
      setSearchResults(getCommonFoodsQuickAdd({ usage: usageStats }).slice(0, 25));
      setSearching(false);
      return;
    }

    const common = filterFoodsForQuery(getCommonFoodsForQuery(q), q);
    const cachedFoods = filterFoodsForQuery(getCachedSearchFoods(q, locale), q);
    const localPool = dedupeFoods([...common, ...rankedDiscover, ...cachedFoods]);
    const immediate = rankLocalFoodsForQuery(localPool, q, usageStats, { limit: 25 });
    setSearchResults(immediate);
    setSearching(immediate.length === 0);

    const timer = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const remote = filterFoodsForQuery(await searchFoods(q, locale, { signal: controller.signal }), q);
        if (requestId !== searchRequestRef.current) return;
        const mergedPool = dedupeFoods([...remote, ...common, ...rankedDiscover, ...cachedFoods]);
        const merged = rankLocalFoodsForQuery(mergedPool, q, usageStats, { limit: 30 });
        setSearchResults(merged);
      } finally {
        if (requestId === searchRequestRef.current) {
          setSearching(false);
        }
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [locale, rankedDiscover, searchQuery, usageStats]);

  const parsedPhrase = useMemo(() => parseFoodPhrase(searchQuery), [searchQuery]);
  const multiLogPlan = useMemo(() => {
    if (!parsedPhrase || parsedPhrase.length < 2) return null;
    if (searchQuery.trim().length < 4) return null;

    const plan = parsedPhrase.slice(0, 4).map((part) => {
      const pool = dedupeFoods([
        ...filterFoodsForQuery(getCommonFoodsForQuery(part.query), part.query),
        ...rankedDiscover,
        ...filterFoodsForQuery(getCachedSearchFoods(part.query, locale), part.query),
      ]);
      const best = rankLocalFoodsForQuery(pool, part.query, usageStats, { limit: 3 })[0] || null;
      if (!best) return { part, item: null as CanonicalFoodItem | null, servingLabel: "", quantity: 0 };

      const selection = getFoodUnitSelection(best, unitsPref);
      const defaultServingLabel = selection.defaultUnitKey.startsWith("serving:")
        ? selection.defaultUnitKey.slice("serving:".length)
        : selection.defaultUnitKey;

      const qtyDefault = selection.kind === "drink" ? (unitsPref === "kg-ml" ? 250 : 8) : 1;
      let servingLabel = defaultServingLabel;
      let quantity = Math.max(0, Number(part.quantity ?? qtyDefault) || qtyDefault);

      const unitHint = String(part.unitHint || "").toLowerCase();
      if (unitHint) {
        if (unitHint === "g" || unitHint === "gram" || unitHint === "grams") {
          servingLabel = "g";
        } else if (unitHint === "kg") {
          servingLabel = "g";
          quantity = quantity * 1000;
        } else if (unitHint === "ml") {
          servingLabel = "ml";
        } else if (unitHint === "l") {
          servingLabel = "L";
        } else if (unitHint === "oz") {
          servingLabel = "oz";
        } else if (unitHint === "lb") {
          servingLabel = "lb";
        } else if (unitHint === "cup" || unitHint === "cups") {
          servingLabel = "cup";
        } else if (unitHint === "tbsp") {
          servingLabel = "tbsp";
        } else if (unitHint === "tsp") {
          servingLabel = "tsp";
        }
      }

      if (quantity > 2500) quantity = qtyDefault;
      return { part, item: best, servingLabel, quantity };
    });

    const ready = plan.every((row) => row.item && row.quantity > 0 && row.servingLabel);
    return { ready, plan };
  }, [locale, parsedPhrase, rankedDiscover, searchQuery, unitsPref, usageStats]);

  const selectedPreview = useMemo(() => {
    if (!selectedFood) return null;
    const amt = Math.max(0, Number(amount) || 0);
    const canonical = convertSelectionToCanonical(selectedFood, selectedUnitKey as any, amt);
    if (!canonical) return null;
    const macros = computeMacrosForCanonical(selectedFood, { unit: canonical.unit, amount: canonical.amount });
    const eq = previewEquivalents(selectedFood, { unit: canonical.unit, amount: canonical.amount }, unitsPref);
    return { ...macros, canonical, eq };
  }, [selectedFood, selectedUnitKey, amount, unitsPref]);
  const selectedUnitOption = useMemo(() => {
    if (!selectedFood) return null;
    const selection = getFoodUnitSelection(selectedFood, unitsPref);
    return selection.options.find((opt) => opt.key === (selectedUnitKey as any)) || null;
  }, [selectedFood, unitsPref, selectedUnitKey]);
  const numericAmount = Math.max(0, Number(amount) || 0);
  const amountWarning = numericAmount > 2500 ? "Large amount detected. Double-check before adding." : null;
  const portionNudge = useMemo(() => {
    if (!selectedFood) return null;
    if (!isServingFirstFoodItem(selectedFood)) return null;
    const qty = Math.max(0, Number(amount) || 0);
    if (qty <= 0) return null;

    const selectedUnit = String(selectedUnitKey || "");
    const selection = getFoodUnitSelection(selectedFood, unitsPref);
    const suggestedUnitKey = selection.options.find((opt) => String(opt.key).startsWith("serving:"))?.key || selection.defaultUnitKey;
    const suggestedLabel = String(suggestedUnitKey).startsWith("serving:") ? String(suggestedUnitKey).slice("serving:".length) : String(suggestedUnitKey);
    const suggestedAmountLabel = suggestedLabel.trim().toLowerCase().startsWith("1 ")
      ? suggestedLabel
      : `1 ${suggestedLabel}`;

    const computedCalories = selectedPreview?.calories ?? null;
    const tinyGrams = selectedUnit === "g" && qty < 10;
    const suspiciousLowCalories = typeof computedCalories === "number" && computedCalories > 0 && computedCalories < 25;

    if (!tinyGrams && !suspiciousLowCalories) return null;

    return {
      message: `This looks low for ${selectedFood.name}. Switch to ${suggestedLabel} for normal portions.`,
      actionLabel: `Switch to ${suggestedAmountLabel}`,
      onApply: () => {
        setSelectedUnitKey(suggestedUnitKey as any);
        setAmount("1");
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      },
    };
  }, [amount, selectedFood, selectedPreview?.calories, selectedUnitKey, unitsPref]);
  const selectedMacroCheck = useMemo(() => {
    if (!selectedPreview) return null;
    return checkMacroCalories({
      calories: selectedPreview.calories,
      protein: selectedPreview.protein,
      carbs: selectedPreview.carbs,
      fat: selectedPreview.fat,
    });
  }, [selectedPreview]);

  const manualPreview = useMemo(() => {
    const qty = Math.max(0, Number(manualQuantity) || 0);
    return {
      calories: Math.max(0, Number(manualCalories) || 0) * qty,
      protein: Math.max(0, Number(manualProtein) || 0) * qty,
      carbs: Math.max(0, Number(manualCarbs) || 0) * qty,
      fat: Math.max(0, Number(manualFat) || 0) * qty,
      qty,
    };
  }, [manualCalories, manualProtein, manualCarbs, manualFat, manualQuantity]);
  const manualMacroCheck = useMemo(() => {
    if (!manualPreview) return null;
    return checkMacroCalories({
      calories: manualPreview.calories,
      protein: manualPreview.protein,
      carbs: manualPreview.carbs,
      fat: manualPreview.fat,
    });
  }, [manualPreview]);

  const projected = selectedPreview || manualPreview;
  const projectedCalories = Math.max(0, Number((projected as any)?.calories) || 0);
  const projectedProtein = Math.max(0, Number((projected as any)?.protein) || 0);
  const projectedCarbs = Math.max(0, Number((projected as any)?.carbs) || 0);
  const projectedFat = Math.max(0, Number((projected as any)?.fat) || 0);
  const showImpactPreview = projectedCalories > 0 || projectedProtein > 0 || projectedCarbs > 0 || projectedFat > 0;

  const projectedLog = useMemo(() => {
    return {
      calories: todayCalories + (projected?.calories || 0),
      protein: todayProtein + (projected?.protein || 0),
    };
  }, [todayCalories, todayProtein, projected]);

  const winningPreview = useMemo(() => {
    const before = evaluateWinningDay(
      { calories: todayCalories, foodEntries: todayEntries },
      { activeRestTargetMin: 20, caloriesTarget: goalsCalories }
    );
    const after = evaluateWinningDay(
      { calories: projectedLog.calories, foodEntries: todayEntries },
      { activeRestTargetMin: 20, caloriesTarget: goalsCalories }
    );
    return { before: before.winningDay, after: after.winningDay };
  }, [todayCalories, todayEntries, goalsCalories, projectedLog.calories]);

  const mealGroups = useMemo(() => {
    const buckets: Record<MealType, FoodEntry[]> = { breakfast: [], lunch: [], dinner: [], snack: [] };
    todayEntries.forEach((entry) => {
      const key = entry.meal || mealForDate(entry.ts);
      buckets[key].push(entry);
    });
    return {
      breakfast: collapseIdenticalFoodEntries(buckets.breakfast),
      lunch: collapseIdenticalFoodEntries(buckets.lunch),
      dinner: collapseIdenticalFoodEntries(buckets.dinner),
      snack: collapseIdenticalFoodEntries(buckets.snack),
    };
  }, [todayEntries]);
  const currentMealRows = mealGroups[meal] || [];
  const currentMealTotalKcal = currentMealRows.reduce((sum, row) => sum + (Number((row as any)?.entry?.calories) || 0), 0);

  const qtyEditorRow = useMemo(() => {
    if (!qtyEditorIdentityKey) return null;
    const rows = mealGroups[qtyEditorMeal] || [];
    return rows.find((row) => row.identityKey === qtyEditorIdentityKey) || null;
  }, [mealGroups, qtyEditorIdentityKey, qtyEditorMeal]);

  useEffect(() => {
    if (!qtyEditorOpen) return;
    if (qtyEditorIdentityKey && !qtyEditorRow) {
      setQtyEditorOpen(false);
    }
  }, [qtyEditorIdentityKey, qtyEditorOpen, qtyEditorRow]);

  const hasDraft =
    !!searchQuery.trim() ||
    !!note.trim() ||
    !!manualCalories.trim() ||
    !!manualProtein.trim() ||
    !!manualCarbs.trim() ||
    !!manualFat.trim() ||
    portionOpen;

  const persistMealPreference = async (nextMeal: MealType) => {
    const profile = await getUserProfile();
    await setStorageItem(USER_PROFILE_KEY, {
      ...profile,
      uiPrefs: {
        ...((profile as any)?.uiPrefs || {}),
        lastFoodMeal: nextMeal,
      },
    });
  };

  const showRewardToast = (subtitle: string) => {
    setToastTitle("Logged");
    setToastSubtitle(subtitle);
    setShowToast(true);
  };

  const refreshToday = async () => {
    const [log, latestRecents, latestUsage] = await Promise.all([
      getDailyLog(todayKey()),
      getFoodRecents(),
      getFoodUsageStats(),
    ]);
    const entries = (Array.isArray(log.foodEntries) ? log.foodEntries : []) as FoodEntry[];
    setTodayEntries(entries);
    setTodayCalories(Number(log.calories) || 0);
    setTodayProtein(Number(log.macros?.protein) || 0);
    setRecents(latestRecents);
    setUsageStats(latestUsage);
  };

  const onQuickAdd = async (item: CanonicalFoodItem) => {
    if (saving) return;
    setSaving(true);
    try {
      const beforeSnapshot = await getWinningSnapshot();

      const usage = usageStats[item.id];
      const selection = getFoodUnitSelection(item, unitsPref);
      const defaultKey = selection.defaultUnitKey;
      const defaultLabel = defaultKey.startsWith("serving:") ? defaultKey.slice("serving:".length) : defaultKey;
      const lastKey = usage?.lastServingLabel ? normalizeUnitKeyFromLabel(item, usage.lastServingLabel) : null;
      const servingFirst = isServingFirstFoodItem(item);
      const honorLastKey = lastKey
        ? selection.options.some((opt) => opt.key === (lastKey as any)) &&
          (!servingFirst || String(lastKey).startsWith("serving:"))
        : false;
      const servingLabel = honorLastKey
        ? (String(lastKey).startsWith("serving:") ? String(lastKey).slice("serving:".length) : String(lastKey))
        : defaultLabel;

      const qtyCandidate = Math.max(
        0,
        Number(
          (honorLastKey ? usage?.lastQuantity : undefined) ??
            (selection.kind === "drink" ? (unitsPref === "kg-ml" ? 250 : 8) : 1)
        ) || 1
      );
      const qty = qtyCandidate > 2500 ? 1 : qtyCandidate;

      await addFoodToDailyLog({
        item,
        servingLabel,
        quantity: qty,
        meal,
        note: note.trim() || undefined,
      });
      await refreshToday();
      const afterSnapshot = await getWinningSnapshot();

      setShowSummaryBar(true);
      setSessionSetupCollapsed(true);
      setNote("");

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showRewardToast(
        `${item.name} · +${XP_PER_FOOD_LOG} XP · Streak ${beforeSnapshot.currentStreak}->${afterSnapshot.currentStreak} · Winning ${afterSnapshot.today.winningDay ? "YES" : "NO"}`
      );
    } finally {
      setSaving(false);
    }
  };

  const onLogMultiPhrase = async () => {
    if (!multiLogPlan?.ready || saving) return;
    setSaving(true);
    try {
      const beforeSnapshot = await getWinningSnapshot();
      for (const row of multiLogPlan.plan) {
        if (!row.item) continue;
        await addFoodToDailyLog({
          item: row.item,
          servingLabel: row.servingLabel,
          quantity: row.quantity,
          meal,
          note: note.trim() || undefined,
        });
      }
      await refreshToday();
      const afterSnapshot = await getWinningSnapshot();
      setShowSummaryBar(true);
      setSessionSetupCollapsed(true);
      setSearchQuery("");
      setNote("");

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showRewardToast(
        `Logged ${multiLogPlan.plan.length} items · +${XP_PER_FOOD_LOG * multiLogPlan.plan.length} XP · Streak ${beforeSnapshot.currentStreak}->${afterSnapshot.currentStreak}`
      );
    } finally {
      setSaving(false);
    }
  };

  const onAddSelectedFood = async () => {
    if (!selectedFood || !selectedPreview || saving) return;
    const qty = Math.max(0, Number(amount) || 0);
    if (qty <= 0) return;

    setSaving(true);
    try {
      const beforeSnapshot = await getWinningSnapshot();
      const servingLabel = String(selectedUnitKey).startsWith("serving:") ? String(selectedUnitKey).slice("serving:".length) : String(selectedUnitKey);
      await addFoodToDailyLog({
        item: selectedFood,
        servingLabel,
        quantity: qty,
        meal,
        note: note.trim() || undefined,
      });
      await refreshToday();
      const afterSnapshot = await getWinningSnapshot();

      setShowSummaryBar(true);
      setSessionSetupCollapsed(true);
      setPortionOpen(false);
      setSearchQuery("");
      setSelectedFood(null);
      setAmount("1");
      setNote("");

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showRewardToast(
        `+${XP_PER_FOOD_LOG} XP · Streak ${beforeSnapshot.currentStreak}->${afterSnapshot.currentStreak} · Winning ${afterSnapshot.today.winningDay ? "YES" : "NO"}`
      );
    } finally {
      setSaving(false);
    }
  };

  const onAddManual = async () => {
    if (saving) return;
    const qty = Math.max(0, Number(manualQuantity) || 0);
    const kcal = Math.max(0, Number(manualCalories) || 0);
    if (qty <= 0 || kcal <= 0 || !manualPortionLabel.trim()) return;

    const entry: FoodEntry = {
      id: String(Date.now()),
      ts: new Date().toISOString(),
      meal,
      calories: Math.round(kcal * qty),
      protein: Math.round((Number(manualProtein) || 0) * qty),
      carbs: Math.round((Number(manualCarbs) || 0) * qty),
      fat: Math.round((Number(manualFat) || 0) * qty),
      label: `Manual (${manualPortionLabel.trim()})`,
      quantity: qty,
      servingLabel: manualPortionLabel.trim(),
      note: note.trim() || undefined,
      source: "user",
    };

    setSaving(true);
    try {
      const beforeSnapshot = await getWinningSnapshot();
      const date = todayKey();
      const current = await getDailyLog(date);
      const all = (Array.isArray(current.foodEntries) ? current.foodEntries : []) as FoodEntry[];
      const mealKey = entry.meal || mealForDate(entry.ts);
      const newKey = foodEntryIdentityKey(entry);
      const existing = all.find((row) => {
        const rowMeal = row.meal || mealForDate(row.ts);
        if (rowMeal !== mealKey) return false;
        return foodEntryIdentityKey(row) === newKey;
      });

      const nextEntries = existing
        ? all.map((row) => {
            if (row.id !== existing.id) return row;
            const prevQty = foodEntryQuantity(row);
            const addQty = foodEntryQuantity(entry);
            const nextQty = prevQty + addQty;
            return {
              ...row,
              calories: (Number(row.calories) || 0) + entry.calories,
              protein: (Number(row.protein) || 0) + entry.protein,
              carbs: (Number(row.carbs) || 0) + entry.carbs,
              fat: (Number(row.fat) || 0) + entry.fat,
              quantity: nextQty,
              amount: nextQty,
            };
          })
        : [entry, ...all];

      await saveDailyLog(date, {
        ...current,
        calories: (Number(current.calories) || 0) + entry.calories,
        macros: {
          protein: (Number(current.macros?.protein) || 0) + entry.protein,
          carbs: (Number(current.macros?.carbs) || 0) + entry.carbs,
          fat: (Number(current.macros?.fat) || 0) + entry.fat,
        },
        foodEntries: nextEntries,
      });
      await refreshToday();
      const afterSnapshot = await getWinningSnapshot();

      setShowSummaryBar(true);
      setSessionSetupCollapsed(true);
      setManualCalories("");
      setManualProtein("");
      setManualCarbs("");
      setManualFat("");
      setManualQuantity("1");
      setNote("");

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showRewardToast(
        `+${XP_PER_FOOD_LOG} XP · Streak ${beforeSnapshot.currentStreak}->${afterSnapshot.currentStreak} · Winning ${afterSnapshot.today.winningDay ? "YES" : "NO"}`
      );
    } finally {
      setSaving(false);
    }
  };

  const applyUnitDelta = async (identityKey: string, mealKey: MealType, delta: 1 | -1) => {
    const date = todayKey();
    const current = await getDailyLog(date);
    const all = (Array.isArray(current.foodEntries) ? current.foodEntries : []) as FoodEntry[];
    const matching = all
      .filter((row) => {
        const rowMeal = row.meal || mealForDate(row.ts);
        if (rowMeal !== mealKey) return false;
        return foodEntryIdentityKey(row) === identityKey;
      })
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    if (!matching.length) return;

    const pick = delta === 1 ? matching[0] : matching.find((row) => foodEntryQuantity(row) > 1) || matching[0];
    const pickQty = foodEntryQuantity(pick);
    const unitCalories = (Number(pick.calories) || 0) / pickQty;
    const unitProtein = (Number(pick.protein) || 0) / pickQty;
    const unitCarbs = (Number(pick.carbs) || 0) / pickQty;
    const unitFat = (Number(pick.fat) || 0) / pickQty;
    const unitCanonical =
      typeof pick.canonicalAmount === "number" && pickQty > 0 ? (pick.canonicalAmount || 0) / pickQty : undefined;

    if (delta === -1 && pickQty <= 1) {
      const nextEntries = all.filter((row) => row.id !== pick.id);
      await saveDailyLog(date, {
        ...current,
        calories: Math.max(0, (Number(current.calories) || 0) - (Number(pick.calories) || 0)),
        macros: {
          protein: Math.max(0, (Number(current.macros?.protein) || 0) - (Number(pick.protein) || 0)),
          carbs: Math.max(0, (Number(current.macros?.carbs) || 0) - (Number(pick.carbs) || 0)),
          fat: Math.max(0, (Number(current.macros?.fat) || 0) - (Number(pick.fat) || 0)),
        },
        foodEntries: nextEntries,
      });
      await refreshToday();
      return;
    }

    const nextQty = pickQty + delta;
    const nextEntry: FoodEntry = {
      ...pick,
      calories: (Number(pick.calories) || 0) + unitCalories * delta,
      protein: (Number(pick.protein) || 0) + unitProtein * delta,
      carbs: (Number(pick.carbs) || 0) + unitCarbs * delta,
      fat: (Number(pick.fat) || 0) + unitFat * delta,
      quantity: nextQty,
      amount: nextQty,
      canonicalAmount:
        typeof unitCanonical === "number" && typeof pick.canonicalAmount === "number"
          ? (pick.canonicalAmount || 0) + unitCanonical * delta
          : pick.canonicalAmount,
    };
    const nextEntries = all.map((row) => (row.id === pick.id ? nextEntry : row));

    await saveDailyLog(date, {
      ...current,
      calories: Math.max(0, (Number(current.calories) || 0) + unitCalories * delta),
      macros: {
        protein: Math.max(0, (Number(current.macros?.protein) || 0) + unitProtein * delta),
        carbs: Math.max(0, (Number(current.macros?.carbs) || 0) + unitCarbs * delta),
        fat: Math.max(0, (Number(current.macros?.fat) || 0) + unitFat * delta),
      },
      foodEntries: nextEntries,
    });
    await refreshToday();
  };

  const onDuplicateGroup = async (identityKey: string, mealKey: MealType) => {
    await applyUnitDelta(identityKey, mealKey, 1);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setToastTitle("Added");
    setToastSubtitle(undefined);
    setShowToast(true);
  };

  const onDeleteGroup = async (identityKey: string, mealKey: MealType) => {
    const date = todayKey();
    const current = await getDailyLog(date);
    const all = (Array.isArray(current.foodEntries) ? current.foodEntries : []) as FoodEntry[];
    const matching = all.filter((row) => {
      const rowMeal = row.meal || mealForDate(row.ts);
      if (rowMeal !== mealKey) return false;
      return foodEntryIdentityKey(row) === identityKey;
    });
    const nextEntries = all.filter((row) => !matching.some((m) => m.id === row.id));
    const removedCalories = matching.reduce((sum, row) => sum + (Number(row.calories) || 0), 0);
    const removedProtein = matching.reduce((sum, row) => sum + (Number(row.protein) || 0), 0);
    const removedCarbs = matching.reduce((sum, row) => sum + (Number(row.carbs) || 0), 0);
    const removedFat = matching.reduce((sum, row) => sum + (Number(row.fat) || 0), 0);

    await saveDailyLog(date, {
      ...current,
      calories: Math.max(0, (Number(current.calories) || 0) - removedCalories),
      macros: {
        protein: Math.max(0, (Number(current.macros?.protein) || 0) - removedProtein),
        carbs: Math.max(0, (Number(current.macros?.carbs) || 0) - removedCarbs),
        fat: Math.max(0, (Number(current.macros?.fat) || 0) - removedFat),
      },
      foodEntries: nextEntries,
    });

    setDeletedEntries(matching);
    await refreshToday();
    setToastTitle("Removed");
    setToastSubtitle("Tap Undo to restore.");
    setShowToast(true);
  };

  const onUndoDelete = async () => {
    if (!deletedEntries || deletedEntries.length === 0) return;
    const date = todayKey();
    const current = await getDailyLog(date);
    const restored = deletedEntries;
    const addCalories = restored.reduce((sum, row) => sum + (Number(row.calories) || 0), 0);
    const addProtein = restored.reduce((sum, row) => sum + (Number(row.protein) || 0), 0);
    const addCarbs = restored.reduce((sum, row) => sum + (Number(row.carbs) || 0), 0);
    const addFat = restored.reduce((sum, row) => sum + (Number(row.fat) || 0), 0);
    await saveDailyLog(date, {
      ...current,
      calories: (Number(current.calories) || 0) + addCalories,
      macros: {
        protein: (Number(current.macros?.protein) || 0) + addProtein,
        carbs: (Number(current.macros?.carbs) || 0) + addCarbs,
        fat: (Number(current.macros?.fat) || 0) + addFat,
      },
      foodEntries: [...restored, ...(Array.isArray(current.foodEntries) ? current.foodEntries : [])],
    });
    setDeletedEntries(null);
    await refreshToday();
  };

  const onBack = () => {
    if (!hasDraft) {
      router.back();
      return;
    }
    Alert.alert("Discard changes?", "You have unsaved food input.", [
      { text: "Cancel", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  };

  const doneEnabled = !saving;
  const onDone = () => {
    if (!doneEnabled) return;
    Keyboard.dismiss();
    onBack();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={{ flex: 1 }}>
	            <ZenithScrollView
	              style={{ flex: 1 }}
	              contentContainerStyle={[
	                styles.container,
	                { paddingBottom: CTA_BAR_MIN_HEIGHT + insets.bottom + CTA_BOTTOM_OFFSET + 16 },
	              ]}
	              keyboardShouldPersistTaps="handled"
	              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
	            >
              <ModalHeader title="Log Food" onBack={onBack} rightLabel="Done" onRight={onDone} rightDisabled={!doneEnabled} />

          {mode === "search" ? (
            <>
              {!resultsOpen && !searchFocused && !searchQuery.trim() ? (
                <View style={styles.commonSection}>
                  <Text style={styles.commonTitle}>Common Foods</Text>
                  <View style={styles.commonGrid}>
                    {getCommonFoodsQuickAdd({ usage: usageStats })
                      .slice(0, 18)
                      .map((item) => (
                        <Pressable
                          key={`common-${item.id}`}
                          style={styles.commonChip}
                          onPress={() => {
                            setSelectedFood(item);
                            const sel = getFoodUnitSelection(item, unitsPref);
                            setSelectedUnitKey(sel.defaultUnitKey);
                            setAmount(sel.kind === "drink" ? (unitsPref === "kg-ml" ? "250" : "8") : "1");
                            setPortionOpen(true);
                          }}
                          disabled={saving}
                        >
                          <Text style={styles.commonChipText}>{item.name.replace(" (generic)", "")}</Text>
                        </Pressable>
                      ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Primary Entry</Text>
                <View style={styles.searchRow}>
                  <TextInput
                    style={[styles.input, styles.searchInput]}
                    placeholder="Search foods, brands, products..."
                    placeholderTextColor="#888"
                    value={searchQuery}
                    onChangeText={(text) => {
                      setSearchQuery(text);
                      setResultsOpen(true);
                      setResultsCollapsed(false);
                    }}
                    ref={searchInputRef}
                    onFocus={(e) => {
                      setSearchFocused(true);
                      setResultsOpen(true);
                      setResultsCollapsed(false);
                    }}
                    onBlur={(e) => {
                      setSearchFocused(false);
                    }}
                  />
                  <View style={styles.scanCluster}>
                    <Pressable style={styles.scanButton} onPress={() => router.push("/(modals)/food-scan" as any)}>
                      <Text style={styles.scanText}>Scan BC</Text>
                    </Pressable>
                    <Pressable style={styles.scanPhotoButton} onPress={() => router.push("/(modals)/food-photo-scan" as any)}>
                      <Text style={styles.scanPhotoText}>Scan Photo</Text>
                    </Pressable>
                  </View>
                  {resultsOpen || searchFocused || searchQuery.trim() ? (
                    <Pressable
                      style={styles.closeButton}
                      onPress={() => {
                        // Collapse results without leaving the modal.
                        setSearchQuery("");
                        setSearchFocused(false);
                        setResultsOpen(false);
                        setResultsCollapsed(true);
                        Keyboard.dismiss();
                        searchInputRef.current?.blur();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Close search results"
                    >
                      <Text style={styles.closeText}>×</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.searchHelperRow}>
                  <Text style={styles.searchHelperText}>
                    {searching && searchResults.length === 0
                      ? "Searching…"
                      : searchQuery.trim()
                        ? "Generic + your usual first. Tap + to quick log, tap a result to choose portion."
                        : "Frequent, recent, and essential foods are prioritized."}
                  </Text>
                  {resultsOpen || searchFocused || searchQuery.trim() ? (
                    <Pressable
                      style={styles.searchCollapseToggle}
                      onPress={() => setResultsCollapsed((prev) => !prev)}
                      accessibilityRole="button"
                      accessibilityLabel={resultsCollapsed ? "Show search results" : "Hide search results"}
                    >
                      <Text style={styles.searchCollapseToggleText}>{resultsCollapsed ? "Show" : "Hide"}</Text>
                    </Pressable>
                  ) : null}
                </View>

                {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 ? (
                  <Text style={styles.emptyText}>No matches. Try a different term.</Text>
                ) : null}

                {showSearchResults && multiLogPlan ? (
                  <View style={styles.multiCard}>
                    <Text style={styles.multiTitle}>Quick meal</Text>
                    {multiLogPlan.plan.map((row, idx) => (
                      <View key={`multi-${idx}`} style={styles.multiRow}>
                        <Text style={styles.multiQty}>
                          {row.part.quantity
                            ? (() => {
                                const label = String(row.servingLabel || "").trim();
                                const needsMultiply = /^\d/.test(label);
                                return needsMultiply
                                  ? `${formatQty(row.quantity)} × ${label}`
                                  : `${formatQty(row.quantity)} ${label}`;
                              })()
                            : "—"}
                        </Text>
                        <Text style={styles.multiFood} numberOfLines={1}>
                          {row.item ? row.item.name : `No match: ${row.part.query}`}
                        </Text>
                      </View>
                    ))}
                    <Pressable
                      style={[styles.multiButton, (!multiLogPlan.ready || saving) && styles.buttonDisabled]}
                      onPress={() => void onLogMultiPhrase()}
                      disabled={!multiLogPlan.ready || saving}
                    >
                      <Text style={styles.multiButtonText}>{multiLogPlan.ready ? "Log all" : "Refine phrase"}</Text>
                    </Pressable>
                    <Text style={styles.multiHint}>Example: “2 eggs and toast”. Works offline when foods are known locally.</Text>
                  </View>
                ) : null}

                {showSearchResults
                  ? searchResults.map((item) => {
	                  const usage = usageStats[item.id];
	                  const timesUsed = usage?.timesUsed || 0;
	                  const isUsual = timesUsed >= 3;
	                  const isFrequent = timesUsed >= 2;
	                  const isRecent = recents.some((row) => row.id === item.id);
	                  const tags = getFoodResultTags(item, { isUsual, isFrequent, isRecent }).slice(0, 3);
	                  const basis = item.nutritionBasis || (item.kind === "drink" ? "per100ml" : "per100g");
	                  const denom = basis === "per100ml" ? "100ml" : "100g";
	                  const kcalPer100 = Math.round(item.nutrientsPer100g.caloriesKcal || 0);
	                  const proteinPer100 = Math.round(item.nutrientsPer100g.proteinG || 0);
	                  const carbsPer100 = Math.round(item.nutrientsPer100g.carbsG || 0);
	                  const fatPer100 = Math.round(item.nutrientsPer100g.fatG || 0);
	                  const macroBits = [
	                    `P ${proteinPer100}g`,
	                    ...(carbsPer100 > 0 ? [`C ${carbsPer100}g`] : []),
	                    ...(fatPer100 > 0 ? [`F ${fatPer100}g`] : []),
	                  ];
	                  return (
	                    <View key={item.id} style={styles.resultRow}>
	                      <Pressable
	                        style={{ flex: 1 }}
	                        onPress={() => {
                          setSelectedFood(item);
                          const sel = getFoodUnitSelection(item, unitsPref);
                          setSelectedUnitKey(sel.defaultUnitKey);
                          setAmount(sel.kind === "drink" ? (unitsPref === "kg-ml" ? "250" : "8") : "1");
                          setPortionOpen(true);
                        }}
	                      >
	                        <Text style={styles.resultTitle}>{item.name}</Text>
	                        <Text style={styles.resultBrand}>{item.brand || "Generic"}</Text>
	                        <Text style={styles.resultSub}>
	                          {macroBits.join(" · ")} · {kcalPer100} kcal / {denom}
	                        </Text>
	                        <View style={styles.tagRow}>
	                          {tags.map((tag) => (
	                            <View key={`${item.id}-${tag}`} style={styles.resultTag}>
	                              <Text style={styles.resultTagText}>{tag}</Text>
                            </View>
                          ))}
                        </View>
                      </Pressable>
                      <Pressable
                        style={[styles.plusButton, saving && styles.buttonDisabled]}
                        onPress={() => void onQuickAdd(item)}
                        disabled={saving}
                      >
                        <Text style={styles.plusText}>+</Text>
                      </Pressable>
                    </View>
                  );
                })
                  : null}
              </View>
            </>
	          ) : (
	            <View style={styles.card}>
	              <Text style={styles.cardTitle}>Manual Entry</Text>
	              <View style={styles.row}>
	                <NumberPadTextInput
	                  style={[styles.input, styles.col]}
	                  placeholder="Calories"
	                  placeholderTextColor="#888"
	                  keyboardType="number-pad"
	                  value={manualCalories}
	                  onChangeText={setManualCalories}
	                />
	                <NumberPadTextInput
	                  style={[styles.input, styles.col]}
	                  placeholder="Protein"
	                  placeholderTextColor="#888"
	                  keyboardType="number-pad"
	                  value={manualProtein}
	                  onChangeText={setManualProtein}
	                />
	              </View>
	              <View style={styles.row}>
	                <NumberPadTextInput
	                  style={[styles.input, styles.col]}
	                  placeholder="Carbs"
	                  placeholderTextColor="#888"
	                  keyboardType="number-pad"
	                  value={manualCarbs}
	                  onChangeText={setManualCarbs}
	                />
	                <NumberPadTextInput
	                  style={[styles.input, styles.col]}
	                  placeholder="Fat"
	                  placeholderTextColor="#888"
	                  keyboardType="number-pad"
	                  value={manualFat}
	                  onChangeText={setManualFat}
	                />
	              </View>
	              <View style={styles.row}>
	                <TextInput
	                  style={[styles.input, styles.col]}
	                  placeholder="Portion label"
	                  placeholderTextColor="#888"
	                  value={manualPortionLabel}
	                  onChangeText={setManualPortionLabel}
	                />
	                <NumberPadTextInput
	                  style={[styles.input, styles.col]}
	                  placeholder="Qty"
	                  placeholderTextColor="#888"
	                  keyboardType="decimal-pad"
	                  value={manualQuantity}
	                  onChangeText={setManualQuantity}
	                />
	              </View>
	              <Pressable style={[styles.inlineButton, saving && styles.buttonDisabled]} onPress={onAddManual} disabled={saving}>
	                <Text style={styles.inlineButtonText}>Add to Meal</Text>
              </Pressable>
              {manualMacroCheck?.hasMeaningfulData && (
                <Text style={styles.helper}>
                  Macro-estimated calories: {manualMacroCheck.estimatedCalories} kcal
                  {manualMacroCheck.severity !== "ok" ? ` · mismatch ${Math.round(manualMacroCheck.deltaPercent * 100)}%` : ""}
                </Text>
              )}
            </View>
          )}

          <Text style={styles.hook}>Log to earn XP and protect your streak.</Text>

          {showSummaryBar ? (
            <Pressable style={styles.summaryBar} onPress={() => setSessionSetupCollapsed((prev) => !prev)}>
              <Text style={styles.summaryBarText}>
                Today {Math.round(todayCalories)} kcal · {Math.round(todayProtein)}g protein
              </Text>
              <Text style={styles.summaryBadge}>{winningPreview.after ? "WINNING DAY" : "NOT WINNING"}</Text>
            </Pressable>
          ) : null}

          <View style={styles.card}>
            <Pressable style={styles.cardHeader} onPress={() => setSessionSetupCollapsed((prev) => !prev)}>
              <Text style={styles.cardTitle}>Details</Text>
              <Text style={styles.cardToggle}>{sessionSetupCollapsed ? "Show" : "Hide"}</Text>
            </Pressable>

            {!sessionSetupCollapsed ? (
              <>
                <View style={styles.chipRow}>
                  {MEALS.map((option) => (
                    <Pressable
                      key={option.id}
                      onPress={async () => {
                        setMeal(option.id);
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                        void persistMealPreference(option.id);
                      }}
                      style={[styles.chip, meal === option.id && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, meal === option.id && styles.chipTextOn]}>{option.label}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.chipRow}>
                  <Pressable style={[styles.chip, mode === "search" && styles.chipOn]} onPress={() => setMode("search")}>
                    <Text style={[styles.chipText, mode === "search" && styles.chipTextOn]}>Search</Text>
                  </Pressable>
                  <Pressable style={[styles.chip, mode === "manual" && styles.chipOn]} onPress={() => setMode("manual")}>
                    <Text style={[styles.chipText, mode === "manual" && styles.chipTextOn]}>Manual</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>

          {!sessionSetupCollapsed && showImpactPreview ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Impact Preview</Text>
              <Text style={styles.previewLine}>This add: {formatEnergy(projected?.calories || 0)} · {Math.round(projected?.protein || 0)}g protein</Text>
              <Text style={styles.previewLine}>After add: {formatEnergy(projectedLog.calories)} · {Math.round(projectedLog.protein)}g protein</Text>
              {mode === "search" && selectedMacroCheck?.hasMeaningfulData && selectedMacroCheck.severity !== "ok" ? (
                <Text style={styles.warningText}>
                  Macro-energy mismatch detected ({Math.round(selectedMacroCheck.deltaPercent * 100)}%). Values were normalized for consistency.
                </Text>
              ) : null}
              {mode === "manual" && manualMacroCheck?.hasMeaningfulData && manualMacroCheck.severity !== "ok" ? (
                <Text style={styles.warningText}>
                  Manual entry mismatch ({Math.round(manualMacroCheck.deltaPercent * 100)}%). Recheck calories/macros if needed.
                </Text>
              ) : null}
              {goalsProtein ? <Text style={styles.previewLine}>Protein remaining: {Math.max(0, Math.round(goalsProtein - projectedLog.protein))}g</Text> : null}
              <Text style={styles.previewLine}>XP preview: +{XP_PER_FOOD_LOG}</Text>
              <Text style={styles.previewLine}>Winning Day: {winningPreview.before ? "YES" : "NO"} to {winningPreview.after ? "YES" : "NO"}</Text>
            </View>
          ) : null}

	          <View style={styles.card}>
	            <Text style={styles.cardTitle}>
                {mealLabel(meal)} · {Math.round(currentMealTotalKcal)} kcal
              </Text>
              {currentMealRows.length === 0 ? (
                <Text style={styles.emptyText}>Nothing logged in this meal. Search or quick add.</Text>
              ) : (
                currentMealRows.map((row) => {
                  const entry = row.entry;
                  const qtyLabel = `${formatQty(row.quantity)} × ${foodEntryPortionLabel(entry)}`;
                  return (
                    <View key={entry.id} style={styles.entryRow}>
                      <Pressable
                        style={{ flex: 1 }}
                        onPress={() => {
                          Keyboard.dismiss();
                          setQtyEditorMeal(meal);
                          setQtyEditorIdentityKey(row.identityKey);
                          setQtyEditorOpen(true);
                        }}
                      >
                        <Text style={styles.entryTitle}>{entry.label || "Food"}</Text>
                        <Text style={styles.entryMeta}>
                          {qtyLabel} · {Math.round(entry.calories)} kcal
                        </Text>
                      </Pressable>
                      <View style={styles.entryActions}>
                        <Pressable style={styles.miniAction} onPress={() => void onDuplicateGroup(row.identityKey, meal)}>
                          <Text style={styles.miniActionText}>Duplicate</Text>
                        </Pressable>
                        <Pressable style={[styles.miniAction, styles.miniDanger]} onPress={() => void onDeleteGroup(row.identityKey, meal)}>
                          <Text style={styles.miniActionText}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}
	            {deletedEntries && deletedEntries.length > 0 ? (
	              <Pressable style={styles.undoBar} onPress={() => void onUndoDelete()}>
	                <Text style={styles.undoText}>Undo remove</Text>
	              </Pressable>
            ) : null}
          </View>

          <View style={styles.card}>
            <Pressable style={styles.cardHeader} onPress={() => setNotesCollapsed((prev) => !prev)}>
              <Text style={styles.cardTitle}>Notes</Text>
              <Text style={styles.cardToggle}>{notesCollapsed ? "Show" : "Hide"}</Text>
            </Pressable>
            {!notesCollapsed ? (
              <TextInput
                style={[styles.input, styles.noteInput]}
                placeholder="Notes (optional)"
                placeholderTextColor="#888"
                value={note}
                onChangeText={setNote}
                multiline
              />
            ) : null}
          </View>
            </ZenithScrollView>

        <View
          pointerEvents="box-none"
          style={[
            styles.stickyFooter,
            {
              left: CTA_HPAD,
              right: CTA_HPAD,
              bottom: insets.bottom + CTA_BOTTOM_OFFSET,
              minHeight: CTA_BAR_MIN_HEIGHT,
            },
          ]}
        >
          <Pressable style={[styles.stickyButton, !doneEnabled && styles.buttonDisabled]} onPress={onDone} disabled={!doneEnabled}>
            <Text style={styles.stickyButtonText}>{saving ? "SAVING..." : "DONE"}</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={qtyEditorOpen} animationType="fade" transparent onRequestClose={() => setQtyEditorOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{qtyEditorRow?.entry.label || "Edit quantity"}</Text>
            <Text style={styles.sheetSub}>{mealLabel(qtyEditorMeal)} · Quantity</Text>

            <View style={styles.sheetBlock}>
              <Text style={styles.blockHint}>Amount</Text>
              <View style={[styles.row, { alignItems: "center", justifyContent: "space-between" }]}>
                <Pressable
                  style={[styles.miniAction, { minWidth: 64, alignItems: "center" }]}
                  onPress={async () => {
                    if (!qtyEditorRow) return;
                    const willRemove = qtyEditorRow.quantity <= 1;
                    await applyUnitDelta(qtyEditorRow.identityKey, qtyEditorMeal, -1);
                    if (willRemove) {
                      setQtyEditorOpen(false);
                      setQtyEditorIdentityKey(null);
                    }
                  }}
                >
                  <Text style={styles.miniActionText}>−</Text>
                </Pressable>
                <Text style={[styles.previewLine, { fontSize: 18, fontWeight: "900" }]}>
                  {qtyEditorRow ? `${formatQty(qtyEditorRow.quantity)} × ${foodEntryPortionLabel(qtyEditorRow.entry)}` : "—"}
                </Text>
                <Pressable
                  style={[styles.miniAction, { minWidth: 64, alignItems: "center" }]}
                  onPress={async () => {
                    if (!qtyEditorRow) return;
                    await applyUnitDelta(qtyEditorRow.identityKey, qtyEditorMeal, 1);
                  }}
                >
                  <Text style={styles.miniActionText}>+</Text>
                </Pressable>
              </View>
              {qtyEditorRow ? (
                <Text style={styles.selectedHint}>
                  Total: {Math.round(qtyEditorRow.entry.calories)} kcal · {Math.round(qtyEditorRow.entry.protein || 0)}g protein
                </Text>
              ) : null}
            </View>

            <View style={styles.sheetActions}>
              <Pressable
                style={styles.sheetPrimaryButton}
                onPress={() => {
                  setQtyEditorOpen(false);
                  setQtyEditorIdentityKey(null);
                }}
              >
                <Text style={styles.sheetPrimaryButtonText}>Done</Text>
              </Pressable>
              {qtyEditorRow ? (
                <Pressable
                  style={[styles.sheetGhost, { borderColor: "#2A2A2A" }]}
                  onPress={async () => {
                    await onDeleteGroup(qtyEditorRow.identityKey, qtyEditorMeal);
                    setQtyEditorOpen(false);
                    setQtyEditorIdentityKey(null);
                  }}
                >
                  <Text style={styles.sheetGhostText}>Delete row</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

	      <Modal visible={portionOpen} animationType="slide" transparent onRequestClose={() => setPortionOpen(false)}>
	        <View style={styles.sheetBackdrop}>
	          <View style={[styles.sheet, styles.portionSheet]}>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: CTA_BUTTON_HEIGHT + 22 }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
              >
	              <Text style={styles.sheetTitle}>{selectedFood?.name || "Portion"}</Text>
	              <Text style={styles.sheetSub}>{mealLabel(meal)} · Portion selection</Text>

	              <View style={styles.sheetBlock}>
	                <Text style={styles.blockHint}>Quantity</Text>
	                <View style={styles.portionRow}>
	                  <NumberPadTextInput
	                    style={[styles.input, styles.portionAmount]}
	                    placeholder="Amount"
	                    placeholderTextColor="#888"
	                    keyboardType="decimal-pad"
	                    value={amount}
	                    onChangeText={setAmount}
	                  />
	                  <Pressable style={styles.unitButton} onPress={() => setUnitPickerOpen(true)}>
                      <View style={styles.unitButtonRow}>
                        <Text style={styles.unitButtonText}>
                          {String(selectedUnitKey).startsWith("serving:") ? String(selectedUnitKey).slice("serving:".length) : String(selectedUnitKey)}
                        </Text>
                        {selectedUnitOption?.isEstimated ? (
                          <View style={styles.estimatedBadge}>
                            <Text style={styles.estimatedBadgeText}>Estimated</Text>
                          </View>
                        ) : null}
                      </View>
	                  </Pressable>
	                </View>
                {selectedPreview?.eq ? (
                  <Text style={styles.selectedHint}>Equivalent: {selectedPreview.eq.primary} · {selectedPreview.eq.secondary}</Text>
                ) : null}
                {selectedUnitOption?.isEstimated ? (
                  <Text style={styles.selectedHint}>Serving size is estimated from item type/name.</Text>
                ) : null}
              </View>

              {selectedFood ? (() => {
                const selection = getFoodUnitSelection(selectedFood, unitsPref);
                if (selection.kind !== "drink") return null;
                const presets = unitsPref === "kg-ml" ? [250, 350, 500] : [8, 12, 16];
                return (
                  <View style={styles.sheetBlock}>
                    <Text style={styles.blockHint}>Quick add</Text>
                    <View style={styles.chipRow}>
                      {presets.map((p) => (
                        <Pressable key={p} style={styles.chip} onPress={() => setAmount(String(p))}>
                          <Text style={styles.chipText}>{p}{unitsPref === "kg-ml" ? " ml" : " fl oz"}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              })() : null}
              {portionNudge ? (
                <View style={styles.sheetBlock}>
                  <Text style={styles.warningText}>{portionNudge.message}</Text>
                  <Pressable style={styles.nudgeAction} onPress={portionNudge.onApply}>
                    <Text style={styles.nudgeActionText}>{portionNudge.actionLabel}</Text>
                  </Pressable>
                </View>
              ) : null}
              {amountWarning ? (
                <View style={styles.sheetBlock}>
                  <Text style={styles.warningText}>{amountWarning}</Text>
                </View>
              ) : null}

              {selectedPreview ? (
                <View style={[styles.previewCard, styles.sheetBlock]}>
                  {selectedPreview.eq ? <Text style={styles.previewLine}>This adds: {selectedPreview.eq.primary}</Text> : null}
                  <Text style={styles.previewLine}>Nutrition: {formatEnergy(selectedPreview.calories)} · {selectedPreview.protein}g protein</Text>
                  {showNutrientDetails ? (
                    <Text style={styles.previewLine}>
                      Macros: {Math.round(selectedPreview.carbs * 10) / 10}g carbs · {Math.round(selectedPreview.fat * 10) / 10}g fat
                    </Text>
                  ) : null}
                  {showNutrientDetails && typeof (selectedPreview as any).fiber === "number" ? (
                    <Text style={styles.previewLine}>Fiber: {(selectedPreview as any).fiber}g</Text>
                  ) : null}
                  {showNutrientDetails && typeof (selectedPreview as any).sugar === "number" ? (
                    <Text style={styles.previewLine}>Sugar: {(selectedPreview as any).sugar}g</Text>
                  ) : null}
                  {showNutrientDetails && typeof (selectedPreview as any).sodiumMg === "number" ? (
                    <Text style={styles.previewLine}>Sodium: {(selectedPreview as any).sodiumMg} mg</Text>
                  ) : null}
                  <Text style={styles.previewLine}>After: {formatEnergy(todayCalories + selectedPreview.calories)} · {Math.round((todayProtein + selectedPreview.protein) * 10) / 10}g protein</Text>
                  {selectedMacroCheck?.hasMeaningfulData ? (
                    <Text style={styles.previewLine}>Macro-estimated: {selectedMacroCheck.estimatedCalories} kcal</Text>
                  ) : null}
                  {selectedMacroCheck?.hasMeaningfulData && selectedMacroCheck.severity !== "ok" ? (
                    <Text style={styles.warningText}>
                      Energy mismatch {Math.round(selectedMacroCheck.deltaPercent * 100)}% (kept consistent for accuracy).
                    </Text>
                  ) : null}
                  {goalsProtein ? (
                    <Text style={styles.previewLine}>Protein remaining: {Math.max(0, Math.round(goalsProtein - (todayProtein + selectedPreview.protein)))}g</Text>
                  ) : null}
                  <Pressable style={styles.nutrientToggle} onPress={() => setShowNutrientDetails((v) => !v)}>
                    <Text style={styles.nutrientToggleText}>{showNutrientDetails ? "Hide nutrients" : "Show nutrients"}</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.sheetActionsSecondary}>
                <Pressable
                  style={styles.sheetGhost}
                  onPress={async () => {
                    if (!selectedFood) return;
                    const next = await toggleFavoriteFood(selectedFood);
                    setFavorites(await getFoodFavorites());
                    setToastTitle(next ? "Saved to favorites" : "Removed from favorites");
                    setToastSubtitle(undefined);
                    setShowToast(true);
                  }}
                >
                  <Text style={styles.sheetGhostText}>Save Favorite</Text>
                </Pressable>
                <Pressable style={styles.sheetGhost} onPress={() => setPortionOpen(false)}>
                  <Text style={styles.sheetGhostText}>Close</Text>
                </Pressable>
              </View>
              </ScrollView>

              <View style={styles.sheetStickyFooter}>
                <Pressable style={[styles.stickyButton, saving && styles.buttonDisabled]} onPress={onAddSelectedFood} disabled={saving}>
                  <Text style={styles.stickyButtonText}>{saving ? "ADDING..." : "ADD TO MEAL"}</Text>
                </Pressable>
              </View>
            </View>
        </View>
      </Modal>

      <Modal visible={unitPickerOpen} transparent animationType="fade" onRequestClose={() => setUnitPickerOpen(false)}>
        <View style={styles.unitBackdrop}>
          <View style={styles.unitSheet}>
            <Text style={styles.unitTitle}>Choose unit</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {selectedFood
                ? getFoodUnitSelection(selectedFood, unitsPref).options.map((opt) => {
                    const disabled = !!opt.disabledReason;
                    const active = opt.key === (selectedUnitKey as any);
                    return (
                      <Pressable
                        key={opt.key}
                        style={[styles.unitRow, active && styles.unitRowOn, disabled && styles.unitRowDisabled]}
                        onPress={() => {
                          if (disabled) return;
                          setSelectedUnitKey(opt.key as any);
                          setUnitPickerOpen(false);
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                        }}
                      >
                        <View style={styles.unitRowTop}>
                          <Text style={[styles.unitRowText, active && styles.unitRowTextOn]}>{opt.label}</Text>
                          {opt.isEstimated ? (
                            <View style={styles.estimatedBadge}>
                              <Text style={styles.estimatedBadgeText}>Estimated</Text>
                            </View>
                          ) : null}
                        </View>
                        {disabled ? (
                          <Text style={styles.unitRowHint}>{opt.disabledReason}</Text>
                        ) : null}
                      </Pressable>
                    );
                  })
                : null}
            </ScrollView>
            <Pressable style={styles.sheetGhost} onPress={() => setUnitPickerOpen(false)}>
              <Text style={styles.sheetGhostText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <WinningDayToast visible={showToast} title={toastTitle} subtitle={toastSubtitle} onHide={() => setShowToast(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0A0A0A" },
  keyboard: { flex: 1 },
  container: { padding: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  topAction: { minWidth: 44, minHeight: 44, justifyContent: "center" },
  topActionText: { color: "#00D9FF", fontWeight: "700" },
  title: { color: "#FFF", fontSize: 22, fontWeight: "800" },
  hook: { color: "#9EC6D4", marginBottom: 10, fontWeight: "600" },

  summaryBar: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2C4A59",
    backgroundColor: "#102029",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryBarText: { color: "#D4F3FF", fontWeight: "700", fontSize: 12 },
  summaryBadge: { color: "#8CFABF", fontWeight: "900", fontSize: 11 },

  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#232323",
    backgroundColor: "#121212",
    padding: 12,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 },
  cardTitle: { color: "#FFF", fontWeight: "800", marginBottom: 8 },
  cardToggle: { color: "#8BBFD5", fontWeight: "700", fontSize: 12 },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2A2A2A",
    backgroundColor: "#171717",
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  chipOn: { borderColor: "#00D9FF", backgroundColor: "rgba(0,217,255,0.18)" },
  chipText: { color: "#C5C5C5", fontWeight: "700", fontSize: 12 },
  chipTextOn: { color: "#E6F8FF" },

  previewCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#263932",
    backgroundColor: "#121C18",
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  previewLine: { color: "#C5DED0", fontSize: 12, fontWeight: "600", marginBottom: 2 },
  nutrientToggle: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2B3E47",
    backgroundColor: "rgba(0,217,255,0.10)",
  },
  nutrientToggleText: { color: "#BFEFFF", fontWeight: "900", fontSize: 12 },

  searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  searchInput: { flex: 1, marginBottom: 0 },
  scanCluster: { flexDirection: "row", gap: 8, alignItems: "center" },
  scanButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2B3E47",
    backgroundColor: "#1A2328",
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  scanText: { color: "#D6F5FF", fontWeight: "800" },
  scanPhotoButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(126,220,255,0.36)",
    backgroundColor: "rgba(126,220,255,0.12)",
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  scanPhotoText: { color: "#D8F4FF", fontWeight: "900", fontSize: 12 },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2B2B2B",
    backgroundColor: "#151515",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: "#D6F5FF", fontWeight: "900", fontSize: 20, lineHeight: 22 },
  searchHelperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8, marginBottom: 8 },
  searchHelperText: { color: "#8FAFBB", fontSize: 12, flex: 1 },
  searchCollapseToggle: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#27343B",
    backgroundColor: "rgba(214,245,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  searchCollapseToggleText: { color: "#D6F5FF", fontWeight: "900", fontSize: 12 },
  helper: { color: "#8FAFBB", fontSize: 12, marginTop: 8, marginBottom: 8 },

  multiCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#283741",
    backgroundColor: "rgba(0,217,255,0.07)",
    padding: 10,
    marginBottom: 10,
  },
  multiTitle: { color: "#E6F8FF", fontWeight: "900", marginBottom: 6 },
  multiRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
  multiQty: { color: "#BFEFFF", fontWeight: "900", width: 92, fontSize: 12 },
  multiFood: { color: "#D6F5FF", fontWeight: "800", flex: 1, fontSize: 12 },
  multiButton: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: "#00D9FF",
    paddingVertical: 10,
    alignItems: "center",
  },
  multiButtonText: { color: "#03141A", fontWeight: "900" },
  multiHint: { color: "#8FAFBB", fontSize: 11, marginTop: 8, fontWeight: "600" },

  commonSection: {
    marginTop: 14,
    marginBottom: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1E313A",
    backgroundColor: "#0E161A",
    padding: 12,
  },
  commonTitle: { color: "#D6F5FF", fontWeight: "900", marginBottom: 8 },
  commonGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  commonChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#264651",
    backgroundColor: "rgba(0,217,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  commonChipText: { color: "#E6F8FF", fontWeight: "800", fontSize: 11 },

  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#252525",
    backgroundColor: "#101010",
    padding: 10,
    marginBottom: 8,
  },
  resultTitle: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  resultBrand: { color: "#A9A9A9", fontSize: 12, fontWeight: "600" },
  resultSub: { color: "#8FCBE1", fontSize: 11, fontWeight: "700", marginTop: 2 },
  tagRow: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  resultTag: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2C3C46",
    backgroundColor: "#152028",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  resultTagText: { color: "#CBE8F5", fontSize: 10, fontWeight: "700" },
  plusButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2E3C44",
    backgroundColor: "#172126",
    alignItems: "center",
    justifyContent: "center",
  },
  plusText: { color: "#D8F4FF", fontSize: 20, fontWeight: "800" },

  row: { flexDirection: "row", gap: 8 },
  col: { flex: 1 },
  input: {
    backgroundColor: "#151515",
    color: "#FFF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#232323",
    minHeight: 44,
  },
  inlineButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "#00D9FF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  inlineButtonText: { color: "#00131A", fontWeight: "900" },

  mealSection: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#222",
    backgroundColor: "#0F0F0F",
    padding: 9,
    marginBottom: 8,
  },
  mealTitle: { color: "#E6F5FF", fontWeight: "800", marginBottom: 6 },
  emptyText: { color: "#8D9AA0", fontSize: 12, fontWeight: "600" },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#202020",
    paddingVertical: 8,
    gap: 8,
  },
  entryTitle: { color: "#FFF", fontWeight: "700", fontSize: 13 },
  entryMeta: { color: "#8FCBE1", fontSize: 11, fontWeight: "600", marginTop: 2 },
  entryDeleteBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#4A2E2E",
    backgroundColor: "#201313",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  entryDeleteText: { color: "#FFBABA", fontWeight: "800", fontSize: 11 },
  entryActions: { flexDirection: "row", gap: 6 },
  miniAction: {
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2F3D45",
    backgroundColor: "#182229",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  miniDanger: { borderColor: "#4A2D2D", backgroundColor: "#241616" },
  miniActionText: { color: "#D7EFFB", fontSize: 10, fontWeight: "800" },
  undoBar: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#4B3B2A",
    backgroundColor: "#231B12",
    paddingVertical: 9,
    alignItems: "center",
  },
  undoText: { color: "#FFD179", fontWeight: "800" },

  noteInput: { minHeight: 82, textAlignVertical: "top", marginBottom: 0 },

	  stickyFooter: {
	    position: "absolute",
	    borderRadius: 22,
	    padding: 10,
	    borderWidth: 1,
	    borderColor: "rgba(255,255,255,0.10)",
	    backgroundColor: "rgba(9,9,9,0.98)",
	  },
  stickyButton: {
    height: CTA_BUTTON_HEIGHT,
    borderRadius: CTA_BUTTON_RADIUS,
    backgroundColor: "#00D9FF",
    alignItems: "center",
    justifyContent: "center",
  },
  stickyButtonText: { color: "#00131A", fontWeight: "900", fontSize: 15 },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#111",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: "#282828",
    padding: 14,
    paddingBottom: 24,
  },
  portionSheet: {
    maxHeight: "88%",
    paddingBottom: 14,
  },
  sheetTitle: { color: "#FFF", fontSize: 18, fontWeight: "800" },
  sheetSub: { color: "#9CB7C4", marginTop: 3, marginBottom: 10, fontWeight: "600" },
  sheetBlock: { marginBottom: 10 },
  blockHint: { color: "#9FB2BD", fontSize: 12, marginBottom: 6, fontWeight: "600" },
  selectedHint: { color: "#A7D8EA", marginTop: 6, fontSize: 11, fontWeight: "700" },
  portionEquation: { color: "#EAF8FF", fontWeight: "700", marginBottom: 6 },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, marginBottom: 4 },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2C2C2C",
    backgroundColor: "#191919",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { color: "#D4F1FF", fontSize: 24, fontWeight: "700" },
  stepInput: { flex: 1, marginBottom: 0, textAlign: "center" },
  warningText: { color: "#FFCE8A", marginTop: 4, fontSize: 11, fontWeight: "700" },
  nudgeAction: { marginTop: 8, alignSelf: "flex-start" },
  nudgeActionText: { color: "#00D9FF", fontWeight: "900", fontSize: 12 },
  sheetActions: { gap: 8, marginTop: 8 },
  sheetActionsSecondary: { gap: 8, marginTop: 8, marginBottom: 6 },
  sheetStickyFooter: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  sheetPrimaryButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#00D9FF",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetPrimaryButtonText: { color: "#00131A", fontWeight: "900", fontSize: 14 },
  sheetGhost: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2F2F2F",
    backgroundColor: "#171717",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetGhostText: { color: "#B8B8B8", fontWeight: "700", fontSize: 12 },

  portionRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  portionAmount: { flex: 1, marginBottom: 0 },
  unitButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2B3E47",
    backgroundColor: "#1A2328",
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  unitButtonRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  unitButtonText: { color: "#D6F5FF", fontWeight: "900" },

  unitBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 },
  unitSheet: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2B3E47",
    backgroundColor: "#0E1113",
    padding: 12,
  },
  unitTitle: { color: "#FFF", fontWeight: "900", fontSize: 16, marginBottom: 10 },
  unitRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#232323",
    backgroundColor: "#121212",
    padding: 10,
    marginBottom: 8,
  },
  unitRowOn: { borderColor: "#00D9FF", backgroundColor: "rgba(0,217,255,0.12)" },
  unitRowDisabled: { opacity: 0.5 },
  unitRowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  unitRowText: { color: "#EAEAEA", fontWeight: "800" },
  unitRowTextOn: { color: "#E6F8FF" },
  unitRowHint: { color: "#8FAFBB", fontSize: 11, fontWeight: "700", marginTop: 4 },
  estimatedBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2D6174",
    backgroundColor: "rgba(0,217,255,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  estimatedBadgeText: { color: "#BCEFFF", fontSize: 10, fontWeight: "900", letterSpacing: 0.2 },

  buttonDisabled: { opacity: 0.6 },
});
