// Notification Service
// Smart notifications that adapt to user behavior
// Types: Streak reminders, winning day prompts, water reminders, rank ups, achievements

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDailyLog, getUserProfile, todayKey } from './storageUtils';
import { getWinningSnapshot } from './winningSystem';
import { captureException } from './crashReporter';
import { getLocalPrivacyConsentSnapshot } from './privacyConsentStore';
import { APP_CONFIG } from './appConfig';

function reportNotificationError(op: string, error: unknown) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[notifications] ${op} error:`, error);
    return;
  }
  void captureException(error, { feature: 'notifications', op });
}

let notificationConsentCache = false;
let notificationConsentCheckedAt = 0;
const NOTIFICATION_CONSENT_CACHE_MS = 60_000;

async function hasNotificationConsent() {
  if (!APP_CONFIG.FEATURES.FF_NOTIFICATION_CONSENT_ENABLED) {
    return true;
  }
  const now = Date.now();
  if (now - notificationConsentCheckedAt <= NOTIFICATION_CONSENT_CACHE_MS) {
    return notificationConsentCache;
  }
  notificationConsentCheckedAt = now;
  try {
    const snapshot = await getLocalPrivacyConsentSnapshot();
    notificationConsentCache = snapshot.notifications === true;
  } catch {
    notificationConsentCache = false;
  }
  return notificationConsentCache;
}

export interface NotificationPreferences {
  enabled: boolean;
  streakReminders: boolean;
  streakReminderTime: string; // HH:MM format
  logBeforeMidnightNudge: boolean;
  logBeforeMidnightTime: string; // HH:MM
  winningDayPrompts: boolean;
  waterReminders: boolean;
  waterReminderInterval: number; // minutes
  waterReminderStart: string; // HH:MM
  waterReminderEnd: string; // HH:MM
  quietHoursEnabled: boolean;
  quietHoursStart: string; // HH:MM
  quietHoursEnd: string; // HH:MM
  rankUpCelebrations: boolean;
  achievementUnlocks: boolean;
  workoutSuggestions: boolean;
  recoveryAlerts: boolean;
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function isWithinQuietHours(totalMinutes: number, prefs: NotificationPreferences): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const start = parseTimeToMinutes(prefs.quietHoursStart);
  const end = parseTimeToMinutes(prefs.quietHoursEnd);
  if (start === end) return true;
  if (start < end) return totalMinutes >= start && totalMinutes < end;
  return totalMinutes >= start || totalMinutes < end; // overnight window
}

function getFirstMinuteAfterQuiet(prefs: NotificationPreferences): number {
  return parseTimeToMinutes(prefs.quietHoursEnd);
}

function normalizeTimeForQuietHours(time: string, prefs: NotificationPreferences): { hour: number; minute: number } {
  const minutes = parseTimeToMinutes(time);
  if (!isWithinQuietHours(minutes, prefs)) {
    return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
  }
  const adjusted = getFirstMinuteAfterQuiet(prefs);
  return { hour: Math.floor(adjusted / 60), minute: adjusted % 60 };
}

async function cancelScheduledByType(type: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notif of scheduled) {
    if (notif.content.data?.type === type) {
      await Notifications.cancelScheduledNotificationAsync(notif.identifier);
    }
  }
}

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Read notification permission status without prompting the user.
 */
export async function getNotificationPermissionStatus(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    reportNotificationError('get_permission_status', error);
    return false;
  }
}

/**
 * Request notification permissions
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      return false;
    }
    
    // Get push token for future use
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#00D9FF',
      });
    }
    
    return true;
  } catch (error) {
    reportNotificationError('request_permissions', error);
    return false;
  }
}

/**
 * Schedule streak reminder notification
 * Triggers if user hasn't logged anything today
 */
export async function scheduleStreakReminder(
  currentStreak: number,
  reminderTime: string = '20:00',
  prefs?: NotificationPreferences
): Promise<void> {
  try {
    if (!(await hasNotificationConsent())) return;
    // Cancel existing streak reminders
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      if (notif.content.data?.type === 'streak_reminder') {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }

    const effectivePrefs = prefs || (await loadNotificationPreferences());
    const { hour: hours, minute: minutes } = normalizeTimeForQuietHours(reminderTime, effectivePrefs);
    const now = new Date();
    const trigger = new Date();
    trigger.setHours(hours, minutes, 0, 0);
    
    // If time has passed today, schedule for tomorrow
    if (trigger <= now) {
      trigger.setDate(trigger.getDate() + 1);
    }

    const messages = [
      `🔥 ${currentStreak} days logged. Add today's activity when you're ready.`,
      `💪 ${currentStreak}-day consistency. A quick check-in keeps your log current.`,
      `⚡ ${currentStreak} days so far. Want to add a short workout or meal log?`,
      `🏆 ${currentStreak}-day progress. A 5-minute update still counts.`,
    ];

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${currentStreak}-Day Progress Check-In`,
        body: messages[Math.floor(Math.random() * messages.length)],
        data: { type: 'streak_reminder', streak: currentStreak },
        sound: true,
        badge: 1,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: hours,
        minute: minutes,
      },
    });
  } catch (error) {
    reportNotificationError('schedule_streak_reminder', error);
  }
}

