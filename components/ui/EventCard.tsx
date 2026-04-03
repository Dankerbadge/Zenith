import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Badge from './Badge';

type RsvpStatus = 'going' | 'maybe' | 'not_going';

function isTeamGroup(group: any | null): boolean {
  if (!group) return false;
  const kind = String(group?.kind || '').trim().toLowerCase();
  const joinCode = String(group?.join_code || '').trim().toLowerCase();
  if (kind === 'coaching_team') return true;
  return joinCode.startsWith('team:');
}

function sourceLabel(ev: any): { label: string; tone: 'accent' | 'muted' } {
  if (!ev?.group_id) return { label: 'Personal', tone: 'muted' };
  const group = ev?.groups || null;
  return isTeamGroup(group) ? { label: 'Team', tone: 'accent' } : { label: 'Group', tone: 'muted' };
}

function typeLabel(raw: any): string {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return 'Event';
  if (v === 'training') return 'Training';
  if (v === 'social') return 'Social';
  if (v === 'race') return 'Race';
  if (v === 'meeting') return 'Meeting';
  if (v === 'travel') return 'Travel';
  if (v === 'other') return 'Other';
  return v;
}

function dateBadge(startIso?: string | null) {
  const d = startIso ? new Date(String(startIso)) : null;
  if (!d || !Number.isFinite(d.getTime())) return { weekday: '—', day: '—' };
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
  const day = String(d.getDate());
  return { weekday, day };
}

function timeWindow(startIso?: string | null, endIso?: string | null) {
  const start = startIso ? new Date(String(startIso)) : null;
  if (!start || !Number.isFinite(start.getTime())) return '—';
  const s = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const end = endIso ? new Date(String(endIso)) : null;
  if (end && Number.isFinite(end.getTime())) {
    const e = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${s}–${e}`;
  }
  return s;
}

function rsvpLabel(status?: string | null): string {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'going') return 'Going';
  if (s === 'maybe') return 'Maybe';
  if (s === 'not_going') return "Can't";
  return 'RSVP';
}

export default function EventCard(props: {
  event: any;
  variant?: 'compact' | 'hero';
  disabled?: boolean;
  onPress: () => void;
  onRsvpPress?: () => void;
}) {
  const ev = props.event || {};
  const variant = props.variant || 'compact';
  const source = sourceLabel(ev);

  const badge = useMemo(() => dateBadge(ev?.start_at), [ev?.start_at]);
  const when = useMemo(() => timeWindow(ev?.start_at, ev?.end_at), [ev?.start_at, ev?.end_at]);
  const where = String(ev?.location_name || '').trim();
  const myStatus = (ev?.my_rsvp?.status ? String(ev.my_rsvp.status) : null) as RsvpStatus | null;

  const goingCount = Number(ev?.rsvp_counts?.going || 0);
  const maybeCount = Number(ev?.rsvp_counts?.maybe || 0);
  const countText = goingCount > 0 || maybeCount > 0 ? `${goingCount} going${maybeCount ? ` • ${maybeCount} maybe` : ''}` : '';

  const title = String(ev?.title || 'Event').trim() || 'Event';
  const meta = `${when}${where ? ` • ${where}` : ''}`;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        variant === 'hero' && styles.cardHero,
        props.disabled && styles.cardDisabled,
        pressed && !props.disabled && styles.cardPressed,
      ]}
      onPress={props.onPress}
      disabled={props.disabled}
    >
      <View style={styles.row}>
        <View style={styles.dateBadge}>
          <Text style={styles.dateWeekday}>{badge.weekday}</Text>
          <Text style={styles.dateDay}>{badge.day}</Text>
        </View>

        <View style={{ flex: 1 }}>
          <View style={styles.topLine}>
            <Text style={[styles.title, variant === 'hero' && styles.titleHero]} numberOfLines={variant === 'hero' ? 2 : 1}>
              {title}
            </Text>
          </View>
          <Text style={styles.meta} numberOfLines={2}>
            {meta}
          </Text>
          <View style={styles.badgeRow}>
            <Badge label={source.label} tone={source.tone} />
            <Badge label={typeLabel(ev?.event_type)} tone="muted" />
            {countText ? <Text style={styles.countText}>{countText}</Text> : null}
          </View>
        </View>

        {ev?.rsvp_enabled ? (
          <Pressable
            onPress={props.onRsvpPress || props.onPress}
            style={({ pressed }) => [styles.rsvpChip, pressed && styles.rsvpChipPressed]}
            hitSlop={8}
          >
            <Text style={[styles.rsvpText, myStatus ? styles.rsvpTextOn : null]}>{rsvpLabel(myStatus)}</Text>
          </Pressable>
        ) : (
          <Text style={styles.openText}>Open</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(14,14,14,0.92)',
    borderRadius: 16,
    padding: 12,
  },
  cardHero: { padding: 14 },
  cardDisabled: { opacity: 0.6 },
  cardPressed: { opacity: 0.96, transform: [{ scale: 0.995 }] },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  dateBadge: {
    width: 56,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
  },
  dateWeekday: { color: '#86A6B0', fontWeight: '900', fontSize: 11, letterSpacing: 0.8 },
  dateDay: { color: '#FFFFFF', fontWeight: '900', fontSize: 18, marginTop: 4 },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  titleHero: { fontSize: 16 },
  meta: { color: '#86A6B0', marginTop: 4, fontWeight: '700', fontSize: 12 },
  badgeRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 },
  countText: { color: '#9BB9C2', fontWeight: '800', fontSize: 11 },
  rsvpChip: {
    paddingHorizontal: 10,
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(0,0,0,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rsvpChipPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  rsvpText: { color: '#C7C7C7', fontWeight: '900', fontSize: 12 },
  rsvpTextOn: { color: '#EAFBFF' },
  openText: { color: '#8EDFFF', fontWeight: '900' },
});
