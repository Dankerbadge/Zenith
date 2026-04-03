import { Stack } from 'expo-router';

export default function ModalsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, presentation: 'modal' }}>
      {/* Register modal routes explicitly to avoid blank modal shells on iOS. */}
      <Stack.Screen name="food" />
      <Stack.Screen name="food-scan" />
      <Stack.Screen name="food-photo-scan" />
      <Stack.Screen name="water" />
      <Stack.Screen name="weight" />
      <Stack.Screen name="walk" />
      <Stack.Screen name="rest" />
      <Stack.Screen name="workout" />
      <Stack.Screen name="workout-session" />
      <Stack.Screen
        name="streak"
        options={{
          presentation: 'transparentModal',
          animation: 'fade',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </Stack>
  );
}