/**
 * Schedule winning day prompt
 * Triggers mid-day if user is close to winning
 */
export async function scheduleWinningDayPrompt(): Promise<void> {
  try {
    if (!(await hasNotificationConsent())) return;
    const today = new Date().toISOString().split('T')[0];
    const dailyLog = await AsyncStorage.getItem('dailyLog_' + today);
    
    if (!dailyLog) return;
    
    const log = JSON.parse(dailyLog);
    const hasWorkout = log.workouts && log.workouts.length > 0;
    const hasActiveRest = log.activeRest && log.activeRest.length > 0;
    const onTarget = log.calories >= log.calorieMin && log.calories <= log.calorieMax;
    
    // If already winning, send encouragement
    if (hasWorkout || hasActiveRest || onTarget) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "✅ You're Winning Today!",
          body: "Keep up the momentum. You're crushing it! 💪",
          data: { type: 'winning_day_encouragement' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 5,
        },
      });
      return;
    }
    
    // If not winning, send prompt
    const needsWorkout = !hasWorkout && !hasActiveRest;
    const needsCalories = !onTarget;
    
    let message = '';
    if (needsWorkout && needsCalories) {
      message = "Log a workout or add meals to complete today's check-in.";
    } else if (needsWorkout) {
      message = "A quick workout can complete today's check-in.";
    } else if (needsCalories) {
      message = "Add meals now to keep today's nutrition log current.";
    }
    
    if (message) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Today Check-In Available',
          body: message,
          data: { type: 'winning_day_prompt' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 5,
        },
      });
    }
  } catch (error) {
    reportNotificationError('schedule_winning_day_prompt', error);
  }
}

/**
 * Schedule water reminders
 * Smart scheduling based on user's active hours
 */
export async function scheduleWaterReminders(
  interval: number = 120, // minutes
  startTime: string = '08:00',
  endTime: string = '22:00',
  prefs?: NotificationPreferences
): Promise<void> {
  try {
    if (!(await hasNotificationConsent())) return;
    // Cancel existing water reminders
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      if (notif.content.data?.type === 'water_reminder') {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }

    const effectivePrefs = prefs || (await loadNotificationPreferences());
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);
    
    // Calculate number of reminders
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const totalMinutes = endMinutes - startMinutes;
    const reminderCount = Math.floor(totalMinutes / interval);
    
    const messages = [
      "💧 Hydration check! Time for some water.",
      "🚰 Stay hydrated! Drink up.",
      "💦 Your body needs water. Quick sip?",
      "🌊 Hydration reminder! Keep those gains.",
      "💧 Water break! Your muscles will thank you.",
    ];

    // Schedule each reminder
    for (let i = 0; i <= reminderCount; i++) {
      const minutesFromStart = i * interval;
      const totalMins = startMinutes + minutesFromStart;
      const hour = Math.floor(totalMins / 60);
      const minute = totalMins % 60;
      if (isWithinQuietHours(totalMins, effectivePrefs)) continue;
      
      if (hour >= endHour && minute > endMin) break;
      
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Water Reminder",
          body: messages[i % messages.length],
          data: { type: 'water_reminder' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
        },
      });
    }
  } catch (error) {
    reportNotificationError('schedule_water_reminders', error);
  }
}

