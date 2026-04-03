import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BottomSheet from '../../components/ui/BottomSheet';
import Chip from '../../components/ui/Chip';
import GlassCard from '../../components/ui/GlassCard';
import ModuleCard from '../../components/ui/ModuleCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { eventTypeLabel, formatTimeWindow, getEventSource } from '../../utils/eventsUi';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

type HubTab = 'overview' | 'schedule' | 'checklist' | 'location' | 'chat';
type RsvpStatus = 'going' | 'maybe' | 'not_going';

type ChecklistStateV1 = {
  sharedDone: Record<string, boolean>;
  personal: { id: string; text: string; done: boolean }[];
};

const CHECKLIST_KEY_PREFIX = 'event_checklist_state_v1:';
const RSVP_REMINDERS_OPTIN_PREFIX = 'event_rsvp_reminders_optin_v1:';

function rsvpLabel(status?: string | null) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'going') return 'Going';
  if (s === 'maybe') return 'Maybe';
  if (s === 'not_going') return "Can't go";
  return 'RSVP';
}

function readEventRsvpForViewer(event: any, viewerUserId: string | null) {
  if (!viewerUserId) return null;
  const rows = Array.isArray(event?.rsvps) ? event.rsvps : [];
  return rows.find((r: any) => String(r?.user_id || '') === viewerUserId) || null;
}

function defaultChecklistByType(typeRaw: any): string[] {
  const t = String(typeRaw || '').trim().toLowerCase();
  if (t === 'race') return ['Bib', 'Timing chip', 'Race kit', 'Nutrition', 'Travel docs', 'Sunscreen'];
  if (t === 'training') return ['Shoes', 'Hydration', 'Warm layers'];
  if (t === 'travel') return ['Tickets', 'ID', 'Gear bag'];
  if (t === 'meeting') return ['Agenda', 'Notes'];
  if (t === 'social') return ['Cash/card', 'Jacket'];
  return ['Essentials', 'Water'];
}

