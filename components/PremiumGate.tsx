import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { EXERCISE_PACKS, hasFeatureAccess, isStorePurchasingEnabled } from '../utils/monetizationService';
import { isFeatureEnabled, type PremiumFeature } from '../utils/featureGate';

interface PremiumGateProps {
  feature:
    | 'hr_analytics'
    | 'recovery'
    | 'pr_tracking'
    | 'custom_workouts'
    | 'advanced_notifications'
    | PremiumFeature;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Premium Feature Gate
 * Wraps premium features and shows upgrade prompt if not subscribed
 */
export default function PremiumGate({ feature, children, fallback }: PremiumGateProps) {
  const router = useRouter();
  const [hasAccess, setHasAccess] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const storeEnabled = isStorePurchasingEnabled();
  const subscriptionPack = useMemo(
    () => EXERCISE_PACKS.find((pack) => pack.id === 'zenith_pro' || pack.isSubscription),
    []
  );
  const monthlyPrice = subscriptionPack?.priceMonthly;
  const yearlyPrice = subscriptionPack?.priceYearly;
  const hasPricing = typeof monthlyPrice === 'number' && typeof yearlyPrice === 'number';
  const monthlyLabel = hasPricing ? `$${monthlyPrice!.toFixed(2)}/mo` : 'View pricing';
  const yearlyLabel = hasPricing ? `$${yearlyPrice!.toFixed(2)}/yr` : 'View pricing';
  const yearlySavings = hasPricing ? Math.max(0, (monthlyPrice! * 12) - yearlyPrice!) : 0;
  const savingsLabel = hasPricing && yearlySavings > 0 ? `Save $${Math.round(yearlySavings)}` : '';

  useEffect(() => {
    let cancelled = false;
    const checkAccess = async () => {
      if (!storeEnabled) {
        if (!cancelled) {
          // Monetization is disabled in this build. Avoid leaking upgrade UI.
          setHasAccess(true);
          setLoadError(false);
          setLoading(false);
        }
        return;
      }
      try {
        const access =
          feature === 'hr_analytics' ||
          feature === 'recovery' ||
          feature === 'pr_tracking' ||
          feature === 'custom_workouts' ||
          feature === 'advanced_notifications'
            ? await hasFeatureAccess(feature)
            : await isFeatureEnabled(feature as PremiumFeature);
        if (!cancelled) {
          setHasAccess(access);
          setLoadError(false);
        }
      } catch {
        if (!cancelled) {
          setLoadError(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void checkAccess();
    return () => {
      cancelled = true;
    };
  }, [feature, storeEnabled]);

  if (!storeEnabled) {
    return <>{children}</>;
  }

  const handleUpgrade = () => {
    setShowUpgradeModal(false);
    router.push('/store' as any);
  };

  if (loading) {
    return null;
  }

  if (loadError) {
    // Client-side gate should fail open. Server-side enforcement remains authoritative.
    return <>{children}</>;
  }

  if (hasAccess) {
    return <>{children}</>;
  }

  // Show fallback if provided
  if (fallback) {
    return <>{fallback}</>;
  }

  // Default locked state
  return (
    <>
      <TouchableOpacity
        style={styles.lockedCard}
        onPress={() => setShowUpgradeModal(true)}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={['#8A2BE220', '#00D9FF20']}
          style={styles.lockedGradient}
        >
          <Text style={styles.lockIcon}>🔒</Text>
          <Text style={styles.lockTitle}>{getFeatureName(feature)}</Text>
          <Text style={styles.lockDescription}>
            Unlock with Zenith Pro
          </Text>
          <View style={styles.lockButton}>
            <Text style={styles.lockButtonText}>UPGRADE</Text>
          </View>
        </LinearGradient>
      </TouchableOpacity>

      {/* Upgrade Modal */}
      <Modal
        visible={showUpgradeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowUpgradeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalIcon}>👑</Text>
            <Text style={styles.modalTitle}>Premium Feature</Text>
            <Text style={styles.modalDescription}>
              {getFeatureName(feature)} is available with Zenith Pro
            </Text>

            <View style={styles.benefitsSection}>
              <Text style={styles.benefitsTitle}>Zenith Pro includes:</Text>
              {getFeatureBenefits(feature).map((benefit, index) => (
                <View key={index} style={styles.benefitItem}>
                  <Text style={styles.benefitBullet}>✓</Text>
                  <Text style={styles.benefitText}>{benefit}</Text>
                </View>
              ))}
            </View>

            <View style={styles.pricingRow}>
              <View style={styles.pricingCol}>
                <Text style={styles.pricingLabel}>Monthly</Text>
                <Text style={styles.pricingPrice}>{monthlyLabel}</Text>
              </View>
              <View style={styles.pricingDivider} />
              <View style={[styles.pricingCol, styles.pricingColBest]}>
                <View style={styles.bestBadge}>
                  <Text style={styles.bestText}>BEST</Text>
                </View>
                <Text style={styles.pricingLabel}>Yearly</Text>
                <Text style={styles.pricingPrice}>{yearlyLabel}</Text>
                {savingsLabel ? <Text style={styles.pricingSave}>{savingsLabel}</Text> : null}
              </View>
            </View>

            <TouchableOpacity
              style={styles.upgradeButton}
              onPress={handleUpgrade}
            >
              <LinearGradient
                colors={['#8A2BE2', '#00D9FF']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.upgradeGradient}
              >
                <Text style={styles.upgradeButtonText}>START 7-DAY FREE TRIAL</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowUpgradeModal(false)}
            >
              <Text style={styles.cancelButtonText}>Maybe Later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function getFeatureName(feature: string): string {
  switch (feature) {
    case 'hr_analytics': return 'Heart Rate Analytics';
    case 'recovery': return 'Recovery Score';
    case 'pr_tracking': return 'Personal Records';
    case 'custom_workouts': return 'Custom Workouts';
    case 'advanced_notifications': return 'Smart Notifications';
    case 'trainingLoad': return 'Training Load';
    case 'routes': return 'Routes';
    case 'offlineRoutes': return 'Offline Routes';
    case 'segments': return 'Segments';
    case 'nutritionInsights': return 'Nutrition Insights';
    case 'readiness': return 'Readiness';
    case 'aiInsights': return 'AI Insight Cards';
    case 'dataExport': return 'Data Export';
    default: return 'Premium Feature';
  }
}

function getFeatureBenefits(feature: string): string[] {
  switch (feature) {
    case 'hr_analytics':
      return [
        'Heart rate zone breakdown',
        'Training effect analysis',
        'Advanced metrics (training load, efficiency)',
        'Post-workout analytics'
      ];
    case 'recovery':
      return [
        'Daily recovery score (0-100)',
        'HRV tracking',
        'Recovery recommendations',
        'Training readiness'
      ];
    case 'pr_tracking':
      return [
        'Personal record tracking',
        'One-rep max calculator',
        'PR history & trends',
        'Progress over time'
      ];
    case 'custom_workouts':
      return [
        'Custom workout builder',
        'Exercise library (150+)',
        'Save & reuse templates',
        'Progressive overload tracking'
      ];
    case 'advanced_notifications':
      return [
        'Smart workout suggestions',
        'Recovery-based alerts',
        'Optimal training timing',
        'Personalized reminders'
      ];
    case 'trainingLoad':
      return [
        'Fitness / fatigue / form',
        'Weekly load and ramp rate',
        'Confidence tiers and explainable methods',
        'Trend history beyond 7 days',
      ];
    case 'routes':
      return [
        'Suggested routes from your history',
        'Route previews on a map',
        'Save routes for repeats',
        'Route sharing cards',
      ];
    case 'offlineRoutes':
      return [
        'Offline route snapshots',
        'Airplane-mode friendly route viewing',
        'Consistent map styling',
        'Fast load times',
      ];
    case 'segments':
      return [
        'Personal segments',
        'Segment PRs and history',
        'Matched efforts (when route data is available)',
        'Progress trends',
      ];
    case 'nutritionInsights':
      return [
        'Macros by meal',
        'Timestamps and consistency',
        'Weekly digest summaries',
        'Exports for analysis',
      ];
    case 'readiness':
      return [
        'Readiness score with confidence',
        'Strain vs recovery guidance',
        'Reasons, not guesses',
        'Better training decisions',
      ];
    case 'aiInsights':
      return [
        'Rules-first insight cards',
        'Training ↔ food ↔ sleep links',
        'Confidence labels',
        'Dismissable feed',
      ];
    case 'dataExport':
      return [
        'Nutrition CSV export',
        'Workout CSV export (when enabled)',
        'Share via system sheet',
        'Exact logged values',
      ];
    default:
      return ['Premium features', 'Advanced analytics', 'Priority support'];
  }
}

const styles = StyleSheet.create({
  lockedCard: {
    marginHorizontal: 20,
    marginVertical: 12,
    borderRadius: 16,
    overflow: 'hidden',
  },
  lockedGradient: {
    padding: 32,
    alignItems: 'center',
  },
  lockIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  lockTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  lockDescription: {
    fontSize: 14,
    color: '#888',
    marginBottom: 20,
  },
  lockButton: {
    backgroundColor: '#FFFFFF20',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  lockButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#00D9FF',
    letterSpacing: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%',
  },
  modalIcon: {
    fontSize: 64,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    marginBottom: 24,
  },
  benefitsSection: {
    marginBottom: 24,
  },
  benefitsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  benefitBullet: {
    fontSize: 18,
    color: '#00FF88',
    marginRight: 12,
  },
  benefitText: {
    fontSize: 15,
    color: '#FFFFFF',
    flex: 1,
    lineHeight: 22,
  },
  pricingRow: {
    flexDirection: 'row',
    backgroundColor: '#2A2A2A',
    borderRadius: 16,
    padding: 4,
    marginBottom: 24,
  },
  pricingCol: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  pricingColBest: {
    backgroundColor: '#8A2BE220',
  },
  bestBadge: {
    position: 'absolute',
    top: -8,
    backgroundColor: '#00FF88',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  bestText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#000000',
  },
  pricingDivider: {
    width: 1,
    backgroundColor: '#3A3A3A',
    marginVertical: 8,
  },
  pricingLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  pricingPrice: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  pricingSave: {
    fontSize: 11,
    color: '#00FF88',
    marginTop: 2,
  },
  upgradeButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
  },
  upgradeGradient: {
    padding: 18,
    alignItems: 'center',
  },
  upgradeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  cancelButton: {
    padding: 16,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    color: '#666',
  },
});
