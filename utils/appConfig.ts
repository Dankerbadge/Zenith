// App Configuration
// Central location for all app constants, settings, and feature flags

export const APP_CONFIG = {
  // App Info
  APP_NAME: 'Zenith',
  APP_VERSION: '1.3.1',
  APP_BUILD: '3',
  
  // Support
  SUPPORT_EMAIL: 'support@zenithfit.app',
  PRIVACY_URL: 'https://zenithfit.app/privacy',
  TERMS_URL: 'https://zenithfit.app/terms',
  
  // Pricing
  SUBSCRIPTION_MONTHLY_PRICE: 6.99,
  SUBSCRIPTION_YEARLY_PRICE: 49.99,
  LIFTING_PACK_PRICE: 4.99,
  RUNNING_PACK_PRICE: 4.99,
  CALISTHENICS_PACK_PRICE: 4.99,
  
  // Trial
  TRIAL_DAYS: 7,
  
  // XP System
  XP_DAILY_CAP: 50,
  XP_PER_WORKOUT: 15,
  XP_PER_MILE: 15,
  XP_ONBOARDING_BONUS: 50,
  
  // Winning Days
  WINNING_DAY_REQUIRES_WORKOUT: true,
  // Legacy flag: Winning Day logic lives in the Winning Day engine.
  // Keep false to prevent accidental reintroduction of nutrition-only shortcuts.
  WINNING_DAY_REQUIRES_CALORIES: false,
  WINNING_DAY_REQUIRES_ACTIVE_REST: false,
  
  // Notifications
  WATER_REMINDER_INTERVAL_DEFAULT: 120, // minutes
  WATER_REMINDER_START_DEFAULT: '08:00',
  WATER_REMINDER_END_DEFAULT: '22:00',
  STREAK_REMINDER_TIME_DEFAULT: '20:00',
  
  // Storage
  MAX_DAILY_LOGS_TO_KEEP: 365, // days
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes
  
  // GPS
  GPS_UPDATE_INTERVAL: 1000, // ms
  GPS_DISTANCE_THRESHOLD: 5, // meters
  GPS_MIN_ACCURACY: 50, // meters
  
  // Health
  RESTING_HR_DEFAULT: 60,
  MAX_HR_FORMULA: (age: number) => 220 - age,
  
  // Calorie Targets
  CALORIE_SAFETY_MIN_MALE: 1500,
  CALORIE_SAFETY_MIN_FEMALE: 1200,
  CALORIE_WINDOW: 100, // +/- for target
  
  // UI
  ANIMATION_DURATION: 300, // ms
  DEBOUNCE_DELAY: 300, // ms
  THROTTLE_DELAY: 1000, // ms

  // Live tracking calibration
  LIVE_TRACKING: {
    // Shared transparency threshold for post-session metric refinement note.
    REFINEMENT_DELTA_THRESHOLD_RATIO: 0.025,
    RUN: {
      GPS_STATE: {
        DEGRADED_AFTER_SEC: 8,
        LOST_AFTER_SEC: 25,
        RECOVER_FIX_STREAK: 2,
        GOOD_AFTER_STABLE_SEC: 10,
      },
      // Confidence thresholds (meters)
      CONFIDENCE_HIGH_ACCURACY_MAX: 12,
      CONFIDENCE_MEDIUM_ACCURACY_MAX: 28,
      // Outlier and spike rejection
      TELEPORT_MAX_SEGMENT_MILES: 0.18,
      TELEPORT_WINDOW_SEC: 5,
      OUTLIER_MAX_SPEED_MPS: 11.2,
      LOW_CONF_MAX_SPEED_MPS: 7.2,
      SPEED_RATIO_SPIKE_MAX: 2.6,
      SPEED_RATIO_SPIKE_WINDOW_SEC: 6,
      // Smoothing + pacing
      SMOOTH_WINDOW_ACCURACY: 7,
      SMOOTH_WINDOW_RESPONSIVE: 4,
      SMOOTH_ALPHA_ACCURACY: 0.26,
      SMOOTH_ALPHA_RESPONSIVE: 0.44,
      PACE_MIN_SPEED_MPS: 0.25,
      ACQUIRING_MIN_ACTIVE_SEC: 10,
      ACQUIRING_MIN_SAMPLES: 3,
      ROUTE_INCLUDE_MAX_ACCURACY_METERS: 70,
      // Sampling profiles
      SAMPLING: {
        PRECISION: { TIME_INTERVAL_MS: 800, DISTANCE_INTERVAL_M: 3 },
        BALANCED: { TIME_INTERVAL_MS: 1400, DISTANCE_INTERVAL_M: 6 },
        ECO: { TIME_INTERVAL_MS: 2200, DISTANCE_INTERVAL_M: 12 },
      },
      MAX_SPEED_MPS_REFINED: 8.8,
      ACCURACY_REJECT_METERS: 45,
      DISTANCE_CLAMP_LOW_RATIO: 0.92,
      DISTANCE_CLAMP_HIGH_RATIO: 1.08,
      GAP_ESTIMATION_MAX_SEC: 600,
      PR_MIN_DISTANCE_CONFIDENCE: 70,
    },
    HIIT: {
      WORK_SEC: 45,
      REST_SEC: 15,
    },
    MOBILITY: {
      MAX_CALORIES_PER_HOUR: 380,
    },
    SWIM: {
      MAX_SPEED_MPS_REFINED: 4.5,
      ACCURACY_REJECT_METERS: 60,
      STATIONARY_MAX_MILES: 0.003,
      STATIONARY_MIN_SEC: 8,
      DISTANCE_CLAMP_LOW_RATIO: 0.85,
      DISTANCE_CLAMP_HIGH_RATIO: 1.15,
    },
  },
  
  // Performance
  MAX_ASYNC_STORAGE_SIZE: 10 * 1024 * 1024, // 10MB
  WARNING_ASYNC_STORAGE_SIZE: 5 * 1024 * 1024, // 5MB
  
  // Ranks
  RANKS: [
    { name: 'Iron I', xp: 0, winningDays: 0, tier: 'Iron', icon: '⚙️' },
    { name: 'Iron II', xp: 150, winningDays: 3, tier: 'Iron', icon: '⚙️' },
    { name: 'Iron III', xp: 300, winningDays: 5, tier: 'Iron', icon: '⚙️' },
    { name: 'Iron IV', xp: 450, winningDays: 7, tier: 'Iron', icon: '⚙️' },
    { name: 'Bronze I', xp: 750, winningDays: 10, tier: 'Bronze', icon: '🥉' },
    { name: 'Bronze II', xp: 1100, winningDays: 14, tier: 'Bronze', icon: '🥉' },
    { name: 'Bronze III', xp: 1500, winningDays: 18, tier: 'Bronze', icon: '🥉' },
    { name: 'Bronze IV', xp: 2000, winningDays: 23, tier: 'Bronze', icon: '🥉' },
    { name: 'Silver I', xp: 2700, winningDays: 30, tier: 'Silver', icon: '🥈' },
    { name: 'Silver II', xp: 3500, winningDays: 38, tier: 'Silver', icon: '🥈' },
    { name: 'Silver III', xp: 4500, winningDays: 48, tier: 'Silver', icon: '🥈' },
    { name: 'Silver IV', xp: 5800, winningDays: 60, tier: 'Silver', icon: '🥈' },
    { name: 'Gold I', xp: 7500, winningDays: 75, tier: 'Gold', icon: '🥇' },
    { name: 'Gold II', xp: 9500, winningDays: 90, tier: 'Gold', icon: '🥇' },
    { name: 'Gold III', xp: 12000, winningDays: 105, tier: 'Gold', icon: '🥇' },
    { name: 'Gold IV', xp: 15000, winningDays: 120, tier: 'Gold', icon: '🥇' },
    { name: 'Platinum I', xp: 18500, winningDays: 140, tier: 'Platinum', icon: '💎' },
    { name: 'Platinum II', xp: 22500, winningDays: 160, tier: 'Platinum', icon: '💎' },
    { name: 'Platinum III', xp: 27000, winningDays: 180, tier: 'Platinum', icon: '💎' },
    { name: 'Platinum IV', xp: 32000, winningDays: 200, tier: 'Platinum', icon: '💎' },
    { name: 'Diamond I', xp: 38000, winningDays: 225, tier: 'Diamond', icon: '💠' },
    { name: 'Diamond II', xp: 45000, winningDays: 250, tier: 'Diamond', icon: '💠' },
    { name: 'Diamond III', xp: 53000, winningDays: 275, tier: 'Diamond', icon: '💠' },
    { name: 'Diamond IV', xp: 62000, winningDays: 300, tier: 'Diamond', icon: '💠' },
    { name: 'Zenith I', xp: 72000, winningDays: 330, tier: 'Zenith', icon: '⚡' },
    { name: 'Zenith II', xp: 85000, winningDays: 365, tier: 'Zenith', icon: '⚡' },
    { name: 'Zenith III', xp: 100000, winningDays: 400, tier: 'Zenith', icon: '⚡' },
  ],
  
  // Colors
  COLORS: {
    // Brand
    PRIMARY: '#00D9FF',
    SECONDARY: '#8A2BE2',
    ACCENT: '#00FF88',
    
    // Status
    SUCCESS: '#00FF88',
    WARNING: '#FFD700',
    ERROR: '#FF4466',
    INFO: '#00D9FF',
    
    // Neutral
    BLACK: '#0A0A0A',
    DARK: '#1A1A1A',
    GRAY: '#2A2A2A',
    LIGHT_GRAY: '#888',
    WHITE: '#FFFFFF',
    
    // Rank Colors
    IRON: '#808080',
    BRONZE: '#CD7F32',
    SILVER: '#C0C0C0',
    GOLD: '#FFD700',
    PLATINUM: '#E5E4E2',
    DIAMOND: '#B9F2FF',
    ZENITH: '#8A2BE2',
    
    // HR Zones
    ZONE_1: '#808080',
    ZONE_2: '#00D9FF',
    ZONE_3: '#00FF88',
    ZONE_4: '#FFD700',
    ZONE_5: '#FF4466',
  },
  
  // Feature Flags
  FEATURES: {
    MONETIZATION_ENABLED: true,
    SUBSCRIPTION_ENABLED: true,
    ONE_TIME_PACKS_ENABLED: true,
    HEALTH_INTEGRATION_ENABLED: true,
    NOTIFICATIONS_ENABLED: true,
    GPS_RUNNING_ENABLED: true,
    ACHIEVEMENTS_ENABLED: true,
    CLOUD_SYNC_ENABLED: true, // Enabled: local queue + Supabase snapshot sync
    // Social is active. All social surfaces must be backed by Supabase (no seed/mock people/posts).
    SOCIAL_FEATURES_ENABLED: true,
    // Apple Watch internal beta: enable only for TestFlight/internal testers until real-device Gate 5 passes.
    APPLE_WATCH_ENABLED: true,
    GARMIN_CONNECT_ENABLED: true, // In development; watch app distribution and companion bridge are staged
    GARMIN_IOS_COMPANION_ENABLED: true, // Native companion bridge enabled
    GARMIN_ANDROID_COMPANION_ENABLED: true, // Android companion bridge enabled
    GARMIN_PREMIUM_SYNC_ENABLED: true, // Entitlement propagation from mobile app is enabled
    LIVE_HIIT_ENABLED: true,
    LIVE_MOBILITY_ENABLED: true,
    LIVE_SWIM_ENABLED: true,
    FF_RETENTION_WINDOW_ENFORCEMENT_ENABLED: false,
    FF_NOTIFICATION_CONSENT_ENABLED: false,
    FF_ANALYTICS_MINIMIZATION_ENABLED: false,
    FF_PUBLIC_SHARE_GUARD_ENABLED: false,
    FF_PRIVACY_UI_ENABLED: false,
    FF_USER_VISIBLE_DATA_EXPLANATIONS_ENABLED: false,
  },

  // Runtime feature overrides (internal/TestFlight builds only).
  // These are still supported for internal builds, but defaults should be safe even without overrides.
  RUNTIME: (() => {
    const readBool = (value: unknown) => {
      const v = String(value ?? '').trim().toLowerCase();
      return v === '1' || v === 'true' || v === 'yes' || v === 'on';
    };
    const env = (key: string) => {
      try {
        return (globalThis as any)?.process?.env?.[key];
      } catch {
        return undefined;
      }
    };

    const devBuild = typeof __DEV__ !== 'undefined' && Boolean(__DEV__);
    const internalBuild = devBuild || readBool(env('EXPO_PUBLIC_ZENITH_INTERNAL_BUILD'));
    const socialOverride = internalBuild && readBool(env('EXPO_PUBLIC_ZENITH_ENABLE_SOCIAL'));
    const demoMode = readBool(env('EXPO_PUBLIC_DEMO_MODE'));

    // Safety: demo mode must never ship in production builds.
    // If this is enabled accidentally, crash early so fake data can never reach users.
    if (!devBuild && demoMode) {
      throw new Error('[config] DEMO_MODE enabled in production build. Refusing to launch.');
    }

    return {
      INTERNAL_BUILD: internalBuild,
      DEV_BUILD: devBuild,
      OVERRIDES: {
        SOCIAL_FEATURES_ENABLED: socialOverride,
      },
    };
  })(),
  
  // Analytics Events (for future analytics integration)
  ANALYTICS_EVENTS: {
    // Onboarding
    ONBOARDING_STARTED: 'onboarding_started',
    ONBOARDING_COMPLETED: 'onboarding_completed',
    
    // Workouts
    WORKOUT_LOGGED: 'workout_logged',
    RUN_STARTED: 'run_started',
    RUN_COMPLETED: 'run_completed',
    
    // Nutrition
    FOOD_LOGGED: 'food_logged',
    WEIGHT_LOGGED: 'weight_logged',
    
    // Gamification
    ACHIEVEMENT_UNLOCKED: 'achievement_unlocked',
    RANK_UP: 'rank_up',
    WINNING_DAY: 'winning_day',
    STREAK_MILESTONE: 'streak_milestone',
    
    // Monetization
    STORE_VIEWED: 'store_viewed',
    PACK_PURCHASED: 'pack_purchased',
    SUBSCRIPTION_STARTED: 'subscription_started',
    TRIAL_STARTED: 'trial_started',
    
    // Engagement
    APP_OPENED: 'app_opened',
    NOTIFICATION_RECEIVED: 'notification_received',
    NOTIFICATION_CLICKED: 'notification_clicked',
  },
};

