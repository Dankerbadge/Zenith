import { useFocusEffect } from '@react-navigation/native';
import * as Crypto from 'expo-crypto';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

const EVENT_TYPES = ['training', 'social', 'race', 'meeting', 'travel', 'other'] as const;
type EventType = (typeof EVENT_TYPES)[number];

type RepeatMode = 'none' | 'weekly' | 'custom';
type RepeatEndMode = 'after' | 'until' | 'forever';
type ReminderAudience = 'going_only' | 'going_maybe';

type RsvpQuestion =
  | { id: string; type: 'select'; label: string; options: string[] }
  | { id: string; type: 'text'; label: string };

type EventReminders = { audience: ReminderAudience; items: { offsetMinutes: number }[] };

function parseDateInput(raw: string): { y: number; m: number; d: number } | null {
  const v = String(raw || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mm) || !Number.isFinite(d)) return null;
  if (mm < 1 || mm > 12) return null;
  if (d < 1 || d > 31) return null;
  return { y, m: mm, d };
}

function parseTimeInput(raw: string): { hh: number; mm: number } | null {
  const v = String(raw || '').trim();
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function weekdayCode(day: number) {
  // JS: 0=Sun..6=Sat
  const map = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
  return map[Math.max(0, Math.min(6, day))];
}

function weekStartSunday(d: Date) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function endOfLocalDay(date: { y: number; m: number; d: number }) {
  const dt = new Date(date.y, date.m - 1, date.d, 23, 59, 59, 999);
  return dt;
}

function clampInt(n: number, min: number, max: number) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function generateRecurringStarts(input: {
  baseStart: Date;
  daysOfWeek: number[]; // JS 0=Sun..6=Sat
  intervalWeeks: number;
  endMode: RepeatEndMode;
  endAfterCount?: number;
  endUntil?: Date | null;
}) {
  const baseStart = input.baseStart;
  const days = Array.from(new Set((input.daysOfWeek || []).map((d) => clampInt(d, 0, 6)))).sort((a, b) => a - b);
  const interval = clampInt(input.intervalWeeks || 1, 1, 4);
  const maxCount = input.endMode === 'after' ? clampInt(input.endAfterCount || 10, 1, 120) : 120;
  const until = input.endMode === 'until' ? input.endUntil : input.endMode === 'forever' ? new Date(baseStart.getTime() + 365 * 24 * 60 * 60 * 1000) : null;

  const starts: Date[] = [];
  const baseWeekStart = weekStartSunday(baseStart);
  const hh = baseStart.getHours();
  const mm = baseStart.getMinutes();

  for (let week = 0; week < 260 && starts.length < maxCount; week += interval) {
    const wkStart = new Date(baseWeekStart);
    wkStart.setDate(baseWeekStart.getDate() + week * 7);
    for (const dow of days) {
      if (starts.length >= maxCount) break;
      const occ = new Date(wkStart);
      occ.setDate(wkStart.getDate() + dow);
      occ.setHours(hh, mm, 0, 0);
      if (occ.getTime() < baseStart.getTime()) continue;
      if (until && occ.getTime() > until.getTime()) continue;
      starts.push(occ);
    }
    if (until && wkStart.getTime() > until.getTime()) break;
  }

  starts.sort((a, b) => a.getTime() - b.getTime());
  return { starts, until };
}

export default function CreateEventScreen() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = String(params.groupId || '').trim();

  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [group, setGroup] = useState<any | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState<EventType>('training');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  const [rsvpEnabled, setRsvpEnabled] = useState(true);
  const [capacityText, setCapacityText] = useState('');
  const [waitlistEnabled, setWaitlistEnabled] = useState(false);
  const [questions, setQuestions] = useState<RsvpQuestion[]>([]);

  const [postToFeed, setPostToFeed] = useState(true);

  const [reminderAudience, setReminderAudience] = useState<ReminderAudience>('going_only');
  const [reminder24h, setReminder24h] = useState(true);
  const [reminder2h, setReminder2h] = useState(true);
  const [customReminderMin, setCustomReminderMin] = useState('');

  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');
  const [repeatIntervalWeeks, setRepeatIntervalWeeks] = useState(1);
  const [repeatDays, setRepeatDays] = useState<number[]>([new Date().getDay()]);
  const [repeatEndMode, setRepeatEndMode] = useState<RepeatEndMode>('after');
  const [repeatEndAfterCount, setRepeatEndAfterCount] = useState('10');
  const [repeatEndUntil, setRepeatEndUntil] = useState('');

  const loadGroup = useCallback(async () => {
    if (!viewerUserId || !groupId || !isSupabaseConfigured) return;
    try {
      setLoadError(null);
      const row = await socialApi.getGroup(groupId);
      setGroup(row || null);
    } catch (err: any) {
      setGroup(null);
      setLoadError(String(err?.message || 'Unable to load group.'));
    }
  }, [viewerUserId, groupId]);

  useFocusEffect(
    useCallback(() => {
      void loadGroup();
    }, [loadGroup])
  );

  const togglePill = (active: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} style={[styles.togglePill, active ? styles.toggleOn : styles.toggleOff]} disabled={busy}>
      <View style={[styles.toggleThumb, active ? styles.toggleThumbOn : styles.toggleThumbOff]} />
    </Pressable>
  );

  const submit = async () => {
    if (!viewerUserId) return;
    const t = title.trim();
    if (!t) {
      Alert.alert('Title required', 'Give the event a title.');
      return;
    }
    const d = parseDateInput(date);
    const st = parseTimeInput(startTime);
    if (!d || !st) {
      Alert.alert('Invalid start time', 'Use date YYYY-MM-DD and time HH:MM.');
      return;
    }
    const baseStart = new Date(d.y, d.m - 1, d.d, st.hh, st.mm, 0, 0);
    const startIso = baseStart.toISOString();

    let baseEnd: Date | null = null;
    if (endTime.trim()) {
      const et = parseTimeInput(endTime);
      if (!et) {
        Alert.alert('Invalid end time', 'Use time HH:MM or leave blank.');
        return;
      }
      baseEnd = new Date(d.y, d.m - 1, d.d, et.hh, et.mm, 0, 0);
      if (baseEnd.getTime() <= baseStart.getTime()) {
        Alert.alert('End time', 'End time must be after start time.');
        return;
      }
    }
    const durationMs = baseEnd ? baseEnd.getTime() - baseStart.getTime() : null;

    const capRaw = capacityText.trim();
    let capacity: number | null = null;
    if (capRaw) {
      const n = Math.floor(Number(capRaw));
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert('Capacity', 'Capacity must be a positive number.');
        return;
      }
      capacity = n;
    }

    const questionsPayload = rsvpEnabled && questions.length ? questions : null;
    const reminderOffsets: number[] = [];
    if (reminder24h) reminderOffsets.push(24 * 60);
    if (reminder2h) reminderOffsets.push(2 * 60);
    const customMin = Number(customReminderMin.trim());
    if (customReminderMin.trim() && (!Number.isFinite(customMin) || customMin <= 0)) {
      Alert.alert('Custom reminder', 'Use a positive number of minutes, or leave blank.');
      return;
    }
    if (customReminderMin.trim() && Number.isFinite(customMin) && customMin > 0) reminderOffsets.push(Math.floor(customMin));
    const remindersPayload: EventReminders | null =
      rsvpEnabled && reminderOffsets.length
        ? {
            audience: reminderAudience,
            items: Array.from(new Set(reminderOffsets)).sort((a, b) => b - a).map((offsetMinutes) => ({ offsetMinutes })),
          }
        : null;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;

    if (busy) return;
    setBusy(true);
    try {
      const isGroupEvent = Boolean(groupId);
      const repeat = repeatMode;

      if (repeat === 'none') {
        const created = isGroupEvent
          ? await socialApi.createGroupEvent(viewerUserId, groupId, {
              title: t,
              description: description.trim() || null,
              eventType,
              startAt: startIso,
              endAt: baseEnd ? baseEnd.toISOString() : null,
              timezone,
              locationName: locationName.trim() || null,
              locationAddress: locationAddress.trim() || null,
              meetingNotes: meetingNotes.trim() || null,
              rsvpEnabled,
              capacity,
              waitlistEnabled: Boolean(waitlistEnabled),
              questions: questionsPayload,
              reminders: remindersPayload,
              recurrenceRule: null,
              recurrenceUntil: null,
              seriesId: null,
            })
          : await socialApi.createPersonalEvent(viewerUserId, {
              title: t,
              description: description.trim() || null,
              eventType,
              startAt: startIso,
              endAt: baseEnd ? baseEnd.toISOString() : null,
              timezone,
              locationName: locationName.trim() || null,
              locationAddress: locationAddress.trim() || null,
              meetingNotes: meetingNotes.trim() || null,
              rsvpEnabled,
              capacity,
              waitlistEnabled: Boolean(waitlistEnabled),
              questions: questionsPayload,
              reminders: remindersPayload,
              recurrenceRule: null,
              recurrenceUntil: null,
              seriesId: null,
            });

        const id = String((created as any)?.id || '').trim();
        if (isGroupEvent && postToFeed && id) {
          try {
            await socialApi.createPost(
              viewerUserId,
              `New event: ${t}`,
              'event_announcement',
              { kind: 'event_announcement', eventId: id },
              { audience: 'group', groupId, isPublic: false }
            );
          } catch {
            // ignore
          }
        }
        if (id) router.replace(`/events/${id}` as any);
        else router.back();
        return;
      }

      const endMode = repeatEndMode;
      const intervalWeeks = clampInt(repeatIntervalWeeks || 1, 1, 4);
      const days = repeat === 'weekly' ? [baseStart.getDay()] : repeatDays;
      let untilDate: Date | null = null;
      if (endMode === 'until') {
        const untilInput = parseDateInput(repeatEndUntil);
        if (!untilInput) {
          Alert.alert('Repeat ends', 'Use an end date in YYYY-MM-DD format.');
          return;
        }
        untilDate = endOfLocalDay(untilInput);
      }
      const afterCount = clampInt(Number(repeatEndAfterCount || 10), 1, 120);

      const { starts, until } = generateRecurringStarts({
        baseStart,
        daysOfWeek: days,
        intervalWeeks,
        endMode,
        endAfterCount: afterCount,
        endUntil: untilDate,
      });

      if (!starts.length) {
        Alert.alert('Recurring schedule', 'No occurrences were generated. Check your repeat settings.');
        return;
      }

      const codes = Array.from(new Set(days.map((d) => weekdayCode(d)))).join(',');
      const recurrenceRule = `FREQ=WEEKLY;INTERVAL=${intervalWeeks};BYDAY=${codes}`;
      const recurrenceUntil = until ? until.toISOString() : null;
      const seriesId = Crypto.randomUUID();

      const bulk = starts.map((occ) => ({
        group_id: isGroupEvent ? groupId : null,
        owner_id: viewerUserId,
        title: t,
        description: description.trim() || null,
        event_type: eventType,
        start_at: occ.toISOString(),
        end_at: durationMs ? new Date(occ.getTime() + durationMs).toISOString() : null,
        timezone,
        location_name: locationName.trim() || null,
        location_address: locationAddress.trim() || null,
        meeting_notes: meetingNotes.trim() || null,
        rsvp_enabled: rsvpEnabled,
        capacity,
        waitlist_enabled: Boolean(waitlistEnabled),
        rsvp_questions: questionsPayload,
        reminders: remindersPayload,
        recurrence_rule: recurrenceRule,
        recurrence_until: recurrenceUntil,
        series_id: seriesId,
      }));

      const createdRows = await socialApi.createEventsBulk(bulk);
      const sorted = (Array.isArray(createdRows) ? createdRows : []).slice().sort((a: any, b: any) => Date.parse(String(a?.start_at || '')) - Date.parse(String(b?.start_at || '')));
      const firstId = String(sorted[0]?.id || '').trim();

      if (isGroupEvent && postToFeed && firstId) {
        try {
          await socialApi.createPost(
            viewerUserId,
            `New recurring event: ${t}`,
            'event_announcement',
            { kind: 'event_announcement', eventId: firstId, seriesId },
            { audience: 'group', groupId, isPublic: false }
          );
        } catch {
          // ignore
        }
      }

      if (firstId) router.replace(`/events/${firstId}` as any);
      else router.back();
    } catch (err: any) {
      Alert.alert('Create failed', String(err?.message || 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;
  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}><Text style={styles.empty}>Sign in to create events.</Text></View>
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

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Create Event</Text>
          <Pressable onPress={() => void submit()} style={[styles.createBtn, busy && styles.disabled]} disabled={busy}>
            <Text style={styles.createText}>{busy ? 'Creating…' : 'Create'}</Text>
          </Pressable>
        </View>

        <Text style={styles.subtitle}>
          {groupId ? (group?.name ? `Group: ${String(group.name)}` : 'Group event') : 'Personal event'}
        </Text>
        {groupId && loadError ? (
          <GlassCard>
            <Text style={styles.empty}>Group load error.</Text>
            <Text style={styles.errorText}>{loadError}</Text>
          </GlassCard>
        ) : null}

        <SectionHeader title='BASICS' />
        <GlassCard>
          <Text style={styles.label}>Title</Text>
          <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder='Sunday Long Run' placeholderTextColor='#777' />

          <Text style={styles.label}>Type</Text>
          <View style={styles.row}>
            {EVENT_TYPES.map((t) => (
              <Pressable key={t} style={[styles.chip, eventType === t && styles.chipActive]} onPress={() => setEventType(t)} disabled={busy}>
                <Text style={[styles.chipText, eventType === t && styles.chipTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Description (optional)</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            style={[styles.input, styles.notes]}
            placeholder='Notes, route, pace groups…'
            placeholderTextColor='#777'
            multiline
          />

          {groupId ? (
            <View style={[styles.rowSplit, { marginTop: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Post to group feed</Text>
                <Text style={styles.rowValue}>Creates an automatic post card</Text>
              </View>
              {togglePill(postToFeed, () => setPostToFeed((p) => !p))}
            </View>
          ) : null}
        </GlassCard>

        <SectionHeader title='WHEN' />
        <GlassCard>
          <Text style={styles.label}>Date</Text>
          <TextInput value={date} onChangeText={setDate} style={styles.input} placeholder='YYYY-MM-DD' placeholderTextColor='#777' autoCapitalize='none' />
          <Text style={styles.label}>Start time</Text>
          <TextInput value={startTime} onChangeText={setStartTime} style={styles.input} placeholder='HH:MM' placeholderTextColor='#777' autoCapitalize='none' />
          <Text style={styles.label}>End time (optional)</Text>
          <TextInput value={endTime} onChangeText={setEndTime} style={styles.input} placeholder='HH:MM' placeholderTextColor='#777' autoCapitalize='none' />

          <Text style={styles.label}>Repeats (optional)</Text>
          <View style={styles.row}>
            {(['none', 'weekly', 'custom'] as const).map((mode) => {
              const active = repeatMode === mode;
              const label = mode === 'none' ? 'None' : mode === 'weekly' ? 'Weekly' : 'Custom';
              return (
                <Pressable key={mode} style={[styles.chip, active && styles.chipActive]} onPress={() => setRepeatMode(mode)} disabled={busy}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {repeatMode !== 'none' ? (
            <>
              <Text style={styles.label}>Interval</Text>
              <View style={styles.row}>
                {([1, 2, 3, 4] as const).map((n) => {
                  const active = repeatIntervalWeeks === n;
                  return (
                    <Pressable key={String(n)} style={[styles.chip, active && styles.chipActive]} onPress={() => setRepeatIntervalWeeks(n)} disabled={busy}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{n === 1 ? 'Every week' : `Every ${n}w`}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {repeatMode === 'custom' ? (
                <>
                  <Text style={styles.label}>Days</Text>
                  <View style={styles.row}>
                    {([
                      { key: 1, label: 'Mon' },
                      { key: 2, label: 'Tue' },
                      { key: 3, label: 'Wed' },
                      { key: 4, label: 'Thu' },
                      { key: 5, label: 'Fri' },
                      { key: 6, label: 'Sat' },
                      { key: 0, label: 'Sun' },
                    ] as const).map((opt) => {
                      const active = repeatDays.includes(opt.key);
                      return (
                        <Pressable
                          key={String(opt.key)}
                          style={[styles.chip, active && styles.chipActive]}
                          onPress={() =>
                            setRepeatDays((prev) => {
                              const has = prev.includes(opt.key);
                              if (has && prev.length === 1) return prev;
                              const next = has ? prev.filter((d) => d !== opt.key) : [...prev, opt.key];
                              return next.slice().sort((a, b) => a - b);
                            })
                          }
                          disabled={busy}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <Text style={styles.label}>Repeat ends</Text>
              <View style={styles.row}>
                {([
                  { key: 'after', label: 'After' },
                  { key: 'until', label: 'Until' },
                  { key: 'forever', label: 'Forever' },
                ] as const).map((opt) => {
                  const active = repeatEndMode === opt.key;
                  return (
                    <Pressable key={opt.key} style={[styles.chip, active && styles.chipActive]} onPress={() => setRepeatEndMode(opt.key)} disabled={busy}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {repeatEndMode === 'after' ? (
                <>
                  <Text style={styles.label}>Occurrences</Text>
                  <TextInput
                    value={repeatEndAfterCount}
                    onChangeText={setRepeatEndAfterCount}
                    style={styles.input}
                    placeholder="10"
                    placeholderTextColor="#777"
                    keyboardType="number-pad"
                  />
                </>
              ) : null}

              {repeatEndMode === 'until' ? (
                <>
                  <Text style={styles.label}>End date</Text>
                  <TextInput
                    value={repeatEndUntil}
                    onChangeText={setRepeatEndUntil}
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#777"
                    autoCapitalize="none"
                  />
                </>
              ) : null}

              <Text style={styles.helperText}>Editing recurring events will prompt: this event vs series vs following.</Text>
            </>
          ) : null}
        </GlassCard>

        <SectionHeader title='WHERE' />
        <GlassCard>
          <Text style={styles.label}>Location name (optional)</Text>
          <TextInput value={locationName} onChangeText={setLocationName} style={styles.input} placeholder='River Loop Trailhead' placeholderTextColor='#777' />
          <Text style={styles.label}>Location address (optional)</Text>
          <TextInput
            value={locationAddress}
            onChangeText={setLocationAddress}
            style={styles.input}
            placeholder='123 Main St, City'
            placeholderTextColor='#777'
          />
          <Text style={styles.label}>Meeting notes (optional)</Text>
          <TextInput
            value={meetingNotes}
            onChangeText={setMeetingNotes}
            style={[styles.input, styles.notes]}
            placeholder='Meet by north parking lot…'
            placeholderTextColor='#777'
            multiline
          />
        </GlassCard>

        <SectionHeader title='RSVP' />
        <GlassCard>
          <View style={styles.rowSplit}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Enable RSVP</Text>
                <Text style={styles.rowValue}>Going / Maybe / Cannot go</Text>
              </View>
              {togglePill(rsvpEnabled, () => setRsvpEnabled((p) => !p))}
            </View>

          {rsvpEnabled ? (
            <>
              <Text style={styles.label}>Capacity (optional)</Text>
              <TextInput
                value={capacityText}
                onChangeText={setCapacityText}
                style={styles.input}
                placeholder="e.g. 30"
                placeholderTextColor="#777"
                keyboardType="number-pad"
              />

              <View style={[styles.rowSplit, { marginTop: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Waitlist</Text>
                  <Text style={styles.rowValue}>Enable if capacity is reached</Text>
                </View>
                {togglePill(Boolean(waitlistEnabled), () => setWaitlistEnabled((p) => !p))}
              </View>

              <Text style={styles.label}>Questions (optional)</Text>
              <View style={styles.row}>
                <Pressable
                  style={styles.chip}
                  onPress={() =>
                    setQuestions((prev) => {
                      if (prev.some((q) => q.id === 'pace_group')) return prev;
                      return [...prev, { id: 'pace_group', type: 'select', label: 'Pace group?', options: ['A', 'B', 'C'] }];
                    })
                  }
                  disabled={busy}
                >
                  <Text style={styles.chipText}>+ Pace group</Text>
                </Pressable>
                <Pressable
                  style={styles.chip}
                  onPress={() =>
                    setQuestions((prev) => {
                      if (prev.some((q) => q.id === 'carpool')) return prev;
                      return [...prev, { id: 'carpool', type: 'select', label: 'Carpool?', options: ['Yes', 'No'] }];
                    })
                  }
                  disabled={busy}
                >
                  <Text style={styles.chipText}>+ Carpool</Text>
                </Pressable>
                <Pressable
                  style={styles.chip}
                  onPress={() =>
                    setQuestions((prev) => {
                      if (prev.some((q) => q.id === 'notes')) return prev;
                      return [...prev, { id: 'notes', type: 'text', label: 'Notes' }];
                    })
                  }
                  disabled={busy}
                >
                  <Text style={styles.chipText}>+ Notes</Text>
                </Pressable>
              </View>

              {questions.length ? (
                <View style={{ marginTop: 10, gap: 8 }}>
                  {questions.map((q) => (
                    <View key={q.id} style={styles.questionRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.questionTitle}>{q.label}</Text>
                        <Text style={styles.questionMeta}>{q.type === 'select' ? `Options: ${q.options.join(', ')}` : 'Short text'}</Text>
                      </View>
                      <Pressable style={styles.removeBtn} onPress={() => setQuestions((prev) => prev.filter((x) => x.id !== q.id))} disabled={busy}>
                        <Text style={styles.removeText}>Remove</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.helperText}>No host questions yet.</Text>
              )}
            </>
          ) : (
            <Text style={styles.helperText}>RSVP disabled. Attendees will not be tracked.</Text>
          )}
        </GlassCard>

        <SectionHeader title='REMINDERS' />
        <GlassCard>
          {!rsvpEnabled ? (
            <Text style={styles.helperText}>Enable RSVP to configure reminders.</Text>
          ) : (
            <>
              <View style={styles.rowSplit}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>24h before</Text>
                  <Text style={styles.rowValue}>Default reminder</Text>
                </View>
                {togglePill(Boolean(reminder24h), () => setReminder24h((p) => !p))}
              </View>
              <View style={[styles.rowSplit, { marginTop: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>2h before</Text>
                  <Text style={styles.rowValue}>Default reminder</Text>
                </View>
                {togglePill(Boolean(reminder2h), () => setReminder2h((p) => !p))}
              </View>

              <Text style={styles.label}>Custom (minutes before)</Text>
              <TextInput
                value={customReminderMin}
                onChangeText={setCustomReminderMin}
                style={styles.input}
                placeholder="e.g. 30"
                placeholderTextColor="#777"
                keyboardType="number-pad"
              />

              <Text style={styles.label}>Audience</Text>
              <View style={styles.row}>
                {([
                  { key: 'going_only', label: 'Going only' },
                  { key: 'going_maybe', label: 'Going + Maybe' },
                ] as const).map((opt) => {
                  const active = reminderAudience === opt.key;
                  return (
                    <Pressable key={opt.key} style={[styles.chip, active && styles.chipActive]} onPress={() => setReminderAudience(opt.key)} disabled={busy}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 30 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { paddingVertical: 8, paddingHorizontal: 8 },
  backText: { color: '#7EDCFF', fontWeight: '900' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  createBtn: { minHeight: 36, borderRadius: 12, backgroundColor: '#00D9FF', paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  createText: { color: '#001018', fontWeight: '900', fontSize: 12 },
  disabled: { opacity: 0.55 },
  subtitle: { color: '#9DA8AD', marginTop: 10, fontWeight: '700', marginBottom: 10 },

  label: { color: '#B4CBD1', marginTop: 8, marginBottom: 6, fontWeight: '700', fontSize: 12 },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    backgroundColor: '#121212',
    color: '#F3F3F3',
    paddingHorizontal: 12,
    fontWeight: '600',
  },
  notes: { minHeight: 76, paddingTop: 10, textAlignVertical: 'top' as const },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#3B3B3B',
    borderRadius: 999,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: '#181818',
  },
  chipActive: { borderColor: '#00D9FF', backgroundColor: 'rgba(0,217,255,0.12)' },
  chipText: { color: '#C7C7C7', fontWeight: '700', fontSize: 12 },
  chipTextActive: { color: '#EAFBFF' },

  rowSplit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { color: '#FFFFFF', fontWeight: '900' },
  rowValue: { color: '#8FA6AE', marginTop: 4, fontWeight: '700', fontSize: 12 },
  helperText: { color: '#9BB9C2', fontWeight: '700', marginTop: 10, fontSize: 12 },

  questionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  questionTitle: { color: '#FFFFFF', fontWeight: '900' },
  questionMeta: { color: '#86A6B0', marginTop: 4, fontWeight: '700', fontSize: 12 },
  removeBtn: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: '#FFB4A5', fontWeight: '900', fontSize: 12 },

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

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  empty: { color: '#C7C7C7', fontWeight: '700', textAlign: 'center' },
  errorText: { color: '#FFB4A5', fontWeight: '700', marginTop: 8, textAlign: 'center' },
  centerCta: { marginTop: 10, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  centerCtaText: { color: '#001018', fontWeight: '900' },
});