function mapsUrl(query: string) {
  const q = encodeURIComponent(query);
  if (Platform.OS === 'ios') return `http://maps.apple.com/?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function EventHubScreen() {
  const params = useLocalSearchParams<{ eventId?: string; rsvp?: string }>();
  const eventId = String(params.eventId || '').trim();
  const openRsvpOnLoad = String(params.rsvp || '').trim() === '1';

  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [tab, setTab] = useState<HubTab>('overview');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<any | null>(null);

  const [canEdit, setCanEdit] = useState(false);

  const [rsvpOpen, setRsvpOpen] = useState(false);
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus>('going');
  const [rsvpAnswers, setRsvpAnswers] = useState<Record<string, any>>({});
  const [rsvpSaving, setRsvpSaving] = useState(false);
  const [rsvpRemindersOptIn, setRsvpRemindersOptIn] = useState(true);
  const [eventFollowed, setEventFollowed] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('08:00');
  const [scheduleLabel, setScheduleLabel] = useState('');

  const [sharedChecklistDraft, setSharedChecklistDraft] = useState('');
  const [checklistState, setChecklistState] = useState<ChecklistStateV1>({ sharedDone: {}, personal: [] });
  const [personalDraft, setPersonalDraft] = useState('');

  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatPosts, setChatPosts] = useState<any[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  const checklistKey = useMemo(() => `${CHECKLIST_KEY_PREFIX}${eventId}:${viewerUserId || 'anon'}`, [eventId, viewerUserId]);
  const remindersOptKey = useMemo(() => `${RSVP_REMINDERS_OPTIN_PREFIX}${eventId}:${viewerUserId || 'anon'}`, [eventId, viewerUserId]);

  const viewerRsvpRow = useMemo(() => (event ? readEventRsvpForViewer(event, viewerUserId) : null), [event, viewerUserId]);
  const viewerRsvpStatus = String(viewerRsvpRow?.status || '').trim().toLowerCase() as RsvpStatus | '';

  const rsvpCounts = useMemo(() => {
    const rows = Array.isArray(event?.rsvps) ? event.rsvps : [];
    const counts = { going: 0, maybe: 0, not_going: 0 };
    rows.forEach((r: any) => {
      const s = String(r?.status || '').trim().toLowerCase();
      if (s === 'going') counts.going += 1;
      else if (s === 'maybe') counts.maybe += 1;
      else if (s === 'not_going') counts.not_going += 1;
    });
    return counts;
  }, [event?.rsvps]);

  const load = useCallback(async () => {
    if (!viewerUserId || !eventId || !isSupabaseConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const row = await socialApi.getEvent(eventId);
      setEvent(row || null);
      try {
        const followed = await socialApi.isFollowingEvent(viewerUserId, eventId);
        setEventFollowed(followed);
      } catch {
        setEventFollowed(false);
      }

      // Best-effort permissions: group owner/admin/mod OR team coach.
      let editable = false;
      try {
        if (!row?.group_id) {
          editable = true;
        } else {
          const groupId = String(row.group_id);
          const group = row?.groups || null;
          const joinCode = String(group?.join_code || '');
          const groupKind = String(group?.kind || '').trim().toLowerCase();
          const [myGroups, myTeams] = await Promise.all([socialApi.getMyGroups(viewerUserId), socialApi.getMyTeams(viewerUserId)]);
          const membership = (Array.isArray(myGroups) ? myGroups : []).find((g: any) => String(g?.group_id || '') === groupId) || null;
          const role = String(membership?.role || '').trim().toLowerCase();
          const groupAdmin = role === 'owner' || role === 'admin' || role === 'mod';
          if (groupAdmin) editable = true;

          const isTeamGroup = groupKind === 'coaching_team' || joinCode.toLowerCase().startsWith('team:');
          if (!editable && isTeamGroup && joinCode.toLowerCase().startsWith('team:')) {
            const teamId = joinCode.split(':')[1] || '';
            const teamRows = Array.isArray(myTeams) ? myTeams : [];
            const teamRow = teamRows.find((t: any) => String(t?.team_id || t?.teams?.id || '') === teamId) || null;
            const teamRole = String(teamRow?.role || '').trim().toLowerCase();
            editable = teamRow != null && (teamRole === 'owner' || teamRole === 'admin' || teamRole === 'coach' || teamRole === 'trainer');
          }
        }
      } catch {
        editable = false;
      }
      setCanEdit(editable);
    } catch (err: any) {
      setError(String(err?.message || 'Unable to load event.'));
      setEvent(null);
      setCanEdit(false);
    } finally {
      setLoading(false);
    }
  }, [viewerUserId, eventId]);

  const loadChecklist = useCallback(async () => {
    if (!eventId) return;
    const raw = await AsyncStorage.getItem(checklistKey);
    const parsed = safeJsonParse<ChecklistStateV1>(raw, { sharedDone: {}, personal: [] });
    setChecklistState(parsed);
  }, [checklistKey, eventId]);

  const persistChecklist = useCallback(
    async (next: ChecklistStateV1) => {
      setChecklistState(next);
      try {
        await AsyncStorage.setItem(checklistKey, JSON.stringify(next));
      } catch {
        // ignore
      }
    },
    [checklistKey]
  );

  const loadChat = useCallback(async () => {
    if (!viewerUserId || !eventId || !isSupabaseConfigured) return;
    const groupId = String(event?.group_id || '').trim();
    if (!groupId) {
      setChatPosts([]);
      setChatError(null);
      return;
    }
    setChatLoading(true);
    setChatError(null);
    try {
      const rows = await socialApi.getEventChatPosts(groupId, eventId, 60);
      setChatPosts(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      setChatError(String(err?.message || 'Unable to load chat.'));
      setChatPosts([]);
    } finally {
      setChatLoading(false);
    }
  }, [viewerUserId, eventId, event?.group_id]);

  const loadRsvpPrefs = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(remindersOptKey);
      if (raw === null) {
        setRsvpRemindersOptIn(true);
        return;
      }
      setRsvpRemindersOptIn(raw === 'true');
    } catch {
      setRsvpRemindersOptIn(true);
    }
  }, [remindersOptKey]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useFocusEffect(
    useCallback(() => {
      void loadChecklist();
      void loadRsvpPrefs();
    }, [loadChecklist, loadRsvpPrefs])
  );

  useFocusEffect(
    useCallback(() => {
      if (tab !== 'chat') return;
      void loadChat();
    }, [tab, loadChat])
  );

  useEffect(() => {
    if (!openRsvpOnLoad) return;
    // Only auto-open after the event is loaded (avoids flashing).
    if (!loading && event) setRsvpOpen(true);
  }, [openRsvpOnLoad, loading, event]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
      await loadChat();
    } finally {
      setRefreshing(false);
    }
  };

  const openDirections = async () => {
    const locName = String(event?.location_name || '').trim();
    const address = String(event?.location_address || '').trim();
    const query = (locName + ' ' + address).trim();
    if (!query) {
      Alert.alert('No location', 'This event does not have a location yet.');
      return;
    }
    const url = mapsUrl(query);
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert('Maps unavailable', 'No maps provider is available on this device.');
      return;
    }
    await Linking.openURL(url);
  };

  const shareEvent = async () => {
    const title = String(event?.title || 'Event').trim() || 'Event';
    const when = String(event?.start_at ? new Date(String(event.start_at)).toLocaleString() : '—');
    const where = String(event?.location_name || event?.location_address || '').trim();
    const text = `${title}\nWhen: ${when}${where ? `\nWhere: ${where}` : ''}`;
    try {
      await Share.share({ message: text });
    } catch {
      // ignore
    }
  };

  const toggleFollowEvent = async () => {
    if (!viewerUserId || !eventId || followBusy) return;
    const next = !eventFollowed;
    setFollowBusy(true);
    setEventFollowed(next);
    try {
      if (next) await socialApi.followEvent(viewerUserId, eventId);
      else await socialApi.unfollowEvent(viewerUserId, eventId);
    } catch (err: any) {
      setEventFollowed(!next);
      Alert.alert('Unable to update', String(err?.message || 'Try again.'));
    } finally {
      setFollowBusy(false);
    }
  };

  const openRsvp = () => {
    const current = viewerRsvpStatus === 'going' || viewerRsvpStatus === 'maybe' || viewerRsvpStatus === 'not_going' ? viewerRsvpStatus : 'going';
    setRsvpStatus(current as RsvpStatus);
    setRsvpAnswers(safeJsonParse<Record<string, any>>(JSON.stringify(viewerRsvpRow?.answers || {}), {}));
    setRsvpOpen(true);
  };

  const submitRsvp = async () => {
    if (!viewerUserId || !eventId) return;
    if (rsvpSaving) return;
    setRsvpSaving(true);
    try {
      await socialApi.upsertEventRsvp(viewerUserId, eventId, rsvpStatus, rsvpAnswers);
      try {
        await AsyncStorage.setItem(remindersOptKey, rsvpRemindersOptIn ? 'true' : 'false');
      } catch {
        // ignore
      }
      setRsvpOpen(false);
      await load();
    } catch (err: any) {
      Alert.alert('RSVP failed', String(err?.message || 'Try again.'));
    } finally {
      setRsvpSaving(false);
    }
  };

  const scheduleItems = useMemo(() => {
    const raw = event?.schedule_items;
    const list = Array.isArray(raw) ? raw : [];
    return list
      .map((row: any) => ({
        id: String(row?.id || ''),
        time: String(row?.time || ''),
        label: String(row?.label || ''),
      }))
      .filter((r) => r.id && r.label);
  }, [event?.schedule_items]);

  const sharedChecklist = useMemo(() => {
    const raw = event?.checklist_shared;
    const list = Array.isArray(raw) ? raw : [];
    return list
      .map((row: any) => ({ id: String(row?.id || ''), text: String(row?.text || '') }))
      .filter((r) => r.id && r.text);
  }, [event?.checklist_shared]);

  const updateSchedule = async (next: any[]) => {
    if (!eventId) return;
    try {
      const updated = await socialApi.updateEvent(eventId, { schedule_items: next });
      setEvent((prev: any) => ({ ...(prev || {}), ...(updated || {}) }));
    } catch (err: any) {
      Alert.alert('Update failed', String(err?.message || 'Try again.'));
    }
  };

  const updateSharedChecklist = async (next: any[]) => {
    if (!eventId) return;
    try {
      const updated = await socialApi.updateEvent(eventId, { checklist_shared: next });
      setEvent((prev: any) => ({ ...(prev || {}), ...(updated || {}) }));
    } catch (err: any) {
      Alert.alert('Update failed', String(err?.message || 'Try again.'));
    }
  };

  const addScheduleItem = async () => {
    const time = scheduleTime.trim();
    const label = scheduleLabel.trim();
    if (!time || !label) return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const next = [...scheduleItems, { id, time, label }];
    await updateSchedule(next);
    setScheduleOpen(false);
    setScheduleLabel('');
  };

  const applyChecklistDefaults = async () => {
    if (!canEdit) return;
    const defaults = defaultChecklistByType(event?.event_type).map((text) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text,
    }));
    await updateSharedChecklist(defaults);
  };

  const sendChat = async () => {
    if (!viewerUserId || !eventId) return;
    const groupId = String(event?.group_id || '').trim();
    if (!groupId) return;
    const text = chatDraft.trim();
    if (!text) return;
    if (sendingChat) return;
    setSendingChat(true);
    try {
      setChatDraft('');
      await socialApi.sendEventChatMessage(viewerUserId, groupId, eventId, text);
      await loadChat();
    } catch (err: any) {
      Alert.alert('Send failed', String(err?.message || 'Try again.'));
    } finally {
      setSendingChat(false);
    }
  };

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;
  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}><Text style={styles.empty}>Sign in to view events.</Text></View>
      </SafeAreaView>
    );
  }
  if (!isSupabaseConfigured) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}><Text style={styles.empty}>Cloud sync is required.</Text></View>
      </SafeAreaView>
    );
  }
  if (!eventId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Invalid event link.</Text>
          <Pressable style={styles.centerCta} onPress={() => router.back()}>
            <Text style={styles.centerCtaText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const title = String(event?.title || 'Event').trim() || 'Event';
  const when = String(event?.start_at ? new Date(String(event.start_at)).toLocaleString() : '—');
  const timeRange = formatTimeWindow(event?.start_at, event?.end_at);
  const where = String(event?.location_name || '').trim();
  const source = event ? getEventSource(event) : 'personal';

  const questions = Array.isArray(event?.rsvp_questions) ? event.rsvp_questions : [];

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor='#8FDBFF' />}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {canEdit ? (
            <Pressable onPress={() => router.push(`/events/edit?eventId=${encodeURIComponent(eventId)}` as any)} style={styles.headerAction}>
              <Text style={styles.headerActionText}>Edit</Text>
            </Pressable>
          ) : (
            <Pressable onPress={shareEvent} style={styles.headerAction}>
              <Text style={styles.headerActionText}>Share</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.tabsRow}>
          {([
            { key: 'overview', label: 'Overview' },
            { key: 'schedule', label: 'Schedule' },
            { key: 'checklist', label: 'Checklist' },
            { key: 'location', label: 'Location' },
            { key: 'chat', label: 'Chat' },
          ] as const).map((t) => {
            const active = tab === t.key;
            return (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tabChip, active && styles.tabChipOn]}>
                <Text style={[styles.tabChipText, active && styles.tabChipTextOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <GlassCard>
            <Text style={styles.empty}>Event backend error.</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void load()} disabled={loading}>
              <Text style={styles.retryText}>{loading ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        {loading ? <Text style={styles.empty}>Loading event…</Text> : null}

        {!loading && !error && event ? (
          <>
            {tab === 'overview' ? (
              <>
                <ModuleCard title="When" subtitle={timeRange} variant="hero">
                  <Text style={styles.value}>{when}</Text>
                </ModuleCard>

                <ModuleCard title="Actions" variant="list">
                  <View style={styles.actionsRow}>
                    {event?.rsvp_enabled ? (
                      <Pressable style={styles.actionBtn} onPress={openRsvp}>
                        <Text style={styles.actionBtnText}>{rsvpLabel(viewerRsvpStatus || null)}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable style={styles.actionBtn} onPress={shareEvent}>
                      <Text style={styles.actionBtnText}>Share</Text>
                    </Pressable>
                    <Pressable style={styles.actionBtn} onPress={openDirections}>
                      <Text style={styles.actionBtnText}>Directions</Text>
                    </Pressable>
                    <Pressable
                      style={styles.actionBtn}
                      onPress={async () => {
                        // Minimal Add-to-Calendar: share a structured note the user can paste into calendar.
                        await shareEvent();
                      }}
                    >
                      <Text style={styles.actionBtnText}>Add to calendar</Text>
                    </Pressable>
                  </View>
                </ModuleCard>

                <ModuleCard title="Key notes">
                  {event?.description ? <Text style={styles.body}>{String(event.description)}</Text> : <Text style={styles.empty}>No notes yet.</Text>}
                </ModuleCard>

                {event?.rsvp_enabled ? (
                  <ModuleCard title="Attendees" subtitle={`${rsvpCounts.going} going • ${rsvpCounts.maybe} maybe`}>
                    {!Array.isArray(event?.rsvps) || !event.rsvps.length ? (
                      <Text style={styles.empty}>No RSVPs yet.</Text>
                    ) : (
                      <View style={styles.attendeeList}>
                        {event.rsvps.slice(0, 10).map((r: any) => (
                          <View key={`${r.user_id}_${r.updated_at}`} style={styles.attendeeRow}>
                            <Text style={styles.attendeeName}>
                              {String(r?.profiles?.display_name || r?.profiles?.username || 'Athlete')}
                            </Text>
                            <Text style={styles.attendeeMeta}>{rsvpLabel(String(r?.status || ''))}</Text>
                          </View>
                        ))}
                        {event.rsvps.length > 10 ? <Text style={styles.helperText}>+{event.rsvps.length - 10} more</Text> : null}
                      </View>
                    )}
                  </ModuleCard>
                ) : null}

                <ModuleCard title="Details" variant="list">
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Source</Text>
                    <Text style={styles.detailValue}>{source === 'team' ? 'Team' : source === 'group' ? 'Group' : 'Personal'}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Type</Text>
                    <Text style={styles.detailValue}>{eventTypeLabel(event?.event_type)}</Text>
                  </View>
                </ModuleCard>
              </>
            ) : null}

            {tab === 'schedule' ? (
              <>
                <SectionHeader title="SCHEDULE" />
                <GlassCard>
                  {canEdit ? (
                    <Pressable style={styles.primaryWide} onPress={() => setScheduleOpen(true)}>
                      <Text style={styles.primaryWideText}>+ Add timeline item</Text>
                    </Pressable>
                  ) : null}
                  {!scheduleItems.length ? <Text style={styles.empty}>No schedule items yet.</Text> : null}
                  {scheduleItems.length ? (
                    <View style={{ marginTop: 12, gap: 10 }}>
                      {scheduleItems.map((it) => (
                        <View key={it.id} style={styles.timelineRow}>
                          <Text style={styles.timelineTime}>{it.time || '—'}</Text>
                          <Text style={styles.timelineLabel}>{it.label}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </GlassCard>
              </>
            ) : null}

            {tab === 'checklist' ? (
              <>
                <SectionHeader title="CHECKLIST" />
                <GlassCard>
                  {!sharedChecklist.length && canEdit ? (
                    <Pressable style={styles.primaryWide} onPress={() => void applyChecklistDefaults()}>
                      <Text style={styles.primaryWideText}>Apply default checklist</Text>
                    </Pressable>
                  ) : null}

                  {sharedChecklist.length ? (
                    <>
                      <Text style={styles.kicker}>Shared</Text>
                      <View style={{ gap: 8, marginTop: 10 }}>
                        {sharedChecklist.map((item) => {
                          const done = Boolean(checklistState.sharedDone[item.id]);
                          return (
                            <Pressable
                              key={item.id}
                              style={[styles.checkRow, done && styles.checkRowDone]}
                              onPress={() => void persistChecklist({ ...checklistState, sharedDone: { ...checklistState.sharedDone, [item.id]: !done } })}
                            >
                              <Text style={[styles.checkBox, done && styles.checkBoxOn]}>{done ? '✓' : ''}</Text>
                              <Text style={[styles.checkText, done && styles.checkTextDone]}>{item.text}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  ) : (
                    <Text style={styles.empty}>No shared checklist yet.</Text>
                  )}

                  <View style={styles.divider} />
                  <Text style={styles.kicker}>Personal</Text>
                  <View style={styles.personalComposer}>
                    <TextInput
                      value={personalDraft}
                      onChangeText={setPersonalDraft}
                      placeholder="Add personal item"
                      placeholderTextColor="#7E8E93"
                      style={styles.personalInput}
                    />
                    <Pressable
                      style={[styles.smallBtn, !personalDraft.trim() && { opacity: 0.55 }]}
                      disabled={!personalDraft.trim()}
                      onPress={() => {
                        const text = personalDraft.trim();
                        if (!text) return;
                        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                        const next = { ...checklistState, personal: [...(checklistState.personal || []), { id, text, done: false }] };
                        setPersonalDraft('');
                        void persistChecklist(next);
                      }}
                    >
                      <Text style={styles.smallBtnText}>Add</Text>
                    </Pressable>
                  </View>

                  {!checklistState.personal.length ? <Text style={styles.empty}>No personal items yet.</Text> : null}
                  {checklistState.personal.length ? (
                    <View style={{ gap: 8, marginTop: 10 }}>
                      {checklistState.personal.map((item) => (
                        <Pressable
                          key={item.id}
                          style={[styles.checkRow, item.done && styles.checkRowDone]}
                          onPress={() => {
                            const next = {
                              ...checklistState,
                              personal: checklistState.personal.map((p) => (p.id === item.id ? { ...p, done: !p.done } : p)),
                            };
                            void persistChecklist(next);
                          }}
                        >
                          <Text style={[styles.checkBox, item.done && styles.checkBoxOn]}>{item.done ? '✓' : ''}</Text>
                          <Text style={[styles.checkText, item.done && styles.checkTextDone]}>{item.text}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </GlassCard>

                {canEdit ? (
                  <GlassCard style={{ marginTop: 12 }}>
                    <Text style={styles.kicker}>Add shared item</Text>
                    <View style={styles.personalComposer}>
                      <TextInput
                        value={sharedChecklistDraft}
                        onChangeText={setSharedChecklistDraft}
                        placeholder="Shared item"
                        placeholderTextColor="#7E8E93"
                        style={styles.personalInput}
                      />
                      <Pressable
                        style={[styles.smallBtn, !sharedChecklistDraft.trim() && { opacity: 0.55 }]}
                        disabled={!sharedChecklistDraft.trim()}
                        onPress={() => {
                          const text = sharedChecklistDraft.trim();
                          if (!text) return;
                          const next = [
                            ...sharedChecklist,
                            { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text },
                          ];
                          setSharedChecklistDraft('');
                          void updateSharedChecklist(next);
                        }}
                      >
                        <Text style={styles.smallBtnText}>Add</Text>
                      </Pressable>
                    </View>
                  </GlassCard>
                ) : null}
              </>
            ) : null}

            {tab === 'location' ? (
              <>
                <SectionHeader title="LOCATION" />
                <GlassCard>
                  {where ? (
                    <>
                      <Text style={styles.kicker}>Where</Text>
                      <Text style={styles.value}>{where}</Text>
                    </>
                  ) : (
                    <Text style={styles.empty}>No location set.</Text>
                  )}
                  {event?.location_address ? (
                    <>
                      <Text style={[styles.kicker, { marginTop: 12 }]}>Address</Text>
                      <Text style={styles.value}>{String(event.location_address)}</Text>
                    </>
                  ) : null}
                  {event?.meeting_notes ? (
                    <>
                      <Text style={[styles.kicker, { marginTop: 12 }]}>Meeting notes</Text>
                      <Text style={styles.body}>{String(event.meeting_notes)}</Text>
                    </>
                  ) : null}

                  <View style={styles.rowActions}>
                    <Pressable style={styles.primaryWide} onPress={() => void openDirections()}>
                      <Text style={styles.primaryWideText}>Directions</Text>
                    </Pressable>
                  </View>
                </GlassCard>
              </>
            ) : null}

            {tab === 'chat' ? (
              <>
                <SectionHeader title="CHAT" />
                <GlassCard>
                  {!event?.group_id ? (
                    <Text style={styles.empty}>Chat is available for group/team events.</Text>
                  ) : (
                    <>
                      {chatLoading ? <Text style={styles.empty}>Loading chat…</Text> : null}
                      {chatError ? <Text style={styles.errorText}>{chatError}</Text> : null}

                      {!chatLoading && !chatError && !chatPosts.length ? <Text style={styles.empty}>No messages yet.</Text> : null}

                      {chatPosts.length ? (
                        <View style={{ gap: 10 }}>
                          {chatPosts
                            .slice()
                            .reverse()
                            .slice(-40)
                            .map((p: any) => (
                              <View key={String(p?.id || Math.random())} style={styles.chatRow}>
                                <Text style={styles.chatAuthor}>{String(p?.profiles?.display_name || p?.profiles?.username || 'Athlete')}</Text>
                                <Text style={styles.chatBody}>{String(p?.content || '')}</Text>
                              </View>
                            ))}
                        </View>
                      ) : null}

                      <View style={[styles.personalComposer, { marginTop: 14 }]}>
                        <TextInput
                          value={chatDraft}
                          onChangeText={setChatDraft}
                          placeholder="Message"
                          placeholderTextColor="#7E8E93"
                          style={styles.personalInput}
                          editable={!sendingChat}
                        />
                        <Pressable
                          style={[styles.smallBtn, (!chatDraft.trim() || sendingChat) && { opacity: 0.55 }]}
                          disabled={!chatDraft.trim() || sendingChat}
                          onPress={() => void sendChat()}
                        >
                          <Text style={styles.smallBtnText}>{sendingChat ? '…' : 'Send'}</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </GlassCard>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <BottomSheet
        visible={rsvpOpen}
        title="RSVP"
        subtitle={event?.rsvp_enabled ? 'Choose your status.' : 'RSVP is disabled for this event. Use the actions below instead.'}
        onClose={() => setRsvpOpen(false)}
        scroll
        footer={
          <View style={{ gap: 10 }}>
            {event?.rsvp_enabled ? (
              <Pressable style={styles.sheetPrimary} onPress={() => void submitRsvp()} disabled={rsvpSaving}>
                <Text style={styles.sheetPrimaryText}>{rsvpSaving ? 'Saving…' : 'Continue'}</Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={styles.sheetPrimary} onPress={shareEvent}>
                  <Text style={styles.sheetPrimaryText}>Share event</Text>
                </Pressable>
                <Pressable style={styles.sheetPrimary} onPress={() => void toggleFollowEvent()} disabled={followBusy}>
                  <Text style={styles.sheetPrimaryText}>{followBusy ? 'Working…' : eventFollowed ? 'Unfollow event' : 'Follow event'}</Text>
                </Pressable>
                <Pressable
                  style={styles.sheetPrimary}
                  onPress={() => {
                    void shareEvent();
                  }}
                >
                  <Text style={styles.sheetPrimaryText}>Add to calendar</Text>
                </Pressable>
              </>
            )}
            <Pressable style={styles.sheetClose} onPress={() => setRsvpOpen(false)} disabled={rsvpSaving}>
              <Text style={styles.sheetCloseText}>Close</Text>
            </Pressable>
          </View>
        }
      >
        {event?.rsvp_enabled ? (
          <>
            <View style={styles.filterRow}>
              {(['going', 'maybe', 'not_going'] as const).map((status) => (
                <Chip
                  key={status}
                  label={status === 'not_going' ? "Can't" : status === 'going' ? 'Going ✅' : 'Maybe'}
                  active={rsvpStatus === status}
                  onPress={() => setRsvpStatus(status)}
                />
              ))}
            </View>

            {questions.length && (rsvpStatus === 'going' || rsvpStatus === 'maybe') ? (
              <View style={{ marginTop: 14, gap: 10 }}>
                <Text style={styles.kicker}>Questions</Text>
                {questions.map((q: any, idx: number) => {
                  const id = String(q?.id || `q${idx}`);
                  const label = String(q?.label || 'Question');
                  const type = String(q?.type || '').trim().toLowerCase();
                  if (type === 'select' && Array.isArray(q?.options)) {
                    const current = String(rsvpAnswers[id] || '');
                    return (
                      <View key={id}>
                        <Text style={styles.sheetLabel}>{label}</Text>
                        <View style={styles.filterRow}>
                          {q.options.map((opt: any) => {
                            const value = String(opt);
                            return (
                              <Chip
                                key={`${id}_${value}`}
                                label={value}
                                active={current === value}
                                onPress={() => setRsvpAnswers((prev) => ({ ...prev, [id]: value }))}
                              />
                            );
                          })}
                        </View>
                      </View>
                    );
                  }
                  return (
                    <View key={id}>
                      <Text style={styles.sheetLabel}>{label}</Text>
                      <TextInput
                        value={String(rsvpAnswers[id] || '')}
                        onChangeText={(v) => setRsvpAnswers((prev) => ({ ...prev, [id]: v }))}
                        placeholder="Answer"
                        placeholderTextColor="#7E8E93"
                        style={styles.sheetInput}
                      />
                    </View>
                  );
                })}
              </View>
            ) : null}

            {rsvpStatus === 'going' || rsvpStatus === 'maybe' ? (
              <View style={{ marginTop: 14 }}>
                <Text style={styles.kicker}>Reminders</Text>
                <View style={styles.rowSplit}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>Opt in to reminders</Text>
                    <Text style={styles.rowValue}>{"Uses the event's default reminder settings."}</Text>
                  </View>
                  <Pressable
                    onPress={() => setRsvpRemindersOptIn((p) => !p)}
                    style={[styles.togglePill, rsvpRemindersOptIn ? styles.toggleOn : styles.toggleOff]}
                  >
                    <View style={[styles.toggleThumb, rsvpRemindersOptIn ? styles.toggleThumbOn : styles.toggleThumbOff]} />
                  </Pressable>
                </View>
              </View>
            ) : null}
          </>
        ) : null}
        {!event?.rsvp_enabled ? (
          <View style={{ marginTop: 10, gap: 10 }}>
            <Text style={styles.kicker}>Available actions</Text>
            <Text style={styles.empty}>Use share, follow, or add-to-calendar for this event.</Text>
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={scheduleOpen}
        title="Add schedule item"
        subtitle="Timeline items appear in the Schedule tab."
        onClose={() => setScheduleOpen(false)}
        footer={
          <View style={{ gap: 10 }}>
            <Pressable style={styles.sheetPrimary} onPress={() => void addScheduleItem()}>
              <Text style={styles.sheetPrimaryText}>Add</Text>
            </Pressable>
            <Pressable style={styles.sheetClose} onPress={() => setScheduleOpen(false)}>
              <Text style={styles.sheetCloseText}>Close</Text>
            </Pressable>
          </View>
        }
      >
        <Text style={styles.sheetLabel}>Time (HH:MM)</Text>
        <TextInput value={scheduleTime} onChangeText={setScheduleTime} placeholder="08:00" placeholderTextColor="#7E8E93" style={styles.sheetInput} />
        <Text style={styles.sheetLabel}>Label</Text>
        <TextInput value={scheduleLabel} onChangeText={setScheduleLabel} placeholder="Meet at transition" placeholderTextColor="#7E8E93" style={styles.sheetInput} />
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 30 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { paddingVertical: 8, paddingHorizontal: 8, minWidth: 60 },
  backText: { color: '#7EDCFF', fontWeight: '800' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 18, flex: 1, textAlign: 'center' },
  headerAction: { minWidth: 60, paddingVertical: 8, paddingHorizontal: 8, alignItems: 'flex-end' },
  headerActionText: { color: '#8EDFFF', fontWeight: '900' },

  tabsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 12 },
  tabChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(20,20,20,0.85)',
  },
  tabChipOn: { borderColor: 'rgba(0,217,255,0.55)', backgroundColor: 'rgba(0,217,255,0.14)' },
  tabChipText: { color: '#C7C7C7', fontWeight: '900', fontSize: 12 },
  tabChipTextOn: { color: '#EAFBFF' },

  empty: { color: '#C7C7C7', fontWeight: '700', textAlign: 'center', marginTop: 10 },
  errorText: { color: '#FFB4A5', fontWeight: '700', marginTop: 8, textAlign: 'center' },
  retryBtn: { marginTop: 10, minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#001018', fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  centerCta: { marginTop: 10, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  centerCtaText: { color: '#001018', fontWeight: '900' },

  value: { color: '#FFF', fontWeight: '900', marginTop: 6 },
  body: { color: '#C7E0E9', marginTop: 6, fontWeight: '700' },
  helperText: { color: '#9BB9C2', fontWeight: '700', marginTop: 8, fontSize: 12 },
  kicker: { color: '#9EB8C1', fontWeight: '900', fontSize: 11, letterSpacing: 1, marginTop: 4 },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(20,20,20,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: { color: '#D7F2FA', fontWeight: '900', fontSize: 12 },

  attendeeList: { marginTop: 10, gap: 10 },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  attendeeName: { color: '#FFFFFF', fontWeight: '900' },
  attendeeMeta: { color: '#86A6B0', fontWeight: '800', fontSize: 12 },

  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  detailLabel: { color: '#86A6B0', fontWeight: '900' },
  detailValue: { color: '#FFFFFF', fontWeight: '900' },

  primaryWide: { minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primaryWideText: { color: '#001018', fontWeight: '900' },
  rowActions: { marginTop: 12 },

  timelineRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  timelineTime: { color: '#8EDFFF', fontWeight: '900', width: 64 },
  timelineLabel: { color: '#FFFFFF', fontWeight: '800', flex: 1 },

  checkRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  checkRowDone: { borderColor: 'rgba(0,217,255,0.25)', backgroundColor: 'rgba(0,217,255,0.10)' },
  checkBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', textAlign: 'center', color: '#001018', fontWeight: '900', backgroundColor: 'rgba(255,255,255,0.04)' },
  checkBoxOn: { backgroundColor: '#00D9FF', borderColor: 'rgba(0,217,255,0.55)' },
  checkText: { color: '#EAEAEA', fontWeight: '800', flex: 1 },
  checkTextDone: { color: '#D7F2FA' },

  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 14 },

  personalComposer: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 },
  personalInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#0F0F0F',
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  smallBtn: { minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  smallBtnText: { color: '#001018', fontWeight: '900' },

  chatRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  chatAuthor: { color: '#FFFFFF', fontWeight: '900' },
  chatBody: { color: '#C7E0E9', marginTop: 6, fontWeight: '700' },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },

  sheetPrimary: { minHeight: 44, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  sheetPrimaryText: { color: '#001018', fontWeight: '900' },
  sheetClose: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
  sheetCloseText: { color: '#C8C8C8', fontWeight: '900' },
  sheetLabel: { color: '#B4CBD1', fontWeight: '800', marginTop: 12, marginBottom: 6, fontSize: 12 },
  sheetInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#0F0F0F',
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontWeight: '800',
  },

  rowSplit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 },
  rowTitle: { color: '#FFFFFF', fontWeight: '900' },
  rowValue: { color: '#8FA6AE', marginTop: 4, fontWeight: '700', fontSize: 12 },

  togglePill: {
    width: 54,
    height: 30,
    borderRadius: 999,
    padding: 3,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: 'rgba(0,217,255,0.9)' },
  toggleOff: { backgroundColor: '#2A2A2A' },
  toggleThumb: { width: 24, height: 24, borderRadius: 999 },
  toggleThumbOn: { backgroundColor: '#FFFFFF', alignSelf: 'flex-end' },
  toggleThumbOff: { backgroundColor: '#888888', alignSelf: 'flex-start' },
});
