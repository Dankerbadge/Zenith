import { Redirect } from 'expo-router';

export default function StatsIndex() {
  // Stats is no longer a main tab; route to the Progress hub.
  return <Redirect href={'/account/progress' as any} />;
}
