import React from 'react';
import { Stack } from 'expo-router';

export default function ProgressLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="training-load" />
      <Stack.Screen name="readiness" />
      <Stack.Screen name="insights" />
      <Stack.Screen name="nutrition" />
      <Stack.Screen name="export" />
      <Stack.Screen name="routes" />
      <Stack.Screen name="routes/[routeId]" />
      <Stack.Screen name="body-map" />
    </Stack>
  );
}