/**
 * Schedule nightly "log before midnight" nudge.
 */
export async function scheduleLogBeforeMidnightNudge(
  nudgeTime: string = '21:30',
  prefs?: NotificationPreferences
): Promise<void> {
  try {
    if (!(await hasNotificationConsent())) return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      if (notif.content.data?.type === 'log_before_midnight') {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }

    const effectivePrefs = prefs || (await loadNotificationPreferences());
    const { hour, minute } = normalizeTimeForQuietHours(nudgeTime, effectivePrefs);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⏰ Log before midnight',
        body: "Quick check-in now keeps today's log up to date.",
        data: { type: 'log_before_midnight' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
  } catch (error) {
    reportNotificationError('schedule_midnight_nudge', error);
  }
}

/**
 * Evaluate today's context and schedule non-spammy nudges.
 */
export async function scheduleContextualNudges(): Promise<void> {
  try {
    if (!(await hasNotificationConsent())) return;
    const prefs = await loadNotificationPreferences();
    if (!prefs.enabled) return;

    const [todayLog, profile, snapshot] = await Promise.all([
      getDailyLog(todayKey()),
      getUserProfile(),
      getWinningSnapshot(),
    ]);

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const caloriesTarget = Number((profile as any)?.goals?.caloriesTarget) || undefined;
    const waterTarget = Number((profile as any)?.goals?.waterTargetOz) || 120;
    const currentWater = Number(todayLog.water) || 0;
    const currentCalories = Number(todayLog.calories) || 0;
    const onTargetCalories =
      typeof caloriesTarget === 'number' && caloriesTarget > 0
        ? Math.abs(currentCalories - caloriesTarget) <= 150
        : false;
    const hasWorkout = Array.isArray(todayLog.workouts) && todayLog.workouts.length > 0;
    const hasRest = Array.isArray(todayLog.activeRest) && todayLog.activeRest.length > 0;
    const winningToday = hasWorkout || hasRest || onTargetCalories;

    await cancelScheduledByType('water_deficit_nudge');
    if (prefs.waterReminders && currentWater < waterTarget * 0.55 && !isWithinQuietHours(nowMinutes, prefs)) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '💧 Hydration check',
          body: `You are ${Math.max(0, Math.round(waterTarget - currentWater))} oz from your goal.`,
          data: { type: 'water_deficit_nudge' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 20 },
      });
    }

    await cancelScheduledByType('streak_risk_nudge');
    const streakReminderMinutes = parseTimeToMinutes(prefs.streakReminderTime);
    const nearStreakWindow = nowMinutes >= Math.max(0, streakReminderMinutes - 120);
    if (prefs.streakReminders && !winningToday && nearStreakWindow && snapshot.currentStreak > 0 && !isWithinQuietHours(nowMinutes, prefs)) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `🔥 ${snapshot.currentStreak}-day consistency check-in`,
          body: 'Log one action now to keep your daily history complete.',
          data: { type: 'streak_risk_nudge' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 30 },
      });
    }

    await cancelScheduledByType('log_reminder_nudge');
    const logNudgeMinutes = parseTimeToMinutes(prefs.logBeforeMidnightTime);
    if (prefs.logBeforeMidnightNudge && !winningToday && nowMinutes >= logNudgeMinutes && !isWithinQuietHours(nowMinutes, prefs)) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⏰ Quick log reminder',
          body: "A quick log now updates today's record.",
          data: { type: 'log_reminder_nudge' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 40 },
      });
    }
  } catch (error) {
    reportNotificationError('schedule_contextual_nudges', error);
  }
}

