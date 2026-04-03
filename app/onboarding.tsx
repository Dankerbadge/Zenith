import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Platform,
  Keyboard,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeParseJson, saveDailyLog, setStorageItem, todayKey, USER_PROFILE_KEY, normalizeEmail } from '../utils/storageUtils';
import { isStorePurchasingEnabled } from '../utils/monetizationService';
import { captureException } from '../utils/crashReporter';
import NumberPadTextInput from '../components/inputs/NumberPadTextInput';
import { installKeyboardEventLogging } from '../utils/debugKeyboardJitter';
import { useDebugRenderCount } from '../utils/useDebugRenderCount';
import ZenithScrollView from '../components/layout/ZenithScrollView';
import { useAuth } from './context/authcontext';
import { formatHandle, isUsernameValid, normalizeUsername } from '../utils/username';
import { isSupabaseConfigured, supabase } from '../utils/supabaseClient';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { computeRecommendedTargets, type RecommendationGoal } from '../utils/nutritionRecommendations';

type Sex = 'male' | 'female' | null;
type Units = 'lb-oz' | 'kg-ml';
type Goal = RecommendationGoal;

export default function OnboardingScreen() {
  const router = useRouter();
  const { authReady, hasSupabaseSession, profile: cloudProfile, profileReady, setUsername } = useAuth();
  const [step, setStep] = useState(1);
  useDebugRenderCount('OnboardingScreen');

  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const keyboardInsetBottom = Math.max(0, keyboardHeight - insets.bottom);
  const [footerHeight, setFooterHeight] = useState(0);

  const [firstName, setFirstName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex>(null);
  const [units, setUnits] = useState<Units>('lb-oz');
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weight, setWeight] = useState('');
  const [onboardingGoals, setOnboardingGoals] = useState<Goal[]>([]);
  const [intensity, setIntensity] = useState<'moderate' | 'aggressive' | 'extreme' | null>(null);
  const [exerciseType, setExerciseType] = useState<'lifting' | 'running' | 'calisthenics' | 'mixed' | null>(null);
  const [activityLevel, setActivityLevel] = useState<'sedentary' | 'light' | 'moderate' | 'very' | 'extra' | null>(null);
  const [waterGoal] = useState('90');
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'cooldown'>('idle');
  const [usernameCooldownUntil, setUsernameCooldownUntil] = useState<string | null>(null);
  const usernameCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => installKeyboardEventLogging('OnboardingScreen'), []);
  const [notifications] = useState(true);

  // iOS number-pad + step transitions can "jitter" if we swap steps while the keyboard is animating.
  // We explicitly dismiss first, then advance after a short delay (or keyboard hide) so the input tree
  // doesn't remount mid-animation.
  const keyboardOpenRef = useRef(false);
  const pendingStepRef = useRef<number | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardWillShow', () => {
      keyboardOpenRef.current = true;
    });
    const didHideSub = Keyboard.addListener('keyboardDidHide', () => {
      keyboardOpenRef.current = false;
      const pending = pendingStepRef.current;
      if (pending != null) {
        pendingStepRef.current = null;
        if (advanceTimerRef.current) {
          clearTimeout(advanceTimerRef.current);
          advanceTimerRef.current = null;
        }
        setStep(pending);
      }
    });
    // NOTE: We intentionally advance steps on `keyboardDidHide`, not `keyboardWillHide`.
    // Swapping the step subtree during the keyboard hide animation can cause iOS numeric-pad
    // responder churn ("keyboard spazzing") because the input tree remounts mid-transition.
    const hideSub = Keyboard.addListener('keyboardWillHide', () => {
      keyboardOpenRef.current = false;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
      didHideSub.remove();
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      if (usernameCheckTimerRef.current) clearTimeout(usernameCheckTimerRef.current);
    };
  }, []);

  useEffect(() => {
    // Seed onboarding username UI from the cloud profile (also guarantees a per-account fallback).
    if (!profileReady) return;
    const existing = normalizeUsername(cloudProfile?.username || '');
    if (existing && !usernameInput) {
      setUsernameInput(existing);
      setUsernameStatus('idle');
      setUsernameCooldownUntil(null);
    }
  }, [cloudProfile?.username, profileReady, usernameInput]);

  useEffect(() => {
    if (step !== 16) return;
    const candidate = normalizeUsername(usernameInput);
    if (!candidate) {
      setUsernameStatus('idle');
      setUsernameCooldownUntil(null);
      return;
    }
    if (!isUsernameValid(candidate)) {
      setUsernameStatus('invalid');
      setUsernameCooldownUntil(null);
      return;
    }

    setUsernameStatus('checking');
    setUsernameCooldownUntil(null);
    if (usernameCheckTimerRef.current) clearTimeout(usernameCheckTimerRef.current);
    usernameCheckTimerRef.current = setTimeout(async () => {
      // Availability checks are advisory; final save still needs to handle race conditions.
      if (!isSupabaseConfigured || !hasSupabaseSession) {
        setUsernameStatus('available');
        return;
      }

      const current = normalizeUsername(cloudProfile?.username || '');
      if (current && candidate === current) {
        setUsernameStatus('available');
        return;
      }

      const { data, error } = await supabase.from('profiles').select('id').eq('username', candidate).limit(1);
      if (error) {
        setUsernameStatus('available');
        return;
      }
      setUsernameStatus(data && data.length > 0 ? 'taken' : 'available');
    }, 420);

    return () => {
      if (usernameCheckTimerRef.current) clearTimeout(usernameCheckTimerRef.current);
    };
  }, [step, usernameInput, cloudProfile?.username, hasSupabaseSession]);

  const goToStep = (nextStep: number) => {
    if (nextStep === step) return;
    const isIOS = Platform.OS === 'ios';
    let focused: any = null;
    if (isIOS) {
      try {
        focused = (TextInput as any)?.State?.currentlyFocusedInput?.() || null;
      } catch {
        focused = null;
      }
    }

    // Hard rule: do not swap step trees while an input is focused on iOS (keyboard events can lie; focus doesn't).
    if (isIOS && (keyboardOpenRef.current || focused)) {
      pendingStepRef.current = nextStep;

      // Release responder deterministically before dismissing, to avoid focus/blur churn during iOS keyboard animation.
      try {
        if (focused) {
          (TextInput as any)?.State?.blurTextInput?.(focused);
        }
      } catch {
        // Best-effort only.
      }

      Keyboard.dismiss();

      // Fallback: if keyboardWillHide doesn't fire for any reason, still advance after animation-ish delay.
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        if (pendingStepRef.current != null) {
          const pending = pendingStepRef.current;
          pendingStepRef.current = null;
          setStep(pending);
        }
      }, 420);
      return;
    }

    setStep(nextStep);
  };

  const getHeightCm = () => {
    if (units === 'kg-ml') return parseFloat(heightCm);
    return (parseInt(heightFeet, 10) * 12 + parseInt(heightInches, 10)) * 2.54;
  };

  const getWeightKg = () => {
    const input = parseFloat(weight);
    if (!Number.isFinite(input)) return 0;
    return units === 'kg-ml' ? input : input * 0.453592;
  };

  const getWeightLbs = () => {
    const kg = getWeightKg();
    return kg > 0 ? kg * 2.20462 : 0;
  };

  const toggleOnboardingGoal = (goal: Goal) => {
    setOnboardingGoals((prev) => {
      if (prev.includes(goal)) return prev.filter((item) => item !== goal);
      return [...prev, goal];
    });
  };

  const getEffectiveGoals = () => (onboardingGoals.length ? onboardingGoals : (['MAINTAIN'] as Goal[]));

  const getGoalModeLabel = () => {
    const goals = getEffectiveGoals();
    const hasLose = goals.includes('LOSE_FAT');
    const hasGainFat = goals.includes('GAIN_FAT');
    const hasGainMuscle = goals.includes('GAIN_MUSCLE');
    if (hasLose && hasGainMuscle) return 'Small deficit for recomposition';
    if (hasLose && hasGainFat) return 'Maintenance (conflicting goals selected)';
    if (hasLose) return 'Calorie deficit';
    if (hasGainFat) return 'Calorie surplus';
    if (hasGainMuscle) return 'Lean surplus';
    return 'Calorie balance';
  };

  const calculateTDEE = () => {
    if (!age || !sex || !activityLevel) return null;

    const ageNum = parseInt(age, 10);
    const heightCmValue = getHeightCm();
    const weightKg = getWeightKg();
    if (!ageNum || !heightCmValue || !weightKg) return null;

    let bmr = 0;
    if (sex === 'male') {
      bmr = 10 * weightKg + 6.25 * heightCmValue - 5 * ageNum + 5;
    } else {
      bmr = 10 * weightKg + 6.25 * heightCmValue - 5 * ageNum - 161;
    }

    const multipliers: Record<'sedentary' | 'light' | 'moderate' | 'very' | 'extra', number> = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      very: 1.725,
      extra: 1.9,
    };

    return Math.round(bmr * multipliers[activityLevel]);
  };

  const calculateCalorieTargets = (tdee: number) => {
    const rec = computeRecommendedTargets({
      heightCm: getHeightCm(),
      weightKg: getWeightKg(),
      sexAtBirth: sex || 'unknown',
      activityLevel: activityLevel || 'moderate',
      onboardingGoals: getEffectiveGoals(),
      age: Number(age) || undefined,
    });
    const target = Number(rec.caloriesTargetKcal) || tdee;
    return { target, min: target - 100, max: target + 100 };
  };

  const handleComplete = async () => {
    try {
      const savedUser = await AsyncStorage.getItem('user');
      const savedUserParsed = safeParseJson<{ email?: string } | null>(savedUser, null);
      const userEmail = normalizeEmail(savedUserParsed?.email || '');

      const tdee = calculateTDEE();
      if (!tdee) {
        alert('Error calculating TDEE');
        return;
      }

      const calorieTargets = calculateCalorieTargets(tdee);
      const weightLbs = getWeightLbs();
      const weightKg = getWeightKg();
      const heightCmValue = getHeightCm();
      const inches = units === 'lb-oz' ? parseInt(heightFeet, 10) * 12 + parseInt(heightInches, 10) : Math.round(getHeightCm() / 2.54);
      const derivedGoals = getEffectiveGoals();
      const rec = computeRecommendedTargets({
        heightCm: heightCmValue,
        weightKg,
        sexAtBirth: sex || 'unknown',
        activityLevel: activityLevel || 'moderate',
        onboardingGoals: derivedGoals,
        age: parseInt(age, 10),
      });
      const proteinTarget = Number(rec.proteinTargetG) || Math.max(100, Math.round(weightLbs * 0.8));
      const waterTargetOz = Number(rec.waterTargetOz) || parseInt(waterGoal, 10);
      const calorieTarget = Number(rec.caloriesTargetKcal) || calorieTargets.target;
      const birthYear = new Date().getFullYear() - Math.max(1, parseInt(age, 10));
      const birthdate = `${birthYear}-01-01`;
      const hasLose = derivedGoals.includes('LOSE_FAT');
      const hasGainFat = derivedGoals.includes('GAIN_FAT');
      const hasGainMuscle = derivedGoals.includes('GAIN_MUSCLE');
      const legacyGoal = hasLose ? 'cut' : hasGainFat ? 'gain_fat' : hasGainMuscle ? 'gain_muscle' : 'maintain';

      const userProfile = {
        firstName,
        email: userEmail,
        age: parseInt(age, 10),
        sex,
        sexAtBirth: sex || 'unknown',
        birthdate,
        height: inches,
        heightCm: Number(heightCmValue.toFixed(1)),
        startWeight: Number(weightLbs.toFixed(1)),
        currentWeight: Number(weightLbs.toFixed(1)),
        weightKg: Number(weightKg.toFixed(2)),
        goalWeight:
          hasLose
            ? Number((weightLbs - 20).toFixed(1))
            : hasGainFat
            ? Number((weightLbs + 25).toFixed(1))
            : hasGainMuscle
            ? Number((weightLbs + 15).toFixed(1))
            : Number(weightLbs.toFixed(1)),
        goal: legacyGoal,
        onboardingGoals: derivedGoals,
        intensity,
        exerciseType,
        activityLevel,
        tdee,
        calorieTarget,
        calorieMin: calorieTargets.min,
        calorieMax: calorieTargets.max,
        waterGoal: waterTargetOz,
        notifications,
        goals: {
          proteinTarget,
          waterTargetOz,
          activeRestTargetMin: 20,
          caloriesTarget: calorieTarget,
        },
        preferences: {
          units,
          weekStart: 'mon',
        },
        onboardingCompleted: true,
        createdAt: new Date().toISOString(),
      };

      await setStorageItem(USER_PROFILE_KEY, userProfile);

      const userAccount = { email: userEmail, firstName };
      await AsyncStorage.setItem('user', JSON.stringify(userAccount));

      const allAccountsData = await AsyncStorage.getItem('allAccounts');
      const allAccounts = safeParseJson<Record<string, { firstName?: string }>>(allAccountsData, {});
      if (allAccounts[userEmail]) {
        allAccounts[userEmail].firstName = firstName;
        await AsyncStorage.setItem('allAccounts', JSON.stringify(allAccounts));
      }

      const userProgress = {
        totalXP: 50,
        totalWinningDays: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastWinningDate: null,
      };
      await AsyncStorage.setItem('userProgress', JSON.stringify(userProgress));

      const today = todayKey();
      const dailyLog = {
        workouts: [],
        activeRest: [],
        foodEntries: [],
        calories: 0,
        water: 0,
        dailyXP: 0,
        calorieTarget: calorieTargets.target,
        calorieMin: calorieTargets.min,
        calorieMax: calorieTargets.max,
      };
      await saveDailyLog(today, dailyLog as any);

      const storeEnabled = isStorePurchasingEnabled();
      router.replace((storeEnabled ? '/paywall' : '/(tabs)') as any);
    } catch (error) {
      if (__DEV__) {
        console.log('Error completing onboarding:', error);
      } else {
        void captureException(error, { feature: 'onboarding', op: 'complete' });
      }
      alert('Failed to complete onboarding');
    }
  };

  const canProgress = () => {
    switch (step) {
      case 1:
        return true;
      case 2:
        return firstName.trim().length > 0;
      case 3:
        return !!age && parseInt(age, 10) >= 13 && parseInt(age, 10) <= 100;
      case 4:
        return sex !== null;
      case 5:
        return true;
      case 6:
        return units === 'kg-ml'
          ? !!heightCm && parseInt(heightCm, 10) >= 120 && parseInt(heightCm, 10) <= 240
          : !!heightFeet && !!heightInches && parseInt(heightFeet, 10) >= 3 && parseInt(heightFeet, 10) <= 8;
      case 7:
        return !!weight && (units === 'kg-ml' ? parseFloat(weight) > 30 && parseFloat(weight) < 250 : parseFloat(weight) > 50 && parseFloat(weight) < 500);
      case 8:
        return onboardingGoals.length > 0;
      case 9:
        return intensity !== null;
      case 10:
        return exerciseType !== null;
      case 11:
        return activityLevel !== null;
      case 12:
      case 13:
      case 14:
      case 15:
        return true;
      case 16: {
        const typed = normalizeUsername(usernameInput);
        if (!typed) {
          if (!hasSupabaseSession) return true;
          return Boolean(profileReady && normalizeUsername(cloudProfile?.username || ''));
        }
        return isUsernameValid(typed) && usernameStatus !== 'taken' && usernameStatus !== 'invalid' && usernameStatus !== 'cooldown';
      }
      default:
        return false;
    }
  };

  const handleUsernameContinue = async () => {
    const typed = normalizeUsername(usernameInput);
    if (!typed) {
      await handleComplete();
      return;
    }
    if (!isUsernameValid(typed)) {
      setUsernameStatus('invalid');
      setUsernameCooldownUntil(null);
      return;
    }
    if (!authReady || !hasSupabaseSession) {
      // No cloud session: proceed. A unique fallback will be generated when cloud connects.
      await handleComplete();
      return;
    }
    const res = await setUsername(typed);
    if (!res.ok) {
      if (res.reason === 'taken') setUsernameStatus('taken');
      else if (res.reason === 'cooldown') {
        setUsernameStatus('cooldown');
        setUsernameCooldownUntil(res.nextAllowedAt ?? null);
      } else setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('available');
    setUsernameCooldownUntil(null);
    await handleComplete();
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.logo}>⚡</Text>
            <Text style={styles.title}>Welcome to Zenith</Text>
            <Text style={styles.subtitle}>Your fitness journey starts here. We will set your plan in under 2 minutes.</Text>
          </View>
        );

      case 2:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>1/15</Text>
            <Text style={styles.title}>What is your first name?</Text>
            <TextInput style={styles.input} placeholder='Enter your name' placeholderTextColor='#555' value={firstName} onChangeText={setFirstName} autoFocus />
          </View>
        );

		      case 3:
		        return (
		          <View style={styles.stepContainer}>
		            <Text style={styles.stepNumber}>2/15</Text>
		            <Text style={styles.title}>How old are you?</Text>
		            <NumberPadTextInput
                  debugTag="onboarding-age"
                  style={styles.input}
                  placeholder='25'
                  placeholderTextColor='#555'
                  value={age}
                  onChangeText={setAge}
                  keyboardType='number-pad'
                />
		          </View>
		        );

      case 4:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>3/15</Text>
            <Text style={styles.title}>What is your biological sex?</Text>
            <Text style={styles.note}>Used for calorie calculations only.</Text>
            <View style={styles.optionGrid}>
              <TouchableOpacity style={[styles.optionButton, sex === 'male' && styles.optionButtonSelected]} onPress={() => setSex('male')}>
                <Text style={styles.optionIcon}>♂️</Text>
                <Text style={styles.optionText}>Male</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.optionButton, sex === 'female' && styles.optionButtonSelected]} onPress={() => setSex('female')}>
                <Text style={styles.optionIcon}>♀️</Text>
                <Text style={styles.optionText}>Female</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 5:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>4/15</Text>
            <Text style={styles.title}>Choose your units</Text>
            <View style={styles.optionGrid}>
              <TouchableOpacity style={[styles.optionButton, units === 'lb-oz' && styles.optionButtonSelected]} onPress={() => setUnits('lb-oz')}>
                <Text style={styles.optionText}>Imperial</Text>
                <Text style={styles.optionSubtext}>lb / oz / ft</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.optionButton, units === 'kg-ml' && styles.optionButtonSelected]} onPress={() => setUnits('kg-ml')}>
                <Text style={styles.optionText}>Metric</Text>
                <Text style={styles.optionSubtext}>kg / ml / cm</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

	      case 6:
	        return (
	          <View style={styles.stepContainer}>
	            <Text style={styles.stepNumber}>5/15</Text>
	            <Text style={styles.title}>What is your height?</Text>
	            {units === 'kg-ml' ? (
	              <>
	                <NumberPadTextInput style={styles.input} placeholder='178' placeholderTextColor='#555' value={heightCm} onChangeText={setHeightCm} keyboardType='number-pad' />
	                <Text style={styles.note}>cm</Text>
	              </>
	            ) : (
	              <View style={styles.heightRow}>
	                <View style={styles.heightInput}>
	                  <NumberPadTextInput style={styles.input} placeholder='5' placeholderTextColor='#555' value={heightFeet} onChangeText={setHeightFeet} keyboardType='number-pad' />
	                  <Text style={styles.heightLabel}>feet</Text>
	                </View>
	                <View style={styles.heightInput}>
	                  <NumberPadTextInput style={styles.input} placeholder='10' placeholderTextColor='#555' value={heightInches} onChangeText={setHeightInches} keyboardType='number-pad' />
	                  <Text style={styles.heightLabel}>inches</Text>
	                </View>
	              </View>
	            )}
	          </View>
	        );

	      case 7:
	        return (
	          <View style={styles.stepContainer}>
	            <Text style={styles.stepNumber}>6/15</Text>
	            <Text style={styles.title}>What is your current weight?</Text>
	            <NumberPadTextInput
	              style={styles.input}
	              placeholder={units === 'kg-ml' ? '82' : '185'}
	              placeholderTextColor='#555'
	              value={weight}
	              onChangeText={setWeight}
	              keyboardType='decimal-pad'
	            />
	            <Text style={styles.note}>{units === 'kg-ml' ? 'kg' : 'lbs'}</Text>
	          </View>
	        );

      case 8:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>7/15</Text>
            <Text style={styles.title}>Choose your goals</Text>
            <Text style={styles.note}>Select one or more.</Text>
            <View style={styles.optionGrid}>
              <TouchableOpacity
                style={[styles.optionButton, onboardingGoals.includes('GAIN_FAT') && styles.optionButtonSelected]}
                onPress={() => toggleOnboardingGoal('GAIN_FAT')}
              >
                <Text style={styles.optionIcon}>🍔</Text>
                <Text style={styles.optionText}>Gain Fat</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionButton, onboardingGoals.includes('GAIN_MUSCLE') && styles.optionButtonSelected]}
                onPress={() => toggleOnboardingGoal('GAIN_MUSCLE')}
              >
                <Text style={styles.optionIcon}>💪</Text>
                <Text style={styles.optionText}>Gain Muscle</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionButton, onboardingGoals.includes('MAINTAIN') && styles.optionButtonSelected]}
                onPress={() => toggleOnboardingGoal('MAINTAIN')}
              >
                <Text style={styles.optionIcon}>➡️</Text>
                <Text style={styles.optionText}>Maintain</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionButton, onboardingGoals.includes('LOSE_FAT') && styles.optionButtonSelected]}
                onPress={() => toggleOnboardingGoal('LOSE_FAT')}
              >
                <Text style={styles.optionIcon}>📉</Text>
                <Text style={styles.optionText}>Lose Fat</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 9:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>8/15</Text>
            <Text style={styles.title}>How aggressive?</Text>
            <Text style={styles.note}>{getGoalModeLabel()}</Text>
            <View style={styles.optionGrid}>
              <TouchableOpacity style={[styles.optionButton, intensity === 'moderate' && styles.optionButtonSelected]} onPress={() => setIntensity('moderate')}>
                <Text style={styles.optionText}>Moderate</Text>
                <Text style={styles.optionSubtext}>Sustainable pace</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.optionButton, intensity === 'aggressive' && styles.optionButtonSelected]} onPress={() => setIntensity('aggressive')}>
                <Text style={styles.optionText}>Aggressive</Text>
                <Text style={styles.optionSubtext}>Faster changes</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.optionButton, intensity === 'extreme' && styles.optionButtonSelected]} onPress={() => setIntensity('extreme')}>
                <Text style={styles.optionText}>Extreme</Text>
                <Text style={styles.optionSubtext}>High intensity plan</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 10:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>9/15</Text>
            <Text style={styles.title}>Primary exercise type?</Text>
            <View style={styles.optionGrid}>
              <TouchableOpacity style={[styles.optionButton, exerciseType === 'lifting' && styles.optionButtonSelected]} onPress={() => setExerciseType('lifting')}>
                <Text style={styles.optionIcon}>💪</Text>
                <Text style={styles.optionText}>Lifting</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.optionButton, exerciseType === 'running' && styles.optionButtonSelected]} onPress={() => setExerciseType('running')}>
                <Text style={styles.optionIcon}>🏃</Text>
                <Text style={styles.optionText}>Running</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.optionButton, exerciseType === 'calisthenics' && styles.optionButtonSelected]} onPress={() => setExerciseType('calisthenics')}>
                <Text style={styles.optionIcon}>🤸</Text>
                <Text style={styles.optionText}>Calisthenics</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.optionButton, exerciseType === 'mixed' && styles.optionButtonSelected]} onPress={() => setExerciseType('mixed')}>
                <Text style={styles.optionIcon}>🔥</Text>
                <Text style={styles.optionText}>Mixed</Text>
              </TouchableOpacity>
            </View>
          </View>
        );

      case 11:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>10/15</Text>
            <Text style={styles.title}>Activity level?</Text>
            <Text style={styles.note}>Outside your formal workouts.</Text>
            {[
              { id: 'sedentary', title: 'Sedentary', desc: 'Desk job, little movement' },
              { id: 'light', title: 'Light Activity', desc: 'Some walking, light tasks' },
              { id: 'moderate', title: 'Moderate Activity', desc: 'Active job, frequent movement' },
              { id: 'very', title: 'Very Active', desc: 'Physical job, lots of movement' },
              { id: 'extra', title: 'Extra Active', desc: 'Labor job, constant movement' },
            ].map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.activityButton, activityLevel === (item.id as any) && styles.activityButtonSelected]}
                onPress={() => setActivityLevel(item.id as any)}
              >
                <Text style={styles.activityText}>{item.title}</Text>
                <Text style={styles.activitySubtext}>{item.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>
        );

      case 12:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>11/15</Text>
            <Text style={styles.title}>How Winning Days work</Text>
            <View style={styles.summaryCard}>
              <Text style={styles.optionText}>You win a day when you do at least one of these:</Text>
              <Text style={styles.note}>• Log a workout</Text>
              <Text style={styles.note}>• Hit active rest target</Text>
              <Text style={styles.note}>• Stay in calorie target window</Text>
            </View>
            <Text style={styles.note}>Winning Days power streaks, rank progress, and motivation.</Text>
          </View>
        );

      case 13:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>12/15</Text>
            <Text style={styles.title}>How ranks work</Text>
            <View style={styles.summaryCard}>
              <Text style={styles.optionText}>You move up through consistency tiers.</Text>
              <Text style={styles.note}>• Winning Days drive streak strength</Text>
              <Text style={styles.note}>• Streak quality drives rank progression</Text>
              <Text style={styles.note}>• Consistency beats one perfect day</Text>
            </View>
            <Text style={styles.note}>Ranks are motivation, not pressure. Keep stacking clean days.</Text>
          </View>
        );

      case 14:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>13/15</Text>
            <Text style={styles.title}>Impact Preview</Text>
            <View style={styles.summaryCard}>
              <Text style={styles.optionText}>Every log shows Before → After impact.</Text>
              <Text style={styles.note}>• Calories and protein movement</Text>
              <Text style={styles.note}>• Water and recovery status</Text>
              <Text style={styles.note}>• XP and Winning Day effect</Text>
            </View>
            <Text style={styles.note}>This keeps daily decisions clear without extra mental load.</Text>
          </View>
        );

      case 15: {
        const tdee = calculateTDEE();
        const targets = tdee ? calculateCalorieTargets(tdee) : null;
        const rec = computeRecommendedTargets({
          heightCm: getHeightCm(),
          weightKg: getWeightKg(),
          sexAtBirth: sex || 'unknown',
          activityLevel: activityLevel || 'moderate',
          onboardingGoals: getEffectiveGoals(),
          age: parseInt(age, 10),
        });
        const proteinTarget = Number(rec.proteinTargetG) || Math.max(100, Math.round(getWeightLbs() * 0.8));
        const waterTarget = Number(rec.waterTargetOz) || Number(waterGoal);
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>14/15</Text>
            <Text style={styles.title}>Your Plan</Text>
            {targets && (
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Daily Calories</Text>
                  <Text style={styles.summaryValue}>{targets.target}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Protein Target</Text>
                  <Text style={styles.summaryValue}>{proteinTarget} g</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Water Goal</Text>
                  <Text style={styles.summaryValue}>{waterTarget} oz</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Units</Text>
                  <Text style={styles.summaryValue}>{units === 'kg-ml' ? 'Metric' : 'Imperial'}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Starting XP</Text>
                  <Text style={styles.summaryValue}>+50 XP</Text>
                </View>
              </View>
            )}
            <Text style={styles.note}>Built from your profile with science-based defaults. You can edit everything later.</Text>
          </View>
        );
      }

      case 16: {
        const normalized = normalizeUsername(usernameInput);
        const existing = normalizeUsername(cloudProfile?.username || '');
        const handlePreview = normalized ? formatHandle(normalized) : existing ? formatHandle(existing) : '@unknown';
        const statusText =
          !normalized
            ? existing
              ? `Default handle reserved: ${formatHandle(existing)}`
              : hasSupabaseSession
              ? 'Restoring cloud profile…'
              : 'You can choose a handle later.'
            : usernameStatus === 'invalid'
            ? 'Invalid. Use 3-20 chars: a-z, 0-9, underscore, period.'
            : usernameStatus === 'cooldown'
            ? `You can change again on ${
                usernameCooldownUntil ? new Date(usernameCooldownUntil).toLocaleDateString() : 'a future date'
              }.`
            : usernameStatus === 'taken'
            ? 'Taken.'
            : usernameStatus === 'checking'
            ? 'Checking…'
            : usernameStatus === 'available'
            ? 'Available.'
            : ' ';

        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepNumber}>15/15</Text>
            <Text style={styles.title}>Choose a username</Text>
            <Text style={styles.subtitle}>This is your public handle in Community, Teams, and Leaderboards.</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. danker"
              placeholderTextColor="#555"
              value={usernameInput}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(t) => {
                setUsernameInput(t);
                setUsernameStatus('idle');
                setUsernameCooldownUntil(null);
              }}
            />
            <Text style={styles.note}>Preview: {handlePreview}</Text>
            <Text style={styles.note}>{statusText}</Text>
            <Text style={styles.note}>Allowed: a-z, 0-9, underscore, period. Stored without the @.</Text>
          </View>
        );
      }

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <View style={{ flex: 1 }}>
        <ZenithScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: footerHeight + 20 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          {renderStep()}
        </ZenithScrollView>

        <View
          style={[styles.footer, { bottom: keyboardInsetBottom }]}
          onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
        >
          {step > 1 && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                goToStep(step - 1);
              }}
            >
              <Text style={styles.backButtonText}>← Back</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.nextButton, !canProgress() && styles.nextButtonDisabled]}
            onPress={() => {
              if (step === 16) {
                void handleUsernameContinue();
                return;
              }
              if (step === 15) {
                goToStep(16);
                return;
              }
              goToStep(step + 1);
            }}
            disabled={!canProgress()}
          >
            <LinearGradient
              colors={canProgress() ? ['#00D9FF', '#8A2BE2'] : ['#2A2A2A', '#2A2A2A']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.nextGradient}
            >
              <Text style={styles.nextButtonText}>{step === 16 ? 'Continue' : step === 1 ? 'Get Started' : 'Next'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  stepContainer: { paddingVertical: 40 },
  logo: { fontSize: 80, textAlign: 'center', marginBottom: 20 },
  stepNumber: { fontSize: 14, color: '#666', marginBottom: 16 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 12 },
  subtitle: { fontSize: 18, color: '#888', lineHeight: 26, marginBottom: 12 },
  note: { fontSize: 14, color: '#666', marginTop: 8, marginBottom: 8 },
  input: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 18,
    fontSize: 18,
    color: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#2A2A2A',
    marginBottom: 16,
  },
  heightRow: { flexDirection: 'row', gap: 16 },
  heightInput: { flex: 1 },
  heightLabel: { fontSize: 14, color: '#666', marginTop: 8, textAlign: 'center' },
  optionGrid: { gap: 12 },
  optionButton: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#2A2A2A',
  },
  optionButtonSelected: { borderColor: '#00D9FF', backgroundColor: '#1A3A3A' },
  optionIcon: { fontSize: 48, marginBottom: 12 },
  optionText: { fontSize: 18, fontWeight: '600', color: '#FFFFFF', marginBottom: 4 },
  optionSubtext: { fontSize: 14, color: '#888' },
  activityButton: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 18,
    borderWidth: 2,
    borderColor: '#2A2A2A',
    marginBottom: 12,
  },
  activityButtonSelected: { borderColor: '#00D9FF', backgroundColor: '#1A3A3A' },
  activityText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 4 },
  activitySubtext: { fontSize: 14, color: '#888' },
  summaryCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: '#00D9FF',
    marginVertical: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  summaryLabel: { fontSize: 16, color: '#888' },
  summaryValue: { fontSize: 16, fontWeight: 'bold', color: '#00D9FF' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    backgroundColor: '#0A0A0A',
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
  },
  backButton: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: { fontSize: 16, fontWeight: 'bold', color: '#FFFFFF' },
  nextButton: { flex: 2 },
  nextButtonDisabled: { opacity: 0.5 },
  nextGradient: { borderRadius: 16, padding: 18, alignItems: 'center', justifyContent: 'center' },
  nextButtonText: { fontSize: 16, fontWeight: 'bold', color: '#FFFFFF', letterSpacing: 1 },
});
