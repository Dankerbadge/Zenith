import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Alert, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ExercisePack,
  getPacksWithStatus,
  isStorePurchasingEnabled,
  purchasePack,
  restorePurchases,
} from '../utils/monetizationService';
import { captureException } from '../utils/crashReporter';

type GradientPair = readonly [string, string];

export default function ExercisePacksStoreScreen() {
  const router = useRouter();
  const [packs, setPacks] = useState<ExercisePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedPack, setSelectedPack] = useState<ExercisePack | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const storeEnabled = isStorePurchasingEnabled();

  useEffect(() => {
    loadPacks();
  }, []);

  const loadPacks = async () => {
    try {
      const packsWithStatus = await getPacksWithStatus();
      setPacks(packsWithStatus);
      setError(false);
    } catch (err) {
      setError(true);
      void captureException(err, { feature: 'store', op: 'load_packs' });
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async (pack: ExercisePack) => {
    if (!storeEnabled) {
      Alert.alert('Store preview', "Purchases aren't available in this version. Core features remain free.");
      return;
    }
    if (pack.isPurchased) {
      // Navigate to pack content
      router.push(`/pack/${pack.id}` as any);
      return;
    }

    setSelectedPack(pack);
  };

  const confirmPurchase = async () => {
    if (!selectedPack || purchasing) return;
    const targetPack = selectedPack;
    if (!storeEnabled) {
      setSelectedPack(null);
      Alert.alert('Store preview', "Purchases aren't available in this version.");
      return;
    }

    setPurchasing(true);
    try {
      const result = await purchasePack(targetPack.id);
      await loadPacks();
      if (result.state === 'success') {
        Alert.alert(
          '🎉 Success!',
          `${targetPack.name} unlocked! You now have access to all premium features.`,
          [
            {
              text: 'Explore',
              onPress: () => {
                void loadPacks();
                router.push(`/pack/${targetPack.id}` as any);
              },
            },
          ]
        );
      } else if (result.state === 'cancelled') {
        Alert.alert('Purchase cancelled', 'No charge was made.');
      } else if (result.state === 'pending') {
        Alert.alert(
          'Purchase pending verification',
          result.message || 'Checkout completed, but entitlement has not activated yet. Tap Restore Purchases in a moment.'
        );
      } else if (result.state === 'duplicate') {
        Alert.alert('Purchase in progress', result.message || 'A purchase is already being processed.');
      } else {
        Alert.alert('Purchase failed', result.message || 'Something went wrong with the purchase. Please try again.');
        void captureException(new Error(`purchase_failed:${result.code}`), {
          feature: 'store',
          op: 'purchase',
          packId: targetPack.id,
          code: result.code,
        });
      }
    } catch (err) {
      Alert.alert('Error', 'Something went wrong with the purchase. Please try again.');
      void captureException(err, { feature: 'store', op: 'purchase' });
    } finally {
      setPurchasing(false);
      setSelectedPack(null);
    }
  };

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const restored = await restorePurchases();
      await loadPacks();
      if (restored.state === 'success' && restored.purchasedPackIds.includes('zenith_pro')) {
        Alert.alert('Restored', 'Zenith Pro entitlement restored.');
      } else if (restored.state === 'success' && restored.purchasedPackIds.length > 1) {
        Alert.alert('Restored', `Restored ${restored.purchasedPackIds.length - 1} purchased pack(s).`);
      } else if (restored.state === 'success') {
        Alert.alert('Restore complete', 'No additional purchases were found to restore.');
      } else if (restored.state === 'pending') {
        Alert.alert('Restore pending verification', restored.message || 'Restore completed, but entitlement is still pending verification.');
      } else if (restored.state === 'duplicate') {
        Alert.alert('Restore in progress', restored.message || 'A restore operation is already running.');
      } else {
        Alert.alert('Restore failed', restored.message || 'Could not restore purchases right now.');
        void captureException(new Error(`restore_failed:${restored.code}`), {
          feature: 'store',
          op: 'restore',
          code: restored.code,
        });
      }
    } catch (err) {
      void captureException(err, { feature: 'store', op: 'restore' });
      Alert.alert('Restore failed', 'Could not restore purchases right now.');
    } finally {
      setRestoring(false);
    }
  };

  const getPackColor = (packId: string): GradientPair => {
    switch (packId) {
      case 'lifting_pack':
        return ['#FF6B35', '#F7931E'];
      case 'running_pack':
        return ['#00D9FF', '#8A2BE2'];
      case 'calisthenics_pack':
        return ['#00FF88', '#00D9FF'];
      default:
        return ['#888', '#666'];
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator color="#00D9FF" />
        <Text style={styles.loadingText}>Loading packs...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.container, styles.centerContent]}>
        <Text style={styles.errorText}>Couldn’t load packs</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setError(false);
            setLoading(true);
            void loadPacks();
          }}
        >
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={styles.backText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const freePack = packs.find(p => p.isFree);
  const subscriptionPack = packs.find(p => p.isSubscription);
  const premiumPacks = packs.filter(p => !p.isFree && !p.isSubscription);
  const purchasedCount = premiumPacks.filter(p => p.isPurchased).length;

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Upgrade</Text>
            <Text style={styles.subtitle}>
              Unlock your full potential
            </Text>
          </View>
          {purchasedCount > 0 && (
            <View style={styles.ownedBadge}>
              <Text style={styles.ownedText}>{purchasedCount} owned</Text>
            </View>
          )}
        </View>

        {/* Zenith Pro Subscription - HERO CARD */}
        {subscriptionPack && (
          <View style={styles.heroSection}>
            <TouchableOpacity
              style={styles.heroCard}
              onPress={() => handlePurchase(subscriptionPack)}
              activeOpacity={0.95}
            >
              <LinearGradient
                colors={['#8A2BE2', '#00D9FF', '#00FF88']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroGradient}
              >
                {/* Crown Badge */}
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgeText}>MOST POPULAR</Text>
                </View>

                <Text style={styles.heroIcon}>{subscriptionPack.icon}</Text>
                <Text style={styles.heroName}>{subscriptionPack.name}</Text>
                <Text style={styles.heroDescription}>{subscriptionPack.description}</Text>

                {/* Pricing Toggle */}
                <View style={styles.pricingToggle}>
                  <View style={styles.pricingOption}>
                    <Text style={styles.pricingLabel}>Monthly</Text>
                    <Text style={styles.pricingPrice}>${subscriptionPack.priceMonthly}/mo</Text>
                  </View>
                  <View style={styles.pricingDivider}>
                    <Text style={styles.pricingOr}>or</Text>
                  </View>
                  <View style={[styles.pricingOption, styles.pricingOptionBest]}>
                    <View style={styles.saveBadge}>
                      <Text style={styles.saveText}>SAVE $34</Text>
                    </View>
                    <Text style={styles.pricingLabel}>Yearly</Text>
                    <Text style={styles.pricingPrice}>${subscriptionPack.priceYearly}/yr</Text>
                    <Text style={styles.pricingSubtext}>$4.16/mo</Text>
                  </View>
                </View>

                {/* Top Features */}
                <View style={styles.heroFeatures}>
                  {subscriptionPack.features.slice(0, 5).map((feature, index) => (
                    <View key={index} style={styles.heroFeatureItem}>
                      <Text style={styles.heroFeatureBullet}>✓</Text>
                      <Text style={styles.heroFeatureText}>{feature}</Text>
                    </View>
                  ))}
                  <Text style={styles.heroMoreFeatures}>
                    +{subscriptionPack.features.length - 5} more premium features
                  </Text>
                </View>

                {/* CTA */}
                <View style={styles.heroCTA}>
                  <View style={styles.heroButton}>
                    <Text style={styles.heroButtonText}>START 7-DAY FREE TRIAL</Text>
                  </View>
                  <Text style={styles.heroTrial}>
                    Then ${subscriptionPack.priceYearly}/year • Cancel anytime
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* Free Tier Banner */}
        {freePack && (
          <View style={styles.freeBanner}>
            <View style={styles.freeBannerContent}>
              <Text style={styles.freeIcon}>{freePack.icon}</Text>
              <View style={styles.freeInfo}>
                <Text style={styles.freeName}>{freePack.name}</Text>
                <Text style={styles.freeDescription}>
                  You are currently on the free tier
                </Text>
              </View>
            </View>
            <TouchableOpacity 
              style={styles.expandButton}
              onPress={() => setSelectedPack(freePack)}
            >
              <Text style={styles.expandButtonText}>See Features</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Premium Packs */}
        <View style={styles.packsSection}>
          <Text style={styles.sectionTitle}>OR BUY INDIVIDUAL PACKS</Text>
          <Text style={styles.sectionSubtitle}>
            One-time purchase • Own forever
          </Text>
          
          {premiumPacks.map(pack => {
            const colors = getPackColor(pack.id);
            
            return (
              <TouchableOpacity
                key={pack.id}
                style={styles.packCard}
                onPress={() => handlePurchase(pack)}
                activeOpacity={0.9}
              >
                <LinearGradient
                  colors={[colors[0] + '20', colors[1] + '20']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.packGradient}
                >
                  {/* Header */}
                  <View style={styles.packHeader}>
                    <View style={styles.packHeaderLeft}>
                      <Text style={styles.packIcon}>{pack.icon}</Text>
                      <View>
                        <Text style={styles.packName}>{pack.name}</Text>
                        <Text style={styles.packDescription}>{pack.description}</Text>
                      </View>
                    </View>
                    {pack.isPurchased ? (
                      <View style={styles.ownedTag}>
                        <Text style={styles.ownedTagText}>✓ OWNED</Text>
                      </View>
                    ) : (
                      <View style={styles.priceTag}>
                        <Text style={styles.priceText}>${pack.price.toFixed(2)}</Text>
                      </View>
                    )}
                  </View>

                  {/* Features Preview (3 items) */}
                  <View style={styles.featuresPreview}>
                    {pack.features.slice(0, 3).map((feature, index) => (
                      <View key={index} style={styles.featureItem}>
                        <Text style={styles.featureBullet}>•</Text>
                        <Text style={styles.featureText}>{feature}</Text>
                      </View>
                    ))}
                    {pack.features.length > 3 && (
                      <Text style={styles.moreFeatures}>
                        +{pack.features.length - 3} more features
                      </Text>
                    )}
                  </View>

                  {/* CTA Button */}
                  <View style={styles.packFooter}>
                    <LinearGradient
                      colors={pack.isPurchased ? (['#00FF88', '#00D9FF'] as const) : colors}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.ctaGradient}
                    >
                      <Text style={styles.ctaText}>
                        {pack.isPurchased ? 'EXPLORE PACK' : 'UNLOCK NOW'}
                      </Text>
                    </LinearGradient>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.restoreButton} onPress={() => void handleRestore()} disabled={restoring}>
          <Text style={styles.restoreText}>{restoring ? 'Restoring…' : 'Restore Purchases'}</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Purchase Confirmation Modal */}
      <Modal
        visible={selectedPack !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPack(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedPack && (
              <>
                <Text style={styles.modalIcon}>{selectedPack.icon}</Text>
                <Text style={styles.modalTitle}>{selectedPack.name}</Text>
                <Text style={styles.modalDescription}>{selectedPack.description}</Text>

                {/* Full Features List */}
                <View style={styles.modalFeatures}>
                  <Text style={styles.modalFeaturesTitle}>What Is Included:</Text>
                  {selectedPack.features.map((feature, index) => (
                    <View key={index} style={styles.modalFeatureItem}>
                      <Text style={styles.modalFeatureBullet}>✓</Text>
                      <Text style={styles.modalFeatureText}>{feature}</Text>
                    </View>
                  ))}
                </View>

                {/* Buttons */}
                <View style={styles.modalButtons}>
                  {!selectedPack.isFree && !selectedPack.isPurchased && (
                    <TouchableOpacity
                      style={styles.purchaseButton}
                      onPress={confirmPurchase}
                      disabled={purchasing}
                    >
                      <LinearGradient
                        colors={getPackColor(selectedPack.id)}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.purchaseGradient}
                      >
                        <Text style={styles.purchaseButtonText}>
                          {purchasing ? 'Processing...' : `Purchase for $${selectedPack.price.toFixed(2)}`}
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  )}
                  
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => setSelectedPack(null)}
                  >
                    <Text style={styles.cancelButtonText}>
                      {selectedPack.isFree || selectedPack.isPurchased ? 'Close' : 'Cancel'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
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
    paddingHorizontal: 20,
  },
  loadingText: {
    fontSize: 16,
    color: '#888',
    marginTop: 10,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  retryButton: {
    marginTop: 12,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#00D9FF',
    backgroundColor: 'rgba(0,217,255,0.15)',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: '#BFF3FF',
    fontWeight: '900',
  },
  backText: {
    color: '#9FB6BE',
    fontWeight: '800',
  },
  unavailableActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  unavailableButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  unavailableButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  unavailableTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  unavailableSubtitle: {
    fontSize: 14,
    color: '#9A9A9A',
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 2,
  },
  header: {
    padding: 20,
    paddingTop: 60,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
  },
  ownedBadge: {
    backgroundColor: '#00FF8820',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#00FF88',
  },
  ownedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#00FF88',
  },
  heroSection: {
    paddingHorizontal: 20,
    marginBottom: 32,
  },
  heroCard: {
    borderRadius: 24,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#8A2BE2',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  heroGradient: {
    padding: 28,
    alignItems: 'center',
  },
  heroBadge: {
    backgroundColor: '#FFFFFF30',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  heroIcon: {
    fontSize: 72,
    marginBottom: 12,
  },
  heroName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  heroDescription: {
    fontSize: 16,
    color: '#FFFFFF',
    opacity: 0.9,
    marginBottom: 24,
  },
  pricingToggle: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF20',
    borderRadius: 16,
    padding: 4,
    marginBottom: 24,
    width: '100%',
  },
  pricingOption: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  pricingOptionBest: {
    backgroundColor: '#FFFFFF30',
  },
  saveBadge: {
    position: 'absolute',
    top: -8,
    backgroundColor: '#00FF88',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  saveText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#000000',
  },
  pricingLabel: {
    fontSize: 13,
    color: '#FFFFFF',
    opacity: 0.8,
    marginBottom: 4,
  },
  pricingPrice: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  pricingSubtext: {
    fontSize: 11,
    color: '#FFFFFF',
    opacity: 0.7,
    marginTop: 2,
  },
  pricingDivider: {
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pricingOr: {
    fontSize: 12,
    color: '#FFFFFF',
    opacity: 0.6,
  },
  heroFeatures: {
    width: '100%',
    marginBottom: 24,
  },
  heroFeatureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  heroFeatureBullet: {
    fontSize: 18,
    color: '#00FF88',
    marginRight: 10,
    fontWeight: 'bold',
  },
  heroFeatureText: {
    fontSize: 15,
    color: '#FFFFFF',
    flex: 1,
    lineHeight: 22,
  },
  heroMoreFeatures: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.7,
    marginTop: 8,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  heroCTA: {
    width: '100%',
    alignItems: 'center',
  },
  heroButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 32,
    paddingVertical: 18,
    borderRadius: 16,
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  heroButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#8A2BE2',
    letterSpacing: 1,
  },
  heroTrial: {
    fontSize: 12,
    color: '#FFFFFF',
    opacity: 0.8,
  },
  freeBanner: {
    marginHorizontal: 20,
    marginBottom: 24,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  freeBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  freeIcon: {
    fontSize: 40,
    marginRight: 16,
  },
  freeInfo: {
    flex: 1,
  },
  freeName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  freeDescription: {
    fontSize: 13,
    color: '#888',
  },
  expandButton: {
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  expandButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#00D9FF',
  },
  packsSection: {
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#888',
    letterSpacing: 1,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#666',
    marginBottom: 16,
  },
  packCard: {
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
  },
  packGradient: {
    padding: 20,
  },
  packHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  packHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  packIcon: {
    fontSize: 48,
    marginRight: 16,
  },
  packName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  packDescription: {
    fontSize: 13,
    color: '#888',
  },
  priceTag: {
    backgroundColor: '#FFFFFF20',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  priceText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  ownedTag: {
    backgroundColor: '#00FF8820',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#00FF88',
  },
  ownedTagText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#00FF88',
  },
  previewCard: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#141414',
    padding: 16,
    gap: 10,
  },
  previewTitle: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  previewText: { color: '#BFC7CB', fontWeight: '600', lineHeight: 20 },
  previewButton: {
    marginTop: 4,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2E4F5A',
    backgroundColor: '#122229',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewButtonText: { color: '#D7F4FF', fontWeight: '800' },
  featuresPreview: {
    marginBottom: 16,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  featureBullet: {
    fontSize: 16,
    color: '#FFFFFF',
    marginRight: 8,
    marginTop: 2,
  },
  featureText: {
    fontSize: 14,
    color: '#FFFFFF',
    flex: 1,
    lineHeight: 20,
  },
  moreFeatures: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
    fontStyle: 'italic',
  },
  packFooter: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  ctaGradient: {
    padding: 16,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  bundleCard: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
  },
  bundleGradient: {
    padding: 24,
    alignItems: 'center',
  },
  bundleIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  bundleTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  bundleDescription: {
    fontSize: 16,
    color: '#888',
    marginBottom: 4,
  },
  bundleSavings: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#00FF88',
    marginBottom: 16,
  },
  bundleButton: {
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  bundleButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  restoreButton: {
    marginHorizontal: 20,
    padding: 16,
    alignItems: 'center',
  },
  restoreText: {
    fontSize: 14,
    color: '#00D9FF',
    fontWeight: '600',
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
    maxHeight: '80%',
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
  modalFeatures: {
    marginBottom: 24,
  },
  modalFeaturesTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  modalFeatureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  modalFeatureBullet: {
    fontSize: 18,
    color: '#00FF88',
    marginRight: 12,
  },
  modalFeatureText: {
    fontSize: 15,
    color: '#FFFFFF',
    flex: 1,
    lineHeight: 22,
  },
  modalButtons: {
    gap: 12,
  },
  purchaseButton: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  purchaseGradient: {
    padding: 18,
    alignItems: 'center',
  },
  purchaseButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  cancelButton: {
    backgroundColor: '#2A2A2A',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888',
  },
});
