import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { TOKENS } from '@/constants/tokens';

type A11yState = {
  reduceMotion: boolean;
  reduceTransparency: boolean;
};

function useA11yState(): A11yState {
  const [state, setState] = useState<A11yState>({ reduceMotion: false, reduceTransparency: false });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
        // iOS-only, may not exist on all RN versions; treat as false if missing.
        const reduceTransparency =
          typeof (AccessibilityInfo as any).isReduceTransparencyEnabled === 'function'
            ? await (AccessibilityInfo as any).isReduceTransparencyEnabled()
            : false;
        if (!alive) return;
        setState({ reduceMotion: !!reduceMotion, reduceTransparency: !!reduceTransparency });
      } catch {
        if (!alive) return;
        setState({ reduceMotion: false, reduceTransparency: false });
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

function TabItem(props: {
  label: string;
  focused: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  renderIcon?: (color: string) => React.ReactNode;
  a11yLabel?: string;
  kind?: 'default' | 'fab';
  reduceMotion: boolean;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (props.reduceMotion) return;
    if (!props.focused) return;
    anim.stopAnimation();
    anim.setValue(0);
    Animated.sequence([
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 8 }),
      Animated.spring(anim, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 6 }),
    ]).start();
  }, [props.focused, props.reduceMotion, anim]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const color = props.focused ? TOKENS.color.accent : 'rgba(255,255,255,0.60)';

  if (props.kind === 'fab') {
    return (
      <View style={styles.fabSlot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.a11yLabel || props.label}
          onPress={props.onPress}
          onLongPress={props.onLongPress}
          style={({ pressed }) => [styles.fabButton, pressed && styles.fabPressed]}
          hitSlop={10}
        >
          <LinearGradient colors={['#00D9FF', '#8A2BE2']} start={{ x: 0.0, y: 0.0 }} end={{ x: 1.0, y: 1.0 }} style={StyleSheet.absoluteFill} />
          <View style={styles.fabIcon}>
            <View style={styles.fabPlusH} />
            <View style={styles.fabPlusV} />
          </View>
        </Pressable>
        <Text style={[styles.label, props.focused && styles.labelFocused]} numberOfLines={1}>
          {props.label}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.a11yLabel || props.label}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
      hitSlop={8}
    >
      <Animated.View style={[styles.iconArea, { transform: [{ scale }] }]}>
        {props.focused ? <View style={styles.activePill} /> : null}
        {props.renderIcon ? props.renderIcon(color) : null}
      </Animated.View>
      <Text style={[styles.label, { color }, props.focused && styles.labelFocused]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

export default function ZenTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const a11y = useA11yState();
  const focusOverride = null;

  const visibleRoutes = useMemo(() => {
    // Hard whitelist so "utility" routes inside the (tabs) group never leak into the tab bar.
    // This is more robust than relying on Expo Router's `href: null` alone (custom tab bars
    // can accidentally re-render hidden routes).
    const allowed = new Set(['index', 'teams', 'log/index', 'community/index', 'profile']);
    return state.routes.filter((route) => {
      if (!allowed.has(String(route.name))) return false;
      const options: any = descriptors[route.key]?.options;
      // Expo Router hides tabs with `href: null`, but don't rely on that alone.
      if (options?.href === null) return false;
      if (options?.tabBarButton === null) return false;
      return true;
    });
  }, [state.routes, descriptors]);

  const barHeight = useMemo(() => {
    const base = 62;
    return base + Math.max(0, insets.bottom);
  }, [insets.bottom]);

  return (
    <View style={[styles.container, { height: barHeight, paddingBottom: Math.max(0, insets.bottom) }]}>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: a11y.reduceTransparency ? 'rgba(7,11,13,0.96)' : 'rgba(7,11,13,0.92)' }, // dark glass
        ]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(9,9,9,0.00)', 'rgba(9,9,9,0.92)']}
        start={{ x: 0.5, y: 0.0 }}
        end={{ x: 0.5, y: 1.0 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.hairline} />

      <View style={styles.row}>
        {visibleRoutes.map((route) => {
          const { options } = descriptors[route.key];
          const focused = state.routes[state.index]?.key === route.key || focusOverride === route.name;
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : typeof options.title === 'string'
              ? options.title
              : String(route.name);

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (event.defaultPrevented) return;
            if (!focused) {
              void Haptics.selectionAsync().catch(() => {});
            }
            navigation.navigate(route.name);
          };

          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          const isFab = String(route.name).includes('log');
          const tabBarIcon = options.tabBarIcon;

          return (
            <TabItem
              key={route.key}
              label={label}
              focused={focused}
              onPress={onPress}
              onLongPress={onLongPress}
              a11yLabel={options.tabBarAccessibilityLabel}
              renderIcon={
                typeof tabBarIcon === 'function'
                  ? (color) => tabBarIcon({ focused, color, size: 24 })
                  : undefined
              }
              kind={isFab ? 'fab' : 'default'}
              reduceMotion={a11y.reduceMotion}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    paddingHorizontal: TOKENS.spacing[2],
    paddingTop: 8,
  },
  hairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: TOKENS.color.stroke,
  },
  row: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },

  item: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'flex-end' },
  itemPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },

  iconArea: { width: 42, height: 34, alignItems: 'center', justifyContent: 'center' },
  activePill: {
    position: 'absolute',
    width: 44,
    height: 34,
    borderRadius: TOKENS.radius.card,
    backgroundColor: TOKENS.color.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.22)',
  },
  label: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.60)',
    ...Platform.select({ ios: { letterSpacing: 0.2 }, default: {} }),
  },
  labelFocused: { color: TOKENS.color.accent },

  fabSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  fabButton: {
    width: 58,
    height: 58,
    borderRadius: 18,
    marginTop: -18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 10 },
      default: {},
    }),
  },
  fabPressed: { opacity: 0.92, transform: [{ scale: 0.985 }] },
  fabIcon: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  fabPlusH: { position: 'absolute', width: 18, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  fabPlusV: { position: 'absolute', width: 3, height: 18, borderRadius: 2, backgroundColor: '#FFFFFF' },
});
