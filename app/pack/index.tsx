import { Redirect } from 'expo-router';

export default function PackIndex() {
  // The pack route requires an id today (pack/[id]).
  // Redirect to Home instead of crashing on deep links to /pack.
  return <Redirect href="/(tabs)" />;
}

