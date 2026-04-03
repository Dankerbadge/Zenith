import { router } from 'expo-router'; import React, { useCallback, useState } from 'react'; import { useFocusEffect } from '@react-navigation/native'; import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import { listModerationActions, listReportsForUser } from '../../utils/moderationService';
import { useAuth } from '../context/authcontext';

export default function SafetyScreen() {
  const { supabaseUserId } = useAuth();
  const [reportCount, setReportCount] = useState(0);
  const [openReports, setOpenReports] = useState(0);
  const [actionCount, setActionCount] = useState(0);

  const load = useCallback(async () => {
    if (!supabaseUserId) {
      setReportCount(0);
      setOpenReports(0);
      setActionCount(0);
      return;
    }
    const [reports, actions] = await Promise.all([listReportsForUser(supabaseUserId), listModerationActions()]);
    setReportCount(reports.length);
    setOpenReports(reports.filter((r) => r.status === 'open').length);
    setActionCount(actions.length);
  }, [supabaseUserId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}><Text style={styles.back}>Back</Text></Pressable>
          <Text style={styles.title}>Safety Center</Text>
          <View style={{ width: 40 }} />
        </View>

        {!supabaseUserId ? (
          <GlassCard>
            <Text style={styles.section}>Sign in required</Text>
            <Text style={styles.item}>Sign in to view your report history and safety actions.</Text>
          </GlassCard>
        ) : null}

        <GlassCard>
          <Text style={styles.section}>Reporting</Text>
          <Text style={styles.item}>- Reports submitted: {reportCount}</Text>
          <Text style={styles.item}>- Open reports: {openReports}</Text>
          <Text style={styles.item}>- Reports are deduplicated to reduce spam loops.</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Moderation actions</Text>
          <Text style={styles.item}>- Logged moderation actions: {actionCount}</Text>
          <Text style={styles.item}>- Blocking and muting always override social visibility and messaging.</Text>
        </GlassCard>

        <View style={{ height: 10 }} />
        <GlassCard>
          <Text style={styles.section}>Where to report</Text>
          <Text style={styles.item}>- Community feed cards: report event/user</Text>
          <Text style={styles.item}>- Message threads: report message/user</Text>
          <Text style={styles.item}>- Club members: report user in club context</Text>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  back: { color: '#7EDCFF', fontWeight: '700' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 20 },
  section: { color: '#FFF', fontWeight: '800', marginBottom: 8 },
  item: { color: '#D0D0D0', fontWeight: '600', marginBottom: 6 },
});
