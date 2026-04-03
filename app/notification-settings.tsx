import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, Switch, Pressable, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import FlameMark from '../components/icons/FlameMark';
import {
  NotificationPreferences,
  getNotificationPermissionStatus,
  requestNotificationPermissions,
  loadNotificationPreferences,
  saveNotificationPreferences,
  getScheduledNotifications
} from '../utils/notificationService';
import { captureException } from '../utils/crashReporter';

export default function NotificationSettingsScreen() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const prefs = await loadNotificationPreferences();
      setPreferences(prefs);

      const granted = await getNotificationPermissionStatus();
      setHasPermission(granted);

      const scheduled = await getScheduledNotifications();
      setScheduledCount(scheduled.length);
      setLoadError(false);
    } catch (err) {
      setLoadError(true);
      void captureException(err, { feature: 'notification_settings', op: 'load' });
    }
  };

  const handleToggle = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!preferences) return;

    if (key === 'enabled' && value && !hasPermission) {
      try {
        const granted = await requestNotificationPermissions();
        setHasPermission(granted);
        if (!granted) {
          Alert.alert(
            'Permission required',
            'Enable notifications in your device settings first, then turn reminders on.',
            [{ text: 'OK' }]
          );
          return;
        }
      } catch (err) {
        Alert.alert('Permission check failed', 'Could not request notification permissions. Try again.');
        void captureException(err, { feature: 'notification_settings', op: 'toggle_request_permissions' });
        return;
      }
    }
    
    const previous = preferences;
    const updated = { ...preferences, [key]: value };
    setPreferences(updated);
    try {
      await saveNotificationPreferences(updated);
      const scheduled = await getScheduledNotifications();
      setScheduledCount(scheduled.length);
    } catch (err) {
      setPreferences(previous);
      Alert.alert('Save failed', 'Could not update notification settings. Please try again.');
      void captureException(err, { feature: 'notification_settings', op: 'toggle' });
    }
  };

  const handleTimeChange = (
    key:
      | 'streakReminderTime'
      | 'logBeforeMidnightTime'
      | 'waterReminderStart'
      | 'waterReminderEnd'
      | 'quietHoursStart'
      | 'quietHoursEnd',
    time: string
  ) => {
    if (!preferences) return;
    
    const previous = preferences;
    const updated = { ...preferences, [key]: time };
    setPreferences(updated);
    void saveNotificationPreferences(updated).catch((err) => {
      setPreferences(previous);
      Alert.alert('Save failed', 'Could not update notification time. Please try again.');
      void captureException(err, { feature: 'notification_settings', op: 'time_change' });
    });
  };

  const handleIntervalChange = (interval: number) => {
    if (!preferences) return;
    
    const previous = preferences;
    const updated = { ...preferences, waterReminderInterval: interval };
    setPreferences(updated);
    void saveNotificationPreferences(updated).catch((err) => {
      setPreferences(previous);
      Alert.alert('Save failed', 'Could not update reminder interval. Please try again.');
      void captureException(err, { feature: 'notification_settings', op: 'interval_change' });
    });
  };

  const requestPermissions = async () => {
    try {
      const granted = await requestNotificationPermissions();
      setHasPermission(granted);

      if (!granted) {
        Alert.alert(
          'Permission Denied',
          'Please enable notifications in your device settings to receive reminders and updates.',
          [{ text: 'OK' }]
        );
      }
    } catch (err) {
      Alert.alert('Permission check failed', 'Could not check notification permissions. Try again.');
      void captureException(err, { feature: 'notification_settings', op: 'request_permissions' });
    }
  };

  if (!preferences) {
    return (
      <SafeAreaView style={[styles.container, styles.centerContent]} edges={['top', 'bottom', 'left', 'right']}>
        {loadError ? (
          <>
            <Text style={styles.errorText}>Couldn’t load notification settings</Text>
            <Pressable
              style={styles.retryButton}
              onPress={() => {
                setLoadError(false);
                void loadSettings();
              }}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
            <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
              <Text style={styles.retryText}>Go back</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.loadingText}>Loading settings...</Text>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Notifications</Text>
          {scheduledCount > 0 && (
            <View style={styles.scheduledBadge}>
              <Text style={styles.scheduledText}>{scheduledCount} active</Text>
            </View>
          )}
          {scheduledCount <= 0 && (
            <View style={styles.headerSpacer} />
          )}
        </View>

        {/* Permission Status */}
        {!hasPermission && (
          <Pressable style={styles.permissionBanner} onPress={requestPermissions}>
            <LinearGradient
              colors={['#FF446620', '#FF880020']}
              style={styles.permissionGradient}
            >
              <Text style={styles.permissionIcon}>⚠️</Text>
              <View style={styles.permissionContent}>
                <Text style={styles.permissionTitle}>Notifications Disabled</Text>
                <Text style={styles.permissionText}>
                  Tap to enable notifications and never miss a reminder
                </Text>
              </View>
            </LinearGradient>
          </Pressable>
        )}

        {/* Master Toggle */}
        <View style={styles.section}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>Enable All Notifications</Text>
              <Text style={styles.settingDescription}>
                Master switch for all reminders and alerts
              </Text>
            </View>
            <Switch
              value={preferences.enabled}
              onValueChange={(val) => handleToggle('enabled', val)}
              trackColor={{ false: '#2A2A2A', true: '#00D9FF' }}
              thumbColor={preferences.enabled ? '#FFFFFF' : '#888'}
            />
          </View>
        </View>

        {/* Streak Reminders */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>STREAK PROTECTION</Text>
          
          <View style={styles.card}>
              <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <View style={styles.settingTitleRow}>
                  <FlameMark size={14} color="#FF9F0A" />
                  <Text style={styles.settingTitle}>Streak Reminders</Text>
                </View>
                <Text style={styles.settingDescription}>
                  Daily reminder if you have not logged activity
                </Text>
              </View>
              <Switch
                value={preferences.streakReminders}
                onValueChange={(val) => handleToggle('streakReminders', val)}
                trackColor={{ false: '#2A2A2A', true: '#00D9FF' }}
                thumbColor={preferences.streakReminders ? '#FFFFFF' : '#888'}
                disabled={!preferences.enabled}
              />
            </View>

            {preferences.streakReminders && (
              <View style={styles.subSetting}>
                <Text style={styles.subSettingLabel}>Reminder Time</Text>
                <View style={styles.timeButtons}>
                  {['18:00', '19:00', '20:00', '21:00'].map(time => (
                    <Pressable
                      key={time}
                      style={[
                        styles.timeButton,
                        preferences.streakReminderTime === time && styles.timeButtonActive
                      ]}
                      onPress={() => handleTimeChange('streakReminderTime', time)}
                    >
                      <Text style={[
                        styles.timeButtonText,
                        preferences.streakReminderTime === time && styles.timeButtonTextActive
                      ]}>
                        {time}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <View style={[styles.settingRow, styles.settingRowLast]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>🌙 Log Before Midnight</Text>
                <Text style={styles.settingDescription}>
                  End-of-day nudge if you still need to log
                </Text>
              </View>
              <Switch
                value={preferences.logBeforeMidnightNudge}
                onValueChange={(val) => handleToggle('logBeforeMidnightNudge', val)}
                trackColor={{ false: '#2A2A2A', true: '#00D9FF' }}
                thumbColor={preferences.logBeforeMidnightNudge ? '#FFFFFF' : '#888'}
                disabled={!preferences.enabled}
              />
            </View>

            {preferences.logBeforeMidnightNudge && (
              <View style={styles.subSetting}>
                <Text style={styles.subSettingLabel}>Nudge Time</Text>
                <View style={styles.timeButtons}>
                  {['20:30', '21:00', '21:30', '22:00'].map(time => (
                    <Pressable
                      key={time}
                      style={[
                        styles.timeButton,
                        preferences.logBeforeMidnightTime === time && styles.timeButtonActive
                      ]}
                      onPress={() => handleTimeChange('logBeforeMidnightTime', time)}
                    >
                      <Text style={[
                        styles.timeButtonText,
                        preferences.logBeforeMidnightTime === time && styles.timeButtonTextActive
                      ]}>
                        {time}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Winning Day Prompts */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>MOTIVATION</Text>
          
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>✅ Winning Day Prompts</Text>
                <Text style={styles.settingDescription}>
                  Smart reminders to help you win each day
                </Text>
              </View>
              <Switch
                value={preferences.winningDayPrompts}
                onValueChange={(val) => handleToggle('winningDayPrompts', val)}
                trackColor={{ false: '#2A2A2A', true: '#00D9FF' }}
                thumbColor={preferences.winningDayPrompts ? '#FFFFFF' : '#888'}
                disabled={!preferences.enabled}
              />
            </View>
          </View>
        </View>

        {/* Water Reminders */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>HYDRATION</Text>
          
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>💧 Water Reminders</Text>
                <Text style={styles.settingDescription}>
                  Regular hydration reminders throughout the day
                </Text>
              </View>
              <Switch
                value={preferences.waterReminders}
                onValueChange={(val) => handleToggle('waterReminders', val)}
                trackColor={{ false: '#2A2A2A', true: '#00D9FF' }}
                thumbColor={preferences.waterReminders ? '#FFFFFF' : '#888'}
                disabled={!preferences.enabled}
              />
            </View>

            {preferences.waterReminders && (
              <>
                <View style={styles.subSetting}>
                  <Text style={styles.subSettingLabel}>Reminder Interval</Text>
                  <View style={styles.timeButtons}>
                    {[60, 90, 120, 180].map(interval => (
                      <Pressable
                        key={interval}
                        style={[
                          styles.timeButton,
                          preferences.waterReminderInterval === interval && styles.timeButtonActive
                        ]}
                        onPress={() => handleIntervalChange(interval)}
                      >
                        <Text style={[
                          styles.timeButtonText,
                          preferences.waterReminderInterval === interval && styles.timeButtonTextActive
                        ]}>
                          {interval}m
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.subSetting}>
                  <Text style={styles.subSettingLabel}>Active Hours</Text>
                  <View style={styles.timeRange}>
                    <View style={styles.timeRangeItem}>
                      <Text style={styles.timeRangeLabel}>Start</Text>
                      <Text style={styles.timeRangeValue}>{preferences.waterReminderStart}</Text>
                    </View>
                    <Text style={styles.timeRangeDivider}>→</Text>
                    <View style={styles.timeRangeItem}>
                      <Text style={styles.timeRangeLabel}>End</Text>
                      <Text style={styles.timeRangeValue}>{preferences.waterReminderEnd}</Text>
                    </View>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Celebrations */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CELEBRATIONS</Text>
          
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>🏆 Rank Up Alerts</Text>
                <Text style={styles.settingDescription}>
                  Get notified when you reach a new rank
                </Text>
              </View>
              <Switch
                value={preferences.rankUpCelebrations}
                onValueChange={(val) => handleToggle('rankUpCelebrations', val)}
                trackColor={{ false: '#2A2A2A', true: '#00D9FF' }}
                thumbColor={preferences.rankUpCelebrations ? '#FFFFFF' : '#888'}
                disabled={!preferences.enabled}
              />
            </View>

            <View style={[styles.settingRow, styles.settingRowLast]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>✨ Achievement Unlocks</Text>
                <Text style={styles.settingDescription}>
                  Celebrate when you unlock new badges
                </Text>
              </View>
              <Switch
                value={preferences.achievementUnlocks}
                onValueChange={(val) => handleToggle('achievementUnlocks', val)}
                trackColor={{ false: '#2A2A2A', true: '#00D9FF' }}
                thumbColor={preferences.achievementUnlocks ? '#FFFFFF' : '#888'}
                disabled={!preferences.enabled}
              />
            </View>
          </View>
        </View>

        {/* Advanced */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ADVANCED</Text>
          
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>💪 Workout Suggestions</Text>
                <Text style={styles.settingDescription}>
                  Smart workout prompts based on your habits
                </Text>
              </View>
              <Switch
                value={preferences.workoutSuggestions}
                onValueChange={(val) => handleToggle('workoutSuggestions', val)}
                trackColor={{ false: '#2A2A2A', true: '#00D9FF' }}
                thumbColor={preferences.workoutSuggestions ? '#FFFFFF' : '#888'}
                disabled={!preferences.enabled}
              />
            </View>

            <View style={[styles.settingRow, styles.settingRowLast]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>❤️ Recovery Alerts</Text>
                <Text style={styles.settingDescription}>
                  Get notified if recovery score is low
                </Text>
              </View>
              <Switch
                value={preferences.recoveryAlerts}
                onValueChange={(val) => handleToggle('recoveryAlerts', val)}
                trackColor={{ false: '#2A2A2A', true: '#00D9FF' }}
                thumbColor={preferences.recoveryAlerts ? '#FFFFFF' : '#888'}
                disabled={!preferences.enabled}
              />
            </View>
          </View>
        </View>

        {/* Quiet Hours */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>QUIET HOURS</Text>

          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>🔕 Respect Quiet Hours</Text>
                <Text style={styles.settingDescription}>
                  Prevent reminders overnight to reduce spam
                </Text>
              </View>
              <Switch
                value={preferences.quietHoursEnabled}
                onValueChange={(val) => handleToggle('quietHoursEnabled', val)}
                trackColor={{ false: '#2A2A2A', true: '#00D9FF' }}
                thumbColor={preferences.quietHoursEnabled ? '#FFFFFF' : '#888'}
                disabled={!preferences.enabled}
              />
            </View>

            {preferences.quietHoursEnabled && (
              <>
                <View style={styles.subSetting}>
                  <Text style={styles.subSettingLabel}>Quiet Starts</Text>
                  <View style={styles.timeButtons}>
                    {['21:30', '22:00', '22:30', '23:00'].map(time => (
                      <Pressable
                        key={time}
                        style={[
                          styles.timeButton,
                          preferences.quietHoursStart === time && styles.timeButtonActive
                        ]}
                        onPress={() => handleTimeChange('quietHoursStart', time)}
                      >
                        <Text style={[
                          styles.timeButtonText,
                          preferences.quietHoursStart === time && styles.timeButtonTextActive
                        ]}>
                          {time}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.subSetting}>
                  <Text style={styles.subSettingLabel}>Quiet Ends</Text>
                  <View style={styles.timeButtons}>
                    {['06:00', '06:30', '07:00', '07:30'].map(time => (
                      <Pressable
                        key={time}
                        style={[
                          styles.timeButton,
                          preferences.quietHoursEnd === time && styles.timeButtonActive
                        ]}
                        onPress={() => handleTimeChange('quietHoursEnd', time)}
                      >
                        <Text style={[
                          styles.timeButtonText,
                          preferences.quietHoursEnd === time && styles.timeButtonTextActive
                        ]}>
                          {time}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </>
            )}
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#888',
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 12,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#00D9FF',
    backgroundColor: 'rgba(0,217,255,0.14)',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: '#BFF3FF',
    fontWeight: '900',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
  },
  headerSpacer: {
    width: 58,
  },
  backBtn: {
    minHeight: 34,
    minWidth: 58,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2B2B2B',
    backgroundColor: '#151515',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    fontSize: 12,
    color: '#D4EEF7',
    fontWeight: '700',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  scheduledBadge: {
    backgroundColor: '#00D9FF20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#00D9FF',
  },
  scheduledText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#00D9FF',
  },
  permissionBanner: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
  },
  permissionGradient: {
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  permissionIcon: {
    fontSize: 32,
    marginRight: 16,
  },
  permissionContent: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FF4466',
    marginBottom: 4,
  },
  permissionText: {
    fontSize: 13,
    color: '#888',
    lineHeight: 18,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#888',
    letterSpacing: 1,
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  settingRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
    paddingTop: 20,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  subSetting: {
    marginTop: 20,
  },
  subSettingLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 12,
    fontWeight: '600',
  },
  timeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  timeButton: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  timeButtonActive: {
    backgroundColor: '#00D9FF20',
    borderColor: '#00D9FF',
  },
  timeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  timeButtonTextActive: {
    color: '#00D9FF',
  },
  timeRange: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    padding: 16,
  },
  timeRangeItem: {
    flex: 1,
    alignItems: 'center',
  },
  timeRangeLabel: {
    fontSize: 11,
    color: '#666',
    marginBottom: 4,
  },
  timeRangeValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  timeRangeDivider: {
    fontSize: 18,
    color: '#666',
    marginHorizontal: 12,
  },
});
