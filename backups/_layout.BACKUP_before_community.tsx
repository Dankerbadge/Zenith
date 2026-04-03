import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

type TabType = 'home' | 'stats' | 'log' | 'rank' | 'profile';
type Gradient2 = readonly [string, string];

function getBacklightColors(type: TabType): Gradient2 {
  switch (type) {
    case 'home':
      return ['rgba(0, 217, 255, 0.22)', 'rgba(138, 43, 226, 0.22)'] as const;
    case 'stats':
      return ['rgba(255, 107, 53, 0.22)', 'rgba(255, 215, 0, 0.22)'] as const;
    case 'log':
      return ['rgba(138, 43, 226, 0.24)', 'rgba(255, 20, 147, 0.24)'] as const;
    case 'rank':
      return ['rgba(255, 215, 0, 0.22)', 'rgba(255, 165, 0, 0.22)'] as const;
    case 'profile':
      return ['rgba(0, 255, 136, 0.22)', 'rgba(0, 217, 255, 0.22)'] as const;
  }
}

function TabBarButton(props: any & { type: TabType }) {
  const { children, onPress, onLongPress, accessibilityState, type, style, ...rest } = props;
  const focused = !!accessibilityState?.selected;

  // Adaptive intensity: center Log tab gets a stronger, more premium glow
  const intensity = type === 'log' ? 1.25 : 1.0;

  // Animation values (fade + slight scale)
  const anim = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: focused ? 1 : 0,
      duration: focused ? 180 : 140,
      easing: focused ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [focused, anim]);

  const animatedStyle = useMemo(
    () => ({
      opacity: anim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
      }),
      transform: [
        {
          scale: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.96, 1],
          }),
        },
      ],
    }),
    [anim]
  );

  const [c1, c2] = getBacklightColors(type);

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={[styles.tabButton, style]} {...rest}>
      {/* Natural glow layers (animated) */}
      <Animated.View pointerEvents="none" style={[styles.glowContainer, animatedStyle]}>
        {/* Soft glow blob */}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0)', c1] as const}
          start={{ x: 0.5, y: 1 }}
          end={{ x: 0.5, y: 0 }}
          style={[styles.glowBlob, { opacity: 0.85 * intensity }]}
        />

        {/* Bottom tint anchor */}
        <LinearGradient
          pointerEvents="none"
          colors={[c2, 'rgba(0,0,0,0)'] as const}
          start={{ x: 0.5, y: 1 }}
          end={{ x: 0.5, y: 0 }}
          style={[styles.bottomTint, { opacity: 0.50 * intensity }]}
        />
      </Animated.View>

      {/* Icon + label */}
      <View style={styles.tabContent}>{children}</View>
    </Pressable>
  );
}

function TabIcon({ color, focused, type }: { color: string; focused: boolean; type: TabType }) {
  const logButtonColors: Gradient2 = focused
    ? (['#00D9FF', '#8A2BE2'] as const)
    : (['#2A2A2A', '#1A1A1A'] as const);

  return (
    <View style={styles.iconWrap}>
      {type === 'home' && (
        <>
          <View style={[styles.iconDot, { backgroundColor: color }]} />
          <View style={[styles.iconRoof, { borderBottomColor: color }]} />
        </>
      )}

      {type === 'stats' && (
        <View style={styles.chartBars}>
          <View style={[styles.bar, styles.bar1, { backgroundColor: color }]} />
          <View style={[styles.bar, styles.bar2, { backgroundColor: color }]} />
          <View style={[styles.bar, styles.bar3, { backgroundColor: color }]} />
        </View>
      )}

      {type === 'log' && (
        <LinearGradient colors={logButtonColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logButton}>
          <View style={styles.plusIcon}>
            <View style={[styles.plusHorizontal, { backgroundColor: focused ? '#FFF' : '#888' }]} />
            <View style={[styles.plusVertical, { backgroundColor: focused ? '#FFF' : '#888' }]} />
          </View>
        </LinearGradient>
      )}

      {type === 'rank' && (
        <View style={[styles.trophy, { borderColor: color }]}>
          <View style={[styles.trophyTop, { backgroundColor: color }]} />
          <View style={[styles.trophyBase, { backgroundColor: color }]} />
        </View>
      )}

      {type === 'profile' && (
        <View style={[styles.profileIcon, { borderColor: color }]}>
          <View style={[styles.profileHead, { backgroundColor: color }]} />
          <View style={[styles.profileBody, { borderTopColor: color }]} />
        </View>
      )}
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarItemStyle: { flex: 1, paddingHorizontal: 0 },
        tabBarStyle: {
          backgroundColor: '#0A0A0A',
          borderTopWidth: 0,
          height: 90,
          paddingBottom: 30,
          paddingTop: 10,
          paddingHorizontal: 0,
          marginHorizontal: 0,
        },
        tabBarActiveTintColor: '#00D9FF',
        tabBarInactiveTintColor: '#666',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 4 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarButton: (props) => <TabBarButton {...props} type="home" />,
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} type="home" />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarButton: (props) => <TabBarButton {...props} type="stats" />,
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} type="stats" />,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Log',
          tabBarButton: (props) => <TabBarButton {...props} type="log" />,
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} type="log" />,
        }}
      />
      <Tabs.Screen
        name="rank"
        options={{
          title: 'Rank',
          tabBarButton: (props) => <TabBarButton {...props} type="rank" />,
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} type="rank" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarButton: (props) => <TabBarButton {...props} type="profile" />,
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} type="profile" />,
        }}
      />

      <Tabs.Screen name="achievements" options={{ href: null }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="social" options={{ href: null }} />
      <Tabs.Screen name="store" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabButton: { flex: 1 },
  tabContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Animated container that stays inside the tab item (no overlap into content above)
  glowContainer: {
    ...StyleSheet.absoluteFillObject,
  },

  // Soft blob — natural light (confined to tab bounds)
  glowBlob: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
  },

  // Bottom tint — anchors light to the tab bar
  bottomTint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 42,
  },

  iconWrap: { alignItems: 'center', justifyContent: 'center' },

  logButton: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  plusIcon: { width: 18, height: 18 },
  plusHorizontal: { position: 'absolute', width: 18, height: 2.5, top: 7.75, borderRadius: 2 },
  plusVertical: { position: 'absolute', width: 2.5, height: 18, left: 7.75, borderRadius: 2 },

  iconDot: { width: 4, height: 4, borderRadius: 2, marginBottom: 2, alignSelf: 'center' },
  iconRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    alignSelf: 'center',
  },

  chartBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: { width: 4, borderRadius: 2 },
  bar1: { height: 10 },
  bar2: { height: 16 },
  bar3: { height: 12 },

  trophy: { width: 16, height: 16, borderWidth: 2, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomWidth: 0 },
  trophyTop: { width: 4, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: -6 },
  trophyBase: { width: 12, height: 3, alignSelf: 'center', marginTop: 16, borderRadius: 1 },

  profileIcon: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  profileHead: { width: 4, height: 4, borderRadius: 2, marginTop: -2 },
  profileBody: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: 1,
  },
});
