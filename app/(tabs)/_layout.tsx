import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import ZenTabBar from '@/components/navigation/ZenTabBar';
import { TOKENS } from '@/constants/tokens';

type TabType = 'home' | 'teams' | 'log' | 'community' | 'profile';
type Gradient2 = readonly [string, string];

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

      {type === 'community' && (
        <View style={styles.communityIcon}>
          <View style={[styles.communityHead, { backgroundColor: color }]} />
          <View style={[styles.communityHead, { backgroundColor: color, marginLeft: -6, opacity: 0.9 }]} />
          <View style={[styles.communityBody, { borderTopColor: color }]} />
        </View>
      )}

      {type === 'teams' && (
        <View style={styles.teamsIcon}>
          <View style={[styles.teamsTop, { backgroundColor: color }]} />
          <View style={[styles.teamsMid, { borderColor: color }]} />
          <View style={[styles.teamsBase, { backgroundColor: color }]} />
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
      tabBar={(props) => <ZenTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: TOKENS.color.surface0 },
      }}
    >
      {/* Main tabs */}

      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} type="home" />,
        }}
      />

      <Tabs.Screen
        name="teams"
        options={{
          title: 'Teams',
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} type="teams" />,
        }}
      />

      <Tabs.Screen
        name="log/index"
        options={{
          title: 'Log',
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} type="log" />,
        }}
      />

      <Tabs.Screen
        name="community/index"
        options={{
          title: 'Community',
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} type="community" />,
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} type="profile" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Home icon
  iconDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginBottom: 2,
  },
  iconRoof: {
    width: 18,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },

  // Community icon
  communityIcon: { alignItems: 'center' },
  communityHead: { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },
  communityBody: { width: 20, height: 0, borderTopWidth: 3, borderRadius: 3 },

  // Log icon (plus)
  logButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  plusIcon: { width: 16, height: 16, justifyContent: 'center', alignItems: 'center' },
  plusHorizontal: { position: 'absolute', width: 16, height: 3, borderRadius: 2 },
  plusVertical: { position: 'absolute', width: 3, height: 16, borderRadius: 2 },

  // Teams icon
  teamsIcon: { width: 22, height: 18, alignItems: 'center', justifyContent: 'center' },
  teamsTop: { width: 16, height: 3, borderRadius: 2, marginBottom: 3 },
  teamsMid: { width: 20, height: 9, borderRadius: 3, borderWidth: 2, marginBottom: 2 },
  teamsBase: { width: 14, height: 3, borderRadius: 2 },

  // Profile icon
  profileIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileHead: { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },
  profileBody: {
    width: 14,
    height: 0,
    borderTopWidth: 3,
    borderRadius: 3,
  },
});
