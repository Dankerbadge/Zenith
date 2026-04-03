import { useFocusEffect } from '@react-navigation/native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BottomSheet from '../../components/ui/BottomSheet';
import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { APP_CONFIG } from '../../utils/appConfig';
import { isSupabaseConfigured, socialApi } from '../../utils/supabaseClient';
import { useAuth } from '../context/authcontext';

const EVENT_TYPES = ['training', 'social', 'race', 'meeting', 'travel', 'other'] as const;
type EventType = (typeof EVENT_TYPES)[number];

type EditScope = 'this' | 'series' | 'following';
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

function buildLocalIso(date: { y: number; m: number; d: number }, time: { hh: number; mm: number }) {
  const dt = new Date(date.y, date.m - 1, date.d, time.hh, time.mm, 0, 0);
  return dt.toISOString();
}

function toDateInput(iso: string) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toTimeInput(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function safeQuestions(raw: any): RsvpQuestion[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: RsvpQuestion[] = [];
  rows.forEach((q: any) => {
    const id = String(q?.id || '').trim();
    const type = String(q?.type || '').trim();
    const label = String(q?.label || '').trim();
    if (!id || !label) return;
    if (type === 'select') {
      const options = Array.isArray(q?.options) ? q.options.map((o: any) => String(o || '').trim()).filter(Boolean) : [];
      if (!options.length) return;
      out.push({ id, type: 'select', label, options });
      return;
    }
    out.push({ id, type: 'text', label });
  });
  return out;
}

function normalizeReminderOffset(raw: any): number | null {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export default function EditEventScreen() {
  const params = useLocalSearchParams<{ eventId?: string }>();
  const eventId = String(params.eventId || '').trim();

  const socialEnabled = APP_CONFIG.FEATURES.SOCIAL_FEATURES_ENABLED || APP_CONFIG.RUNTIME.OVERRIDES.SOCIAL_FEATURES_ENABLED;
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<any | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState<EventType>('training');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  const [rsvpEnabled, setRsvpEnabled] = useState(true);
  const [capacityText, setCapacityText] = useState('');
  const [waitlistEnabled, setWaitlistEnabled] = useState(false);
  const [questions, setQuestions] = useState<RsvpQuestion[]>([]);

  const [reminderAudience, setReminderAudience] = useState<ReminderAudience>('going_only');
  const [reminder24h, setReminder24h] = useState(true);
  const [reminder2h, setReminder2h] = useState(true);
  const [customReminderMin, setCustomReminderMin] = useState('');

  const [scopeSheetOpen, setScopeSheetOpen] = useState(false);
  const [scopeSheetMode, setScopeSheetMode] = useState<'save' | 'delete'>('save');

  const isRecurring = useMemo(() => Boolean(event?.series_id), [event?.series_id]);
  const seriesId = useMemo(() => String(event?.series_id || '').trim(), [event?.series_id]);
  const originalStartIso = useMemo(() => String(event?.start_at || '').trim(), [event?.start_at]);

  const load = useCallback(async () => {
    if (!viewerUserId || !eventId || !isSupabaseConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const row = await socialApi.getEvent(eventId);
      setEvent(row || null);

      const t = String(row?.title || '').trim();
      setTitle(t);
      const type = String(row?.event_type || '').trim().toLowerCase();
      setEventType((EVENT_TYPES as readonly string[]).includes(type) ? (type as EventType) : 'training');
      setDescription(String(row?.description || ''));

      const startIso = String(row?.start_at || '').trim();
      setDate(startIso ? toDateInput(startIso) : '');
      setStartTime(startIso ? toTimeInput(startIso) : '08:00');
      const endIso = String(row?.end_at || '').trim();
      setEndTime(endIso ? toTimeInput(endIso) : '');

      setLocationName(String(row?.location_name || ''));
      setLocationAddress(String(row?.location_address || ''));
      setMeetingNotes(String(row?.meeting_notes || ''));
      setRsvpEnabled(typeof row?.rsvp_enabled === 'boolean' ? Boolean(row.rsvp_enabled) : true);
      setCapacityText(row?.capacity != null && Number.isFinite(Number(row.capacity)) ? String(Math.floor(Number(row.capacity))) : '');
      setWaitlistEnabled(Boolean(row?.waitlist_enabled));
      setQuestions(safeQuestions(row?.rsvp_questions));

      const rem = row?.reminders || null;
      const remAudience = String(rem?.audience || '').trim().toLowerCase();
      setReminderAudience(remAudience === 'going_maybe' ? 'going_maybe' : 'going_only');
      const offsets = (Array.isArray(rem?.items) ? rem.items : [])
        .map((i: any) => normalizeReminderOffset(i?.offsetMinutes))
        .filter((n: any) => typeof n === 'number' && Number.isFinite(n)) as number[];
      setReminder24h(offsets.includes(1440));
      setReminder2h(offsets.includes(120));
      const custom = offsets.find((n) => n !== 1440 && n !== 120) || null;
      setCustomReminderMin(custom != null ? String(custom) : '');

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

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const togglePill = (active: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} style={[styles.togglePill, active ? styles.toggleOn : styles.toggleOff]} disabled={busy || !canEdit}>
      <View style={[styles.toggleThumb, active ? styles.toggleThumbOn : styles.toggleThumbOff]} />
    </Pressable>
  );

  const buildPatch = useCallback(() => {
    const t = title.trim();
    if (!t) throw new Error('Title required.');
    const d = parseDateInput(date);
    const st = parseTimeInput(startTime);
    if (!d || !st) throw new Error('Invalid start time. Use date YYYY-MM-DD and time HH:MM.');

    const startIso = buildLocalIso(d, st);

    let endIso: string | null = null;
    if (endTime.trim()) {
      const et = parseTimeInput(endTime);
      if (!et) throw new Error('Invalid end time. Use time HH:MM or leave blank.');
      endIso = buildLocalIso(d, et);
      if (Date.parse(endIso) <= Date.parse(startIso)) throw new Error('End time must be after start time.');
    }

    const capRaw = capacityText.trim();
    let cap: number | null = null;
    if (capRaw) {
      const n = Math.floor(Number(capRaw));
      if (!Number.isFinite(n) || n <= 0) throw new Error('Capacity must be a positive number.');
      cap = n;
    }

    const items: { offsetMinutes: number }[] = [];
    if (rsvpEnabled) {
      if (reminder24h) items.push({ offsetMinutes: 1440 });
      if (reminder2h) items.push({ offsetMinutes: 120 });
      const custom = customReminderMin.trim();
      if (custom) {
        const n = normalizeReminderOffset(custom);
        if (n == null) throw new Error('Custom reminder must be minutes before (e.g. 30).');
        items.push({ offsetMinutes: n });
      }
    }

    const remindersPayload: EventReminders | null = rsvpEnabled && items.length ? { audience: reminderAudience, items } : null;
    const questionsPayload = rsvpEnabled && questions.length ? questions : null;

    return {
      title: t,
      description: description.trim() ? description.trim() : null,
      event_type: eventType,
      start_at: startIso,
      end_at: endIso,
      location_name: locationName.trim() ? locationName.trim() : null,
      location_address: locationAddress.trim() ? locationAddress.trim() : null,
      meeting_notes: meetingNotes.trim() ? meetingNotes.trim() : null,
      rsvp_enabled: Boolean(rsvpEnabled),
      capacity: cap,
      waitlist_enabled: Boolean(waitlistEnabled),
      rsvp_questions: questionsPayload,
      reminders: remindersPayload,
    };
  }, [
    title,
    date,
    startTime,
    endTime,
    capacityText,
    description,
    eventType,
    locationName,
    locationAddress,
    meetingNotes,
    rsvpEnabled,
    waitlistEnabled,
    questions,
    reminder24h,
    reminder2h,
    customReminderMin,
    reminderAudience,
  ]);

  const save = useCallback(
    async (scope: EditScope) => {
      if (!viewerUserId || !eventId || !canEdit) return;
      setBusy(true);
      try {
        const patch = buildPatch();
        if (!isRecurring || scope === 'this' || !seriesId) {
          await socialApi.updateEvent(eventId, patch);
          Alert.alert('Saved', 'Event updated.');
          router.replace(`/events/${encodeURIComponent(eventId)}` as any);
          return;
        }

        const scheduleChanged =
          String(patch.start_at || '') !== String(event?.start_at || '') || String(patch.end_at || '') !== String(event?.end_at || '');

        // Update this event with the full patch, then apply the rest to the series/following.
        await socialApi.updateEvent(eventId, patch);

        const seriesPatch = { ...patch } as any;
        delete seriesPatch.start_at;
        delete seriesPatch.end_at;

        if (scope === 'series') {
          await socialApi.updateEventsBySeries(seriesId, seriesPatch);
        } else {
          await socialApi.updateEventsBySeries(seriesId, seriesPatch, { fromIso: originalStartIso || String(patch.start_at || '') });
        }

        Alert.alert('Saved', scheduleChanged ? 'Updated. Note: date/time changes applied only to this event.' : 'Updated across the series.');
        router.replace(`/events/${encodeURIComponent(eventId)}` as any);
      } catch (err: any) {
        Alert.alert('Save failed', String(err?.message || 'Try again.'));
      } finally {
        setBusy(false);
      }
    },
    [viewerUserId, eventId, canEdit, buildPatch, isRecurring, seriesId, originalStartIso, event?.start_at, event?.end_at]
  );

  const deleteWithScope = useCallback(
    async (scope: EditScope) => {
      if (!viewerUserId || !eventId || !canEdit) return;
      setBusy(true);
      try {
        if (!isRecurring || scope === 'this' || !seriesId) {
          await socialApi.deleteEvent(eventId);
          Alert.alert('Deleted', 'Event removed.');
          router.replace('/events' as any);
          return;
        }

        const fromIso = String(event?.start_at || '').trim();
        if (scope === 'series') {
          await socialApi.deleteEventsBySeries(seriesId);
        } else {
          await socialApi.deleteEventsBySeries(seriesId, { fromIso });
        }
        Alert.alert('Deleted', 'Event series updated.');
        router.replace('/events' as any);
      } catch (err: any) {
        Alert.alert('Delete failed', String(err?.message || 'Try again.'));
      } finally {
        setBusy(false);
      }
    },
    [viewerUserId, eventId, canEdit, isRecurring, seriesId, event?.start_at]
  );

  const confirmDelete = useCallback(
    (scope: EditScope) => {
      const scopeLabel = scope === 'this' ? 'this event' : scope === 'series' ? 'entire series' : 'this and following';
      Alert.alert('Delete', `Delete ${scopeLabel}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void deleteWithScope(scope),
        },
      ]);
    },
    [deleteWithScope]
  );

  if (!socialEnabled) return <Redirect href='/(tabs)/profile' />;
  if (!viewerUserId) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Sign in to edit events.</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!isSupabaseConfigured) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.empty}>Cloud sync is required.</Text>
        </View>
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
          <Pressable onPress={() => router.back()} style={styles.backBtn} disabled={busy}>
            <Text style={styles.backText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Edit Event</Text>
          <Pressable
            onPress={() => {
              if (!canEdit) return;
              if (isRecurring) {
                setScopeSheetMode('save');
                setScopeSheetOpen(true);
              } else {
                void save('this');
              }
            }}
            style={[styles.createBtn, (busy || !canEdit) && styles.disabled]}
            disabled={busy || !canEdit}
          >
            <Text style={styles.createText}>{busy ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>

        {isRecurring ? <Text style={styles.subtitle}>Recurring series: edit scope required.</Text> : null}
        {!canEdit && !loading ? <Text style={styles.subtitle}>You do not have permission to edit this event.</Text> : null}

        {error ? (
          <GlassCard>
            <Text style={styles.empty}>Event load error.</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.centerCta} onPress={() => void load()} disabled={busy}>
              <Text style={styles.centerCtaText}>{busy ? 'Retrying…' : 'Retry'}</Text>
            </Pressable>
          </GlassCard>
        ) : null}

        {loading ? <Text style={styles.empty}>Loading event…</Text> : null}

        {!loading && event ? (
          <>
            <SectionHeader title="BASICS" />
            <GlassCard>
              <Text style={styles.label}>Title</Text>
              <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Sunday Long Run" placeholderTextColor="#777" editable={!busy && canEdit} />

              <Text style={styles.label}>Type</Text>
              <View style={styles.row}>
                {EVENT_TYPES.map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.chip, eventType === t && styles.chipActive, (!canEdit || busy) && { opacity: 0.7 }]}
                    onPress={() => setEventType(t)}
                    disabled={busy || !canEdit}
                  >
                    <Text style={[styles.chipText, eventType === t && styles.chipTextActive]}>{t}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Description (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                style={[styles.input, styles.notes]}
                placeholder="Notes, route, pace groups…"
                placeholderTextColor="#777"
                multiline
                editable={!busy && canEdit}
              />
            </GlassCard>

            <SectionHeader title="WHEN" />
            <GlassCard>
              <Text style={styles.label}>Date</Text>
              <TextInput value={date} onChangeText={setDate} style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor="#777" autoCapitalize="none" editable={!busy && canEdit} />
              <Text style={styles.label}>Start time</Text>
              <TextInput value={startTime} onChangeText={setStartTime} style={styles.input} placeholder="HH:MM" placeholderTextColor="#777" autoCapitalize="none" editable={!busy && canEdit} />
              <Text style={styles.label}>End time (optional)</Text>
              <TextInput value={endTime} onChangeText={setEndTime} style={styles.input} placeholder="HH:MM" placeholderTextColor="#777" autoCapitalize="none" editable={!busy && canEdit} />

              {isRecurring ? <Text style={styles.helperText}>Date/time changes apply only to this event (series scope updates other fields).</Text> : null}
            </GlassCard>

            <SectionHeader title="WHERE" />
            <GlassCard>
              <Text style={styles.label}>Location name (optional)</Text>
              <TextInput value={locationName} onChangeText={setLocationName} style={styles.input} placeholder="River Loop Trailhead" placeholderTextColor="#777" editable={!busy && canEdit} />
              <Text style={styles.label}>Location address (optional)</Text>
              <TextInput
                value={locationAddress}
                onChangeText={setLocationAddress}
                style={styles.input}
                placeholder="123 Main St, City"
                placeholderTextColor="#777"
                editable={!busy && canEdit}
              />
              <Text style={styles.label}>Meeting notes (optional)</Text>
              <TextInput
                value={meetingNotes}
                onChangeText={setMeetingNotes}
                style={[styles.input, styles.notes]}
                placeholder="Meet by north parking lot…"
                placeholderTextColor="#777"
                multiline
                editable={!busy && canEdit}
              />
            </GlassCard>

            <SectionHeader title="RSVP" />
            <GlassCard>
              <View style={styles.rowSplit}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Enable RSVP</Text>
                  <Text style={styles.rowValue}>Going / Maybe / Cannot go</Text>
                </View>
                {togglePill(Boolean(rsvpEnabled), () => setRsvpEnabled((p) => !p))}
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
                    editable={!busy && canEdit}
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
                      disabled={busy || !canEdit}
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
                      disabled={busy || !canEdit}
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
                      disabled={busy || !canEdit}
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
                          <Pressable style={styles.removeBtn} onPress={() => setQuestions((prev) => prev.filter((x) => x.id !== q.id))} disabled={busy || !canEdit}>
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

            <SectionHeader title="REMINDERS" />
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
                    editable={!busy && canEdit}
                  />

                  <Text style={styles.label}>Audience</Text>
                  <View style={styles.row}>
                    {([
                      { key: 'going_only', label: 'Going only' },
                      { key: 'going_maybe', label: 'Going + Maybe' },
                    ] as const).map((opt) => {
                      const active = reminderAudience === opt.key;
                      return (
                        <Pressable
                          key={opt.key}
                          style={[styles.chip, active && styles.chipActive, (!canEdit || busy) && { opacity: 0.7 }]}
                          onPress={() => setReminderAudience(opt.key)}
                          disabled={busy || !canEdit}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}
            </GlassCard>

            <SectionHeader title="DANGER" />
            <GlassCard>
              <Pressable
                style={[styles.dangerBtn, (busy || !canEdit) && styles.disabled]}
                onPress={() => {
                  if (!canEdit || busy) return;
                  if (isRecurring) {
                    setScopeSheetMode('delete');
                    setScopeSheetOpen(true);
                  } else {
                    confirmDelete('this');
                  }
                }}
                disabled={busy || !canEdit}
              >
                <Text style={styles.dangerText}>{busy ? 'Working…' : 'Delete event'}</Text>
              </Pressable>
              {isRecurring ? <Text style={styles.helperText}>Deleting a recurring event will prompt: this event vs series vs following.</Text> : null}
            </GlassCard>
          </>
        ) : null}
      </ScrollView>

      <BottomSheet
        visible={scopeSheetOpen}
        onClose={() => setScopeSheetOpen(false)}
        title={scopeSheetMode === 'save' ? 'Edit recurring event' : 'Delete recurring event'}
        subtitle="Choose scope"
      >
        {([
          { key: 'this', label: 'This event', sub: 'Only this occurrence' },
          { key: 'series', label: 'Entire series', sub: 'All occurrences' },
          { key: 'following', label: 'This & following', sub: 'This occurrence and future ones' },
        ] as const).map((opt) => (
          <Pressable
            key={opt.key}
            style={styles.scopeRow}
            onPress={() => {
              setScopeSheetOpen(false);
              if (scopeSheetMode === 'save') {
                void save(opt.key);
              } else {
                confirmDelete(opt.key);
              }
            }}
            disabled={busy || !canEdit}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.scopeTitle}>{opt.label}</Text>
              <Text style={styles.scopeSub}>{opt.sub}</Text>
            </View>
            <Text style={styles.scopeArrow}>›</Text>
          </Pressable>
        ))}
        {scopeSheetMode === 'save' ? (
          <Text style={[styles.helperText, { marginTop: 10 }]}>Series edits update title/type/location/RSVP fields across occurrences. Date/time changes apply only to this event.</Text>
        ) : null}
      </BottomSheet>
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

  dangerBtn: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,90,90,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,90,90,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  dangerText: { color: '#FFB4A5', fontWeight: '900' },

  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  scopeTitle: { color: '#FFFFFF', fontWeight: '900' },
  scopeSub: { color: '#8FA6AE', marginTop: 4, fontWeight: '700', fontSize: 12 },
  scopeArrow: { color: '#7EDCFF', fontWeight: '900', fontSize: 22, paddingHorizontal: 8 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  empty: { color: '#C7C7C7', fontWeight: '700', textAlign: 'center' },
  errorText: { color: '#FFB4A5', fontWeight: '700', marginTop: 8, textAlign: 'center' },
  centerCta: { marginTop: 10, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  centerCtaText: { color: '#001018', fontWeight: '900' },
});