/**
 * Send rank up celebration
 * Immediate notification when user ranks up
 */
export async function sendRankUpNotification(
  newRank: string,
  xpEarned: number
): Promise<void> {
  try {
    if (!(await hasNotificationConsent())) return;
    const rankEmojis: { [key: string]: string } = {
      'Iron': '⚙️',
      'Bronze': '🥉',
      'Silver': '🥈',
      'Gold': '🥇',
      'Platinum': '💎',
      'Diamond': '💠',
      'Zenith': '⚡'
    };
    
    const tier = newRank.split(' ')[0];
    const emoji = rankEmojis[tier] || '🏆';
    
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${emoji} RANK UP!`,
        body: `Congratulations! You've reached ${newRank}! Keep climbing! 🚀`,
        data: { type: 'rank_up', rank: newRank, xp: xpEarned },
        sound: true,
        badge: 1,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
      },
    });
  } catch (error) {
    reportNotificationError('send_rank_up', error);
  }
}

/**
 * Send achievement unlock notification
 */
export async function sendAchievementNotification(
  achievementName: string,
  achievementIcon: string,
  xpReward: number
): Promise<void> {
  try {
    if (!(await hasNotificationConsent())) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${achievementIcon} Achievement Unlocked!`,
        body: `${achievementName} - You earned ${xpReward} XP!`,
        data: { type: 'achievement_unlock', name: achievementName, xp: xpReward },
        sound: true,
        badge: 1,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
      },
    });
  } catch (error) {
    reportNotificationError('send_achievement', error);
  }
}

/**
 * Send workout suggestion based on time of day and habits
 */
export async function sendWorkoutSuggestion(
  preferredType: string,
  lastWorkoutDays: number
): Promise<void> {
  try {
    if (!(await hasNotificationConsent())) return;
    const hour = new Date().getHours();
    let timeMessage = '';
    
    if (hour >= 5 && hour < 9) {
      timeMessage = "Morning energy boost?";
    } else if (hour >= 12 && hour < 14) {
      timeMessage = "Lunch break workout?";
    } else if (hour >= 17 && hour < 20) {
      timeMessage = "Evening training session?";
    } else {
      return; // Don't suggest outside typical workout times
    }
    
    const suggestions: { [key: string]: string } = {
      'lifting': '💪 Quick strength session',
      'running': '🏃 Easy run to clear your mind',
      'calisthenics': '🤸 Bodyweight flow',
      'mixed': '🔥 HIIT to get the heart pumping'
    };
    
    const suggestion = suggestions[preferredType] || '💪 Quick workout';
    
    await Notifications.scheduleNotificationAsync({
      content: {
        title: timeMessage,
        body: `${suggestion} - It's been ${lastWorkoutDays} days!`,
        data: { type: 'workout_suggestion', preferredType },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
      },
    });
  } catch (error) {
    reportNotificationError('send_workout_suggestion', error);
  }
}

/**
 * Send recovery alert based on HRV/recovery score
 */