// MET Values for different activities
export const MET_VALUES: { [key: string]: number } = {
  // Cardio
  'Walking': 3.5,
  'Running': 9.8,
  'Cycling': 7.5,
  'Swimming': 8.0,
  'Rowing': 6.0,
  'Elliptical': 5.0,
  
  // Strength
  'Lifting': 6.0,
  'Bodyweight': 4.5,
  'Circuit Training': 7.0,
  
  // Sports
  'Basketball': 8.0,
  'Soccer': 10.0,
  'Tennis': 7.0,
  'Boxing': 12.0,
  
  // Low Intensity
  'Yoga': 2.5,
  'Stretching': 2.0,
  'Walking (slow)': 2.5,
};

// Default user preferences
export const DEFAULT_PREFERENCES = {
  notifications: {
    enabled: false,
    streakReminders: false,
    streakReminderTime: '20:00',
    winningDayPrompts: false,
    waterReminders: false,
    waterReminderInterval: 120,
    waterReminderStart: '08:00',
    waterReminderEnd: '22:00',
    rankUpCelebrations: false,
    achievementUnlocks: false,
    workoutSuggestions: false,
    recoveryAlerts: false,
  },
  theme: 'dark', // Future: light/dark/auto
  units: 'imperial', // imperial/metric
  startOfWeek: 'monday', // monday/sunday
};

// API endpoints (for future backend integration)
export const API_ENDPOINTS = {
  BASE_URL: 'https://api.zenithfit.app',
  AUTH: '/auth',
  SYNC: '/sync',
  ANALYTICS: '/analytics',
  SUPPORT: '/support',
};

// Export as default for easy importing
export default APP_CONFIG;
