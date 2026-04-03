import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import PremiumGate from '../components/PremiumGate';
import { getUserProfile } from '../utils/storageUtils';
import {
  calculateHRZones,
  analyzeWorkout,
  getRecoveryScore,
  HeartRateZone,
  WorkoutSummary
} from '../utils/healthService';
import { formatDuration } from '../utils/gpsService';

export default function WorkoutAnalyticsScreen() {
  return <WorkoutAnalyticsScreenInner />;
}

function WorkoutAnalyticsScreenInner() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [workoutData, setWorkoutData] = useState<WorkoutSummary | null>(null);
  const [zones, setZones] = useState<HeartRateZone[]>([]);
  const [recoveryScore, setRecoveryScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [missingSourceData, setMissingSourceData] = useState(false);
  const [userAge, setUserAge] = useState(25);

  const loadWorkoutAnalytics = useCallback(async () => {
    try {
      // Load user age from profile
      const profile = await getUserProfile();
      const profileAge = Number(profile.age) || 25;
      setUserAge(profileAge);

      // Calculate HR zones
      const hrZones = calculateHRZones(profileAge, 60);
      setZones(hrZones);

      // Get recovery score
      const recovery = await getRecoveryScore(profileAge);
      setRecoveryScore(recovery);

      // Analyze workout only when source session bounds are available.
      if (params.startDate && params.endDate) {
        const analysis = await analyzeWorkout(
          new Date(params.startDate as string),
          new Date(params.endDate as string),
          profileAge,
          parseInt(params.calories as string),
          params.distance ? parseFloat(params.distance as string) : undefined
        );
        setWorkoutData(analysis);
        setMissingSourceData(false);
      } else {
        setWorkoutData(null);
        setMissingSourceData(true);
      }

      setLoadError(false);
      setLoading(false);
    } catch (error) {
      console.log('Error loading analytics:', error);
      setLoadError(true);
      setLoading(false);
    }
  }, [params.calories, params.distance, params.endDate, params.startDate]);

  useEffect(() => {
    void loadWorkoutAnalytics();
  }, [loadWorkoutAnalytics]);

  const getTotalZoneTime = () => {
    if (!workoutData) return 0;
    return Object.values(workoutData.timeInZones).reduce((a, b) => a + b, 0);
  };

  const getZonePercentage = (zoneTime: number) => {
    const total = getTotalZoneTime();
    return total > 0 ? Math.round((zoneTime / total) * 100) : 0;
  };

  const getEffortLevel = () => {
    if (!workoutData || workoutData.avgHR === 0) return 'Unknown';
    const maxHR = 220 - userAge;
    const percentage = (workoutData.avgHR / maxHR) * 100;
    
    if (percentage < 60) return 'Light';
    if (percentage < 70) return 'Moderate';
    if (percentage < 80) return 'Hard';
    if (percentage < 90) return 'Very Hard';
    return 'Maximum';
  };

  const getTrainingEffect = () => {
    if (!workoutData) return null;
    
    const { zone2, zone3, zone4, zone5 } = workoutData.timeInZones;
    const total = getTotalZoneTime();
    
    if ((zone2 + zone3) / total > 0.7) {
      return {
        primary: 'Aerobic Base',
        color: '#00D9FF',
        description: 'Building endurance & fat burning capacity'
      };
    }
    if ((zone3 + zone4) / total > 0.6) {
      return {
        primary: 'Threshold',
        color: '#FFD700',
        description: 'Improving lactate threshold & race pace'
      };
    }
    if ((zone4 + zone5) / total > 0.4) {
      return {
        primary: 'VO2 Max',
        color: '#FF4466',
        description: 'Maximum oxygen uptake & performance'
      };
    }
    
    return {
      primary: 'Mixed',
      color: '#00FF88',
      description: 'Balanced training stimulus'
    };
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centerContent]} edges={['top', 'bottom', 'left', 'right']}>
        <Text style={styles.loadingText}>Analyzing workout...</Text>
      </SafeAreaView>
    );
  }

  if (missingSourceData) {
    return (
      <SafeAreaView style={[styles.container, styles.centerContent]} edges={['top', 'bottom', 'left', 'right']}>
        <Text style={styles.errorText}>Analytics unavailable for this workout</Text>
        <Text style={styles.loadingText}>This session is missing source timing data needed for real HR-zone analysis.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={styles.retryText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!workoutData) {
    return (
      <SafeAreaView style={[styles.container, styles.centerContent]} edges={['top', 'bottom', 'left', 'right']}>
        <Text style={styles.errorText}>Couldn’t load workout analytics</Text>
        <Pressable
          style={styles.retryBtn}
          onPress={() => {
            setLoadError(false);
            setLoading(true);
            void loadWorkoutAnalytics();
          }}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={styles.retryText}>{loadError ? 'Go back' : 'Back'}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const totalTime = getTotalZoneTime();
  const trainingEffect = getTrainingEffect();

  return (
    <PremiumGate feature="hr_analytics">
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backButton}>←</Text>
          </Pressable>
          <Text style={styles.title}>Workout Analytics</Text>
          <View style={{ width: 30 }} />
        </View>

        {/* Recovery Score */}
        {recoveryScore !== null && (
          <View style={styles.recoveryCard}>
            <LinearGradient
              colors={
                recoveryScore >= 70 ? ['#00FF8820', '#00D9FF20'] :
                recoveryScore >= 40 ? ['#FFD70020', '#FF880020'] :
                ['#FF446620', '#8A2BE220']
              }
              style={styles.recoveryGradient}
            >
              <Text style={styles.recoveryLabel}>RECOVERY SCORE</Text>
              <Text style={[
                styles.recoveryScore,
                { color: recoveryScore >= 70 ? '#00FF88' : recoveryScore >= 40 ? '#FFD700' : '#FF4466' }
              ]}>
                {recoveryScore}
              </Text>
              <Text style={styles.recoveryStatus}>
                {recoveryScore >= 70 ? '✅ Fully Recovered' :
                 recoveryScore >= 40 ? '⚠️ Moderate Recovery' :
                 '🔴 Low Recovery'}
              </Text>
              <Text style={styles.recoveryNote}>
                Based on HRV & resting heart rate
              </Text>
            </LinearGradient>
          </View>
        )}

        {/* HR Summary Stats */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{workoutData.avgHR || '--'}</Text>
            <Text style={styles.statLabel}>Avg HR</Text>
            <Text style={styles.statSubtext}>bpm</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{workoutData.maxHR || '--'}</Text>
            <Text style={styles.statLabel}>Max HR</Text>
            <Text style={styles.statSubtext}>bpm</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{workoutData.minHR || '--'}</Text>
            <Text style={styles.statLabel}>Min HR</Text>
            <Text style={styles.statSubtext}>bpm</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{getEffortLevel()}</Text>
            <Text style={styles.statLabel}>Effort</Text>
            <Text style={styles.statSubtext}>level</Text>
          </View>
        </View>

        {/* Training Effect */}
        {trainingEffect && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TRAINING EFFECT</Text>
            <View style={[styles.trainingEffectCard, { borderLeftColor: trainingEffect.color }]}>
              <View style={styles.trainingEffectHeader}>
                <Text style={[styles.trainingEffectPrimary, { color: trainingEffect.color }]}>
                  {trainingEffect.primary}
                </Text>
              </View>
              <Text style={styles.trainingEffectDescription}>
                {trainingEffect.description}
              </Text>
            </View>
          </View>
        )}

        {/* HR Zones Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>HEART RATE ZONES</Text>
          
          {/* Zone Time Distribution */}
          <View style={styles.zonesCard}>
            {zones.map((zone, index) => {
              const zoneKey = `zone${zone.zone}` as keyof WorkoutSummary['timeInZones'];
              const zoneTime = workoutData.timeInZones[zoneKey];
              const percentage = getZonePercentage(zoneTime);

              return (
                <View key={zone.zone} style={styles.zoneRow}>
                  <View style={styles.zoneHeader}>
                    <View style={styles.zoneInfo}>
                      <View style={[styles.zoneIndicator, { backgroundColor: zone.color }]} />
                      <View>
                        <Text style={styles.zoneName}>Zone {zone.zone} • {zone.name}</Text>
                        <Text style={styles.zoneRange}>{zone.minBpm}-{zone.maxBpm} bpm • {zone.percentage}</Text>
                      </View>
                    </View>
                    <View style={styles.zoneStats}>
                      <Text style={styles.zoneTime}>{formatDuration(zoneTime)}</Text>
                      <Text style={styles.zonePercentage}>{percentage}%</Text>
                    </View>
                  </View>
                  
                  {/* Progress bar */}
                  <View style={styles.zoneBarContainer}>
                    <View 
                      style={[
                        styles.zoneBar,
                        { width: `${percentage}%`, backgroundColor: zone.color }
                      ]} 
                    />
                  </View>
                </View>
              );
            })}
          </View>

          {/* Zone Benefits */}
          <View style={styles.zoneBenefitsCard}>
            <Text style={styles.zoneBenefitsTitle}>Zone Benefits</Text>
            {zones.map(zone => (
              <View key={zone.zone} style={styles.zoneBenefitRow}>
                <View style={[styles.zoneBenefitDot, { backgroundColor: zone.color }]} />
                <Text style={styles.zoneBenefitText}>
                  <Text style={styles.zoneBenefitZone}>Z{zone.zone}:</Text> {zone.benefit}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Advanced Metrics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ADVANCED METRICS</Text>
          <View style={styles.metricsCard}>
            <View style={styles.metricRow}>
              <View style={styles.metricInfo}>
                <Text style={styles.metricLabel}>Training Load</Text>
                <Text style={styles.metricDescription}>
                  Estimated stress on your body
                </Text>
              </View>
              <Text style={styles.metricValue}>
                {Math.round(totalTime / 60 * (workoutData.avgHR / (220 - userAge)) * 100)}
              </Text>
            </View>

            <View style={styles.metricRow}>
              <View style={styles.metricInfo}>
                <Text style={styles.metricLabel}>Aerobic Efficiency</Text>
                <Text style={styles.metricDescription}>
                  Calories burned per avg BPM
                </Text>
              </View>
              <Text style={styles.metricValue}>
                {workoutData.avgHR > 0 ? (workoutData.calories / workoutData.avgHR).toFixed(1) : '--'}
              </Text>
            </View>

            {workoutData.distance && (
              <View style={styles.metricRow}>
                <View style={styles.metricInfo}>
                  <Text style={styles.metricLabel}>Running Economy</Text>
                  <Text style={styles.metricDescription}>
                    BPM per mile
                  </Text>
                </View>
                <Text style={styles.metricValue}>
                  {(workoutData.avgHR / workoutData.distance).toFixed(0)}
                </Text>
              </View>
            )}

            <View style={styles.metricRow}>
              <View style={styles.metricInfo}>
                <Text style={styles.metricLabel}>Workout Duration</Text>
                <Text style={styles.metricDescription}>
                  Total active time
                </Text>
              </View>
              <Text style={styles.metricValue}>
                {formatDuration(totalTime)}
              </Text>
            </View>
          </View>
        </View>

        {/* Insights & Recommendations */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>INSIGHTS</Text>
          <View style={styles.insightsCard}>
            {workoutData.avgHR > 0 && (
              <View style={styles.insightItem}>
                <Text style={styles.insightIcon}>💡</Text>
                <View style={styles.insightContent}>
                  <Text style={styles.insightText}>
                    Your average heart rate of {workoutData.avgHR} bpm indicates a{' '}
                    <Text style={styles.insightHighlight}>{getEffortLevel().toLowerCase()}</Text> intensity workout.
                  </Text>
                </View>
              </View>
            )}

            {trainingEffect && (
              <View style={styles.insightItem}>
                <Text style={styles.insightIcon}>🎯</Text>
                <View style={styles.insightContent}>
                  <Text style={styles.insightText}>
                    This session primarily trained your{' '}
                    <Text style={styles.insightHighlight}>{trainingEffect.primary.toLowerCase()}</Text>.
                  </Text>
                </View>
              </View>
            )}

            {recoveryScore !== null && recoveryScore < 70 && (
              <View style={styles.insightItem}>
                <Text style={styles.insightIcon}>⚠️</Text>
                <View style={styles.insightContent}>
                  <Text style={styles.insightText}>
                    Recovery score is moderate. Consider lighter training tomorrow.
                  </Text>
                </View>
              </View>
            )}

            {workoutData.maxHR > (220 - userAge) * 0.95 && (
              <View style={styles.insightItem}>
                <Text style={styles.insightIcon}>🔥</Text>
                <View style={styles.insightContent}>
                  <Text style={styles.insightText}>
                    You pushed to {Math.round((workoutData.maxHR / (220 - userAge)) * 100)}% of max HR. Great effort!
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </PremiumGate>
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
  retryBtn: {
    marginTop: 12,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#00D9FF',
    backgroundColor: 'rgba(0,217,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
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
  backButton: {
    fontSize: 28,
    color: '#00D9FF',
    fontWeight: '300',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  recoveryCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
  },
  recoveryGradient: {
    padding: 24,
    alignItems: 'center',
  },
  recoveryLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#888',
    letterSpacing: 1,
    marginBottom: 8,
  },
  recoveryScore: {
    fontSize: 64,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  recoveryStatus: {
    fontSize: 16,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  recoveryNote: {
    fontSize: 12,
    color: '#666',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 20,
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    width: '48%',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#00D9FF',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 2,
  },
  statSubtext: {
    fontSize: 10,
    color: '#666',
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
  trainingEffectCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderLeftWidth: 4,
  },
  trainingEffectHeader: {
    marginBottom: 8,
  },
  trainingEffectPrimary: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  trainingEffectDescription: {
    fontSize: 14,
    color: '#888',
    lineHeight: 20,
  },
  zonesCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: 12,
  },
  zoneRow: {
    marginBottom: 20,
  },
  zoneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  zoneInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  zoneIndicator: {
    width: 4,
    height: 40,
    borderRadius: 2,
    marginRight: 12,
  },
  zoneName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  zoneRange: {
    fontSize: 11,
    color: '#666',
  },
  zoneStats: {
    alignItems: 'flex-end',
  },
  zoneTime: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#00D9FF',
    marginBottom: 2,
  },
  zonePercentage: {
    fontSize: 12,
    color: '#888',
  },
  zoneBarContainer: {
    height: 6,
    backgroundColor: '#2A2A2A',
    borderRadius: 3,
    overflow: 'hidden',
  },
  zoneBar: {
    height: '100%',
    borderRadius: 3,
  },
  zoneBenefitsCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  zoneBenefitsTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#888',
    letterSpacing: 1,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  zoneBenefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  zoneBenefitDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  zoneBenefitText: {
    fontSize: 13,
    color: '#888',
    flex: 1,
    lineHeight: 18,
  },
  zoneBenefitZone: {
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  metricsCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  metricInfo: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  metricDescription: {
    fontSize: 11,
    color: '#666',
  },
  metricValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#00D9FF',
  },
  insightsCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  insightItem: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  insightIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  insightContent: {
    flex: 1,
  },
  insightText: {
    fontSize: 14,
    color: '#888',
    lineHeight: 20,
  },
  insightHighlight: {
    color: '#00D9FF',
    fontWeight: '600',
  },
});