export async function sendRecoveryAlert(
  recoveryScore: number,
  recommendation: string
): Promise<void> {
  try {
    if (!(await hasNotificationConsent())) return;
    if (recoveryScore >= 70) return; // Only alert if recovery is moderate/low
    
    const emoji = recoveryScore >= 40 ? '⚠️' : '🔴';
    const title = recoveryScore >= 40 ? 'Moderate Recovery' : 'Low Recovery Detected';
    
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${emoji} ${title}`,
        body: recommendation,
        data: { type: 'recovery_alert', score: recoveryScore },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
      },
    });
  } catch (error) {
    reportNotificationError('send_recovery_alert', error);
  }
}

/**
 * Schedule daily check-in notification
 * Smart time based on user's typical workout time
 */
export async function scheduleDailyCheckIn(
  preferredTime: string = '18:00'
): Promise<void> {
  try {
    if (!(await hasNotificationConsent())) return;
    const [hours, minutes] = preferredTime.split(':').map(Number);
    
    const messages = [
      "How was your day? Log your progress! 📊",
      "Time to update your stats! 💪",
      "Check in with your fitness journey! 🎯",
      "Log today's wins! Every bit counts! ⚡",
    ];
    
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Daily Check-In",
        body: messages[new Date().getDay() % messages.length],
        data: { type: 'daily_checkin' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: hours,
        minute: minutes,
      },
    });
  } catch (error) {
    reportNotificationError('schedule_daily_check_in', error);
  }
}

/**
 * Cancel all scheduled notifications
 */
export async function cancelAllNotifications(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (error) {
    reportNotificationError('cancel_all', error);
  }
}

/**
 * Get all scheduled notifications (for debugging)
 */
export async function getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
  try {
    return await Notifications.getAllScheduledNotificationsAsync();
  } catch (error) {
    reportNotificationError('get_scheduled', error);
    return [];
  }
}

/**
 * Load notification preferences
 */
export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const prefs = await AsyncStorage.getItem('notificationPreferences');
    if (prefs) {
      return JSON.parse(prefs);
    }
    
    // Default preferences
    return {
      enabled: false,
      streakReminders: false,
      streakReminderTime: '20:00',
      logBeforeMidnightNudge: false,
      logBeforeMidnightTime: '21:30',
      winningDayPrompts: false,
      waterReminders: false,
      waterReminderInterval: 120,
      waterReminderStart: '08:00',
      waterReminderEnd: '22:00',
      quietHoursEnabled: true,
      quietHoursStart: '22:30',
      quietHoursEnd: '07:00',
      rankUpCelebrations: false,
      achievementUnlocks: false,
      workoutSuggestions: false,
      recoveryAlerts: false,
    };
  } catch (error) {
    reportNotificationError('load_preferences', error);
    return {
      enabled: false,
      streakReminders: false,
      streakReminderTime: '20:00',
      logBeforeMidnightNudge: false,
      logBeforeMidnightTime: '21:30',
      winningDayPrompts: false,
      waterReminders: false,
      waterReminderInterval: 120,
      waterReminderStart: '08:00',
      waterReminderEnd: '22:00',
      quietHoursEnabled: true,
      quietHoursStart: '22:30',
      quietHoursEnd: '07:00',
      rankUpCelebrations: false,
      achievementUnlocks: false,
      workoutSuggestions: false,
      recoveryAlerts: false,
    };
  }
}

/**
 * Save notification preferences
 */
export async function saveNotificationPreferences(
  prefs: NotificationPreferences
): Promise<void> {
  try {
    await AsyncStorage.setItem('notificationPreferences', JSON.stringify(prefs));
    
    // Reschedule notifications based on new preferences
    await cancelAllNotifications();
    
    if (!prefs.enabled) return;

    if (!(await hasNotificationConsent())) return;

    const permissionGranted = await getNotificationPermissionStatus();
    if (!permissionGranted) return;
    
    if (prefs.streakReminders) {
      await scheduleStreakReminder(1, prefs.streakReminderTime, prefs);
    }

    if (prefs.logBeforeMidnightNudge) {
      await scheduleLogBeforeMidnightNudge(prefs.logBeforeMidnightTime, prefs);
    }

    if (prefs.waterReminders) {
      await scheduleWaterReminders(
        prefs.waterReminderInterval,
        prefs.waterReminderStart,
        prefs.waterReminderEnd,
        prefs
      );
    }
    
    // Other notifications are triggered by events, not scheduled
  } catch (error) {
    reportNotificationError('save_preferences', error);
  }
}
