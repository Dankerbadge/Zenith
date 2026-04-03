import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Animated, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * Skeleton Loader - Animated shimmer effect
 */
export function SkeletonLoader({ width: w, height: h, borderRadius = 8, style }: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: any;
}) {
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [animatedValue]);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <Animated.View
      style={[
        {
          width: w,
          height: h,
          backgroundColor: '#2A2A2A',
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  );
}

/**
 * Dashboard Loading Skeleton
 */
export function DashboardSkeleton() {
  return (
    <View style={styles.dashboardSkeleton}>
      {/* Hero Section */}
      <View style={styles.heroSkeleton}>
        <SkeletonLoader width={120} height={120} borderRadius={60} style={{ marginBottom: 16 }} />
        <SkeletonLoader width={200} height={32} borderRadius={8} style={{ marginBottom: 8 }} />
        <SkeletonLoader width={150} height={20} borderRadius={6} />
      </View>

      {/* Stats Cards */}
      <View style={styles.statsGrid}>
        {[1, 2, 3, 4].map(i => (
          <View key={i} style={styles.statCardSkeleton}>
            <SkeletonLoader width="100%" height={80} borderRadius={12} />
          </View>
        ))}
      </View>

      {/* Quick Actions */}
      <View style={styles.actionsSkeleton}>
        {[1, 2, 3].map(i => (
          <SkeletonLoader key={i} width="100%" height={60} borderRadius={12} style={{ marginBottom: 12 }} />
        ))}
      </View>
    </View>
  );
}

/**
 * Stats Screen Loading Skeleton
 */
export function StatsSkeleton() {
  return (
    <View style={styles.statsSkeleton}>
      {/* Header */}
      <SkeletonLoader width={180} height={36} borderRadius={8} style={{ marginBottom: 24 }} />

      {/* Cards */}
      <View style={styles.statsGrid}>
        {[1, 2, 3, 4].map(i => (
          <SkeletonLoader key={i} width="48%" height={100} borderRadius={16} style={{ marginBottom: 12 }} />
        ))}
      </View>

      {/* Chart */}
      <SkeletonLoader width="100%" height={200} borderRadius={16} style={{ marginTop: 12 }} />

      {/* Details */}
      <View style={{ marginTop: 24 }}>
        {[1, 2, 3].map(i => (
          <SkeletonLoader key={i} width="100%" height={50} borderRadius={12} style={{ marginBottom: 12 }} />
        ))}
      </View>
    </View>
  );
}

/**
 * Profile Loading Skeleton
 */
export function ProfileSkeleton() {
  return (
    <View style={styles.profileSkeleton}>
      {/* Avatar */}
      <View style={styles.avatarSection}>
        <SkeletonLoader width={100} height={100} borderRadius={50} style={{ marginBottom: 16 }} />
        <SkeletonLoader width={150} height={24} borderRadius={6} style={{ marginBottom: 8 }} />
        <SkeletonLoader width={120} height={16} borderRadius={4} />
      </View>

      {/* Info Sections */}
      {[1, 2, 3].map(i => (
        <View key={i} style={{ marginBottom: 24 }}>
          <SkeletonLoader width={120} height={14} borderRadius={4} style={{ marginBottom: 12 }} />
          <View style={styles.infoCardSkeleton}>
            {[1, 2, 3, 4].map(j => (
              <SkeletonLoader key={j} width="100%" height={50} borderRadius={8} style={{ marginBottom: 12 }} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * List Item Loading Skeleton
 */
export function ListItemSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.listItemSkeleton}>
          <SkeletonLoader width={50} height={50} borderRadius={25} />
          <View style={{ flex: 1, marginLeft: 16 }}>
            <SkeletonLoader width="70%" height={18} borderRadius={4} style={{ marginBottom: 8 }} />
            <SkeletonLoader width="40%" height={14} borderRadius={4} />
          </View>
          <SkeletonLoader width={60} height={30} borderRadius={6} />
        </View>
      ))}
    </View>
  );
}

/**
 * Spinner Loader
 */
export function Spinner({ size = 'large', color = '#00D9FF' }: {
  size?: 'small' | 'large';
  color?: string;
}) {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      })
    ).start();
  }, [spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const spinnerSize = size === 'large' ? 40 : 24;

  return (
    <Animated.View
      style={[
        styles.spinner,
        {
          width: spinnerSize,
          height: spinnerSize,
          borderColor: color,
          transform: [{ rotate: spin }],
        },
      ]}
    />
  );
}

/**
 * Full Screen Loading
 */
export function FullScreenLoading({ message }: { message?: string }) {
  return (
    <View style={styles.fullScreenLoading}>
      <Spinner size="large" />
      {message && (
        <Text style={{ color: '#888', marginTop: 16, fontSize: 14 }}>{message}</Text>
      )}
    </View>
  );
}

/**
 * Card Loading State
 */
export function CardSkeleton({ height = 120 }: { height?: number }) {
  return (
    <View style={styles.cardSkeleton}>
      <SkeletonLoader width="100%" height={height} borderRadius={16} />
    </View>
  );
}

/**
 * Empty State Component
 */
export function EmptyState({ 
  icon, 
  title, 
  message, 
  actionText, 
  onAction 
}: {
  icon: string;
  title: string;
  message: string;
  actionText?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <LinearGradient
          colors={['#2A2A2A', '#1A1A1A']}
          style={styles.emptyIconGradient}
        >
          <View style={styles.emptyIcon}>
            <Text style={styles.emptyIconText}>{icon}</Text>
          </View>
        </LinearGradient>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {actionText && onAction && (
        <View style={styles.emptyAction}>
          <LinearGradient
            colors={['#00D9FF', '#8A2BE2']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.emptyActionButton}
          >
            <Pressable onPress={onAction}>
              <Text style={styles.emptyActionText}>{actionText}</Text>
            </Pressable>
          </LinearGradient>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dashboardSkeleton: {
    padding: 20,
    paddingTop: 60,
  },
  heroSkeleton: {
    alignItems: 'center',
    marginBottom: 32,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCardSkeleton: {
    width: '48%',
  },
  actionsSkeleton: {
    marginTop: 12,
  },
  statsSkeleton: {
    padding: 20,
    paddingTop: 60,
  },
  profileSkeleton: {
    padding: 20,
    paddingTop: 60,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  infoCardSkeleton: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
  },
  listItemSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    marginBottom: 12,
  },
  spinner: {
    borderWidth: 3,
    borderTopColor: 'transparent',
    borderRadius: 50,
  },
  fullScreenLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
  },
  cardSkeleton: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIconContainer: {
    marginBottom: 24,
  },
  emptyIconGradient: {
    borderRadius: 40,
    padding: 2,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    backgroundColor: '#0A0A0A',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyIconText: {
    fontSize: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyAction: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  emptyActionButton: {
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  emptyActionText: {
    color: '#001116',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
});
