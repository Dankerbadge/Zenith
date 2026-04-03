import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import GlassCard from '../../components/ui/GlassCard';
import SectionHeader from '../../components/ui/SectionHeader';
import { useAuth } from '../context/authcontext';
import { clearChallengeDraft, loadChallengeDraft, saveChallengeDraft, type DraftChallenge } from '../../utils/challengeDraftStorage';
import { socialApi } from '../../utils/supabaseClient';
import { createWorkoutChallenge, type ActivityType, type ChallengeMode, type ScoreType } from '../../utils/workoutChallengesApi';

const STEPS = ['Activity', 'Type', 'Targets', 'Rules', 'Date Window', 'Participants', 'Review'] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const ACTIVITY_TYPES: ActivityType[] = [
  'RUN_OUTDOOR',
  'RUN_TREADMILL',
  'WALK_OUTDOOR',
  'WALK_INDOOR',
  'CYCLE_OUTDOOR',
  'CYCLE_INDOOR',
  'HIKE',
  'SWIM_POOL',
  'SWIM_OPEN_WATER',
  'ROW_INDOOR',
  'ROW_OUTDOOR',
  'ELLIPTICAL',
  'STRENGTH',
  'HIIT',
];

const TEMPLATES: Array<{ id: string; label: string; mode: ChallengeMode; scoreType: ScoreType }> = [
  { id: 'fast', label: 'Fastest Time for Distance', mode: 'SINGLE_SESSION', scoreType: 'FASTEST_TIME_FOR_DISTANCE' },
  { id: 'distcum', label: 'Distance Goal (Cumulative)', mode: 'CUMULATIVE', scoreType: 'MOST_DISTANCE_CUMULATIVE' },
  { id: 'timecum', label: 'Time Goal (Cumulative)', mode: 'CUMULATIVE', scoreType: 'MOST_TIME_CUMULATIVE' },
  { id: 'pace', label: 'Pace Challenge', mode: 'SINGLE_SESSION', scoreType: 'BEST_AVG_PACE_FOR_DISTANCE' },
  { id: 'split', label: 'Splits / Intervals', mode: 'SINGLE_SESSION', scoreType: 'SPLITS_COMPLIANCE' },
  { id: 'complete', label: 'Completion Only', mode: 'SINGLE_SESSION', scoreType: 'COMPLETION_ONLY' },
];

function toIsoDaysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function defaultDraft(): DraftChallenge {
  return {
    title: '5K Push',
    description: '',
    activityType: 'RUN_OUTDOOR',
    mode: 'SINGLE_SESSION',
    scoreType: 'FASTEST_TIME_FOR_DISTANCE',
    target: {
      distanceM: 5000,
      timeS: null,
      paceSPerKm: null,
      splits: null,
    },
    constraints: {
      locationRequirement: 'OUTDOOR_ONLY',
      requiresRoute: true,
      requiresNonUserEntered: true,
      allowedSources: ['WATCH'],
      distanceTolerancePct: 0.02,
      allowLongerWorkoutForDistanceGoal: false,
      minDurationS: null,
      minDistanceM: null,
    },
    attemptPolicy: {
      attemptsAllowed: 'BEST_ONLY',
      bestBy: 'TIME_ASC',
    },
    window: {
      startTs: new Date().toISOString(),
      endTs: toIsoDaysFromNow(7),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    },
    participants: {
      userIds: [],
      teamIds: [],
      teamFanout: true,
    },
  };
}

function validateStep(step: StepIndex, draft: DraftChallenge) {
  if (step === 0) return Boolean(draft.activityType);
  if (step === 1) return Boolean(draft.mode && draft.scoreType);
  if (step === 2) {
    if (draft.scoreType === 'FASTEST_TIME_FOR_DISTANCE' || draft.scoreType === 'BEST_AVG_PACE_FOR_DISTANCE' || draft.scoreType === 'SPLITS_COMPLIANCE') {
      return Number(draft.target.distanceM || 0) > 0;
    }
    if (draft.scoreType === 'MOST_TIME_CUMULATIVE') return Number(draft.target.timeS || 0) > 0;
    return true;
  }
  if (step === 3) {
    return Array.isArray(draft.constraints.allowedSources) && draft.constraints.allowedSources.length > 0;
  }
  if (step === 4) {
    const start = Date.parse(draft.window.startTs);
    const end = Date.parse(draft.window.endTs);
    return Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= 90 * 24 * 60 * 60 * 1000;
  }
  if (step === 5) {
    return draft.participants.userIds.length > 0 || draft.participants.teamIds.length > 0;
  }
  return true;
}

export default function CreateChallengeWizard() {
  const { supabaseUserId } = useAuth();
  const viewerUserId = supabaseUserId || '';
  const [step, setStep] = useState<StepIndex>(0);
  const [draft, setDraft] = useState<DraftChallenge>(defaultDraft());
  const [friends, setFriends] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [teamMembersById, setTeamMembersById] = useState<Record<string, any[]>>({});
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [participantTab, setParticipantTab] = useState<'friends' | 'teams'>('friends');
  const [saving, setSaving] = useState(false);

  const patchDraft = useCallback((patch: Partial<DraftChallenge>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!viewerUserId) return;
      (async () => {
        const restored = await loadChallengeDraft(viewerUserId);
        if (restored) setDraft(restored);
        try {
          const friendIds = await socialApi.getAcceptedFriendIds(viewerUserId);
          const [friendProfiles, myTeams] = await Promise.all([
            socialApi.getProfilesByIds(friendIds),
            socialApi.getMyTeams(viewerUserId),
          ]);
          setFriends(Array.isArray(friendProfiles) ? friendProfiles : []);
          const teamRows = Array.isArray(myTeams) ? myTeams : [];
          setTeams(teamRows);
          const nextMembers: Record<string, any[]> = {};
          await Promise.all(
            teamRows.map(async (row: any) => {
              const teamId = String(row?.team_id || row?.teams?.id || '');
              if (!teamId) return;
              try {
                const members = await socialApi.getTeamMembers(teamId);
                nextMembers[teamId] = Array.isArray(members) ? members : [];
              } catch {
                nextMembers[teamId] = [];
              }
            })
          );
          setTeamMembersById(nextMembers);
        } catch {
          setFriends([]);
          setTeams([]);
          setTeamMembersById({});
        }
      })();
    }, [viewerUserId])
  );

  const onNext = async () => {
    if (!validateStep(step, draft)) return;
    await saveChallengeDraft(viewerUserId, draft);
    setStep((prev) => (prev < 6 ? ((prev + 1) as StepIndex) : prev));
  };

  const onBack = async () => {
    await saveChallengeDraft(viewerUserId, draft);
    if (step === 0) {
      router.back();
      return;
    }
    setStep((prev) => ((prev - 1) as StepIndex));
  };

  const participantUserIds = useMemo(() => {
    const ids = new Set<string>(draft.participants.userIds || []);
    if (draft.participants.teamFanout) {
      (draft.participants.teamIds || []).forEach((teamId) => {
        const members = teamMembersById[String(teamId)] || [];
        members.forEach((m: any) => {
          const uid = String(m?.user_id || '');
          if (uid && uid !== viewerUserId) ids.add(uid);
        });
      });
    }
    return Array.from(ids).filter((id) => id && id !== viewerUserId);
  }, [draft.participants.teamFanout, draft.participants.teamIds, draft.participants.userIds, teamMembersById, viewerUserId]);

  const canNext = validateStep(step, draft);
  const reviewSummary = useMemo(() => {
    const rules: string[] = [];
    rules.push(draft.activityType.replace(/_/g, ' '));
    if (Number(draft.target.distanceM || 0) > 0) rules.push(`${(Number(draft.target.distanceM) / 1000).toFixed(2)} km`);
    if (Number(draft.target.timeS || 0) > 0) rules.push(`${Math.round(Number(draft.target.timeS))} sec`);
    if (Number(draft.target.paceSPerKm || 0) > 0) rules.push(`${Math.round(Number(draft.target.paceSPerKm))} s/km`);
    rules.push(draft.constraints.locationRequirement.replace(/_/g, ' '));
    rules.push(draft.constraints.requiresRoute ? 'GPS route required' : 'Route optional');
    rules.push(draft.constraints.requiresNonUserEntered ? 'Non-user-entered only' : 'Manual entries allowed');
    const sourceText = draft.constraints.allowedSources.length ? draft.constraints.allowedSources.join(', ') : 'WATCH';
    rules.push(`Sources: ${sourceText}`);
    rules.push(`Attempts: ${draft.attemptPolicy.attemptsAllowed}`);
    return rules.join(' · ');
  }, [draft]);

  const onCreate = async () => {
    if (!viewerUserId) return;
    if (!validateStep(6, draft)) return;
    setSaving(true);
    try {
      const created = await createWorkoutChallenge({
        creatorUserId: viewerUserId,
        title: draft.title.trim(),
        description: draft.description?.trim() || undefined,
        activityType: draft.activityType as ActivityType,
        mode: draft.mode,
        scoreType: draft.scoreType as ScoreType,
        rules: {
          target: draft.target,
          constraints: {
            ...draft.constraints,
            timezonePolicy: 'CREATOR_TIMEZONE',
          } as any,
          attemptPolicy: draft.attemptPolicy,
        } as any,
        startTs: draft.window.startTs,
        endTs: draft.window.endTs,
        visibility: draft.participants.teamIds.length > 0 ? 'TEAM' : 'PRIVATE',
        teamId: draft.participants.teamIds.length > 0 ? String(draft.participants.teamIds[0]) : null,
        teamFanout: draft.participants.teamFanout,
        participantUserIds,
      });
      await clearChallengeDraft(viewerUserId);
      router.replace(`/challenges/social/${created.id}` as any);
    } catch (err: any) {
      Alert.alert('Create failed', String(err?.message || 'Unable to create challenge.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable onPress={() => void onBack()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.title}>{STEPS[step]}</Text>
            <Text style={styles.stepText}>Step {step + 1} of 7</Text>
          </View>
          <View style={{ width: 56 }} />
        </View>

        {step === 0 ? (
          <>
            <SectionHeader title='Pick Activity' />
            <GlassCard>
              <View style={styles.chipWrap}>
                {ACTIVITY_TYPES.map((a) => (
                  <Pressable key={a} style={[styles.chip, draft.activityType === a && styles.chipOn]} onPress={() => patchDraft({ activityType: a })}>
                    <Text style={[styles.chipText, draft.activityType === a && styles.chipTextOn]}>{a.replace(/_/g, ' ')}</Text>
                  </Pressable>
                ))}
              </View>
            </GlassCard>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <SectionHeader title='Pick Challenge Type' />
            <GlassCard>
              {TEMPLATES.map((tpl) => {
                const active = draft.mode === tpl.mode && draft.scoreType === tpl.scoreType;
                return (
                  <Pressable
                    key={tpl.id}
                    style={[styles.templateRow, active && styles.templateRowOn]}
                    onPress={() =>
                      patchDraft({
                        mode: tpl.mode,
                        scoreType: tpl.scoreType,
                        attemptPolicy: {
                          ...draft.attemptPolicy,
                          bestBy:
                            tpl.scoreType === 'FASTEST_TIME_FOR_DISTANCE' || tpl.scoreType === 'BEST_AVG_PACE_FOR_DISTANCE'
                              ? 'TIME_ASC'
                              : tpl.scoreType === 'LONGEST_DISTANCE' || tpl.scoreType === 'MOST_DISTANCE_CUMULATIVE' || tpl.scoreType === 'MOST_TIME_CUMULATIVE'
                              ? 'DIST_DESC'
                              : 'PACE_ASC',
                        },
                      })
                    }
                  >
                    <Text style={[styles.templateText, active && styles.templateTextOn]}>{tpl.label}</Text>
                  </Pressable>
                );
              })}
            </GlassCard>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <SectionHeader title='Set Targets' />
            <GlassCard>
              <TextInput value={draft.title} onChangeText={(title) => patchDraft({ title })} placeholder='Title' placeholderTextColor='#7E8E93' style={styles.input} />
              <TextInput
                value={String(draft.description || '')}
                onChangeText={(description) => patchDraft({ description })}
                placeholder='Description'
                placeholderTextColor='#7E8E93'
                style={styles.input}
              />
              <TextInput
                value={draft.target.distanceM ? String((Number(draft.target.distanceM) / 1000).toFixed(2)) : ''}
                onChangeText={(v) => patchDraft({ target: { ...draft.target, distanceM: Number(v || 0) > 0 ? Number(v) * 1000 : null } })}
                placeholder='Distance target (km)'
                placeholderTextColor='#7E8E93'
                style={styles.input}
                keyboardType="decimal-pad"
              />
              <TextInput
                value={draft.target.timeS ? String(Math.round(Number(draft.target.timeS))) : ''}
                onChangeText={(v) => patchDraft({ target: { ...draft.target, timeS: Number(v || 0) > 0 ? Number(v) : null } })}
                placeholder='Time target (sec)'
                placeholderTextColor='#7E8E93'
                style={styles.input}
                keyboardType="number-pad"
              />
              <TextInput
                value={draft.target.paceSPerKm ? String(Math.round(Number(draft.target.paceSPerKm))) : ''}
                onChangeText={(v) => patchDraft({ target: { ...draft.target, paceSPerKm: Number(v || 0) > 0 ? Number(v) : null } })}
                placeholder='Pace target (sec/km)'
                placeholderTextColor='#7E8E93'
                style={styles.input}
                keyboardType="number-pad"
              />
            </GlassCard>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <SectionHeader title='Rules / Verification' />
            <GlassCard>
              <Text style={styles.kicker}>Location</Text>
              <View style={styles.chipWrap}>
                {(['OUTDOOR_ONLY', 'INDOOR_ONLY', 'EITHER'] as const).map((loc) => (
                  <Pressable
                    key={loc}
                    style={[styles.chip, draft.constraints.locationRequirement === loc && styles.chipOn]}
                    onPress={() => patchDraft({ constraints: { ...draft.constraints, locationRequirement: loc } })}
                  >
                    <Text style={[styles.chipText, draft.constraints.locationRequirement === loc && styles.chipTextOn]}>{loc.replace(/_/g, ' ')}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.kicker}>Allowed Sources</Text>
              <View style={styles.chipWrap}>
                {(['WATCH', 'PHONE', 'IMPORT'] as const).map((src) => {
                  const on = draft.constraints.allowedSources.includes(src);
                  return (
                    <Pressable
                      key={src}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => {
                        const next = on ? draft.constraints.allowedSources.filter((x) => x !== src) : [...draft.constraints.allowedSources, src];
                        patchDraft({ constraints: { ...draft.constraints, allowedSources: next } });
                      }}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{src}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.inlineRow}>
                <TextInput
                  value={String(draft.constraints.distanceTolerancePct)}
                  onChangeText={(v) =>
                    patchDraft({ constraints: { ...draft.constraints, distanceTolerancePct: Number.isFinite(Number(v)) ? Number(v) : draft.constraints.distanceTolerancePct } })
                  }
                  placeholder='Distance tolerance pct'
                  placeholderTextColor='#7E8E93'
                  style={[styles.input, styles.inlineInput]}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  value={draft.constraints.minDistanceM ? String(Number(draft.constraints.minDistanceM)) : ''}
                  onChangeText={(v) => patchDraft({ constraints: { ...draft.constraints, minDistanceM: Number(v || 0) > 0 ? Number(v) : null } })}
                  placeholder='Min distance (m)'
                  placeholderTextColor='#7E8E93'
                  style={[styles.input, styles.inlineInput]}
                  keyboardType="decimal-pad"
                />
              </View>

              <View style={styles.toggleRow}>
                <Pressable
                  style={[styles.toggleChip, draft.constraints.requiresRoute && styles.chipOn]}
                  onPress={() => patchDraft({ constraints: { ...draft.constraints, requiresRoute: !draft.constraints.requiresRoute } })}
                >
                  <Text style={[styles.chipText, draft.constraints.requiresRoute && styles.chipTextOn]}>Requires route</Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleChip, draft.constraints.allowLongerWorkoutForDistanceGoal && styles.chipOn]}
                  onPress={() =>
                    patchDraft({
                      constraints: {
                        ...draft.constraints,
                        allowLongerWorkoutForDistanceGoal: !draft.constraints.allowLongerWorkoutForDistanceGoal,
                      },
                    })
                  }
                >
                  <Text style={[styles.chipText, draft.constraints.allowLongerWorkoutForDistanceGoal && styles.chipTextOn]}>Allow longer workout</Text>
                </Pressable>
              </View>

              <Text style={styles.kicker}>Attempt Policy</Text>
              <View style={styles.chipWrap}>
                {(['UNLIMITED', 'FIRST_ONLY', 'BEST_ONLY'] as const).map((policy) => {
                  const on = draft.attemptPolicy.attemptsAllowed === policy;
                  return (
                    <Pressable
                      key={policy}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => patchDraft({ attemptPolicy: { ...draft.attemptPolicy, attemptsAllowed: policy } })}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{policy.replace(/_/g, ' ')}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </GlassCard>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <SectionHeader title='Date Window' />
            <GlassCard>
              <TextInput value={draft.window.startTs} onChangeText={(startTs) => patchDraft({ window: { ...draft.window, startTs } })} placeholder='Start ISO' placeholderTextColor='#7E8E93' style={styles.input} />
              <TextInput value={draft.window.endTs} onChangeText={(endTs) => patchDraft({ window: { ...draft.window, endTs } })} placeholder='End ISO' placeholderTextColor='#7E8E93' style={styles.input} />
              <Text style={styles.sub}>Timezone: {draft.window.timezone}</Text>
            </GlassCard>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <SectionHeader title='Participants' />
            <GlassCard>
              <View style={styles.participantTabs}>
                <Pressable style={[styles.participantTab, participantTab === 'friends' && styles.participantTabOn]} onPress={() => setParticipantTab('friends')}>
                  <Text style={[styles.participantTabText, participantTab === 'friends' && styles.participantTabTextOn]}>Friends</Text>
                </Pressable>
                <Pressable style={[styles.participantTab, participantTab === 'teams' && styles.participantTabOn]} onPress={() => setParticipantTab('teams')}>
                  <Text style={[styles.participantTabText, participantTab === 'teams' && styles.participantTabTextOn]}>Teams</Text>
                </Pressable>
              </View>

              {participantTab === 'friends' ? (
                <>
                  <Text style={styles.kicker}>Friends</Text>
                  <View style={styles.chipWrap}>
                    {friends.map((f: any) => {
                      const id = String(f?.id || '');
                      const active = draft.participants.userIds.includes(id);
                      return (
                        <Pressable
                          key={id}
                          style={[styles.chip, active && styles.chipOn]}
                          onPress={() =>
                            patchDraft({
                              participants: {
                                ...draft.participants,
                                userIds: active ? draft.participants.userIds.filter((x) => x !== id) : [...draft.participants.userIds, id],
                              },
                            })
                          }
                        >
                          <Text style={[styles.chipText, active && styles.chipTextOn]}>{String(f?.display_name || f?.username || 'Athlete')}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.kicker}>Teams</Text>
                  <View style={styles.chipWrap}>
                    {teams.map((row: any) => {
                      const id = String(row?.team_id || row?.teams?.id || '');
                      const active = draft.participants.teamIds.includes(id);
                      return (
                        <Pressable
                          key={id}
                          style={[styles.chip, active && styles.chipOn]}
                          onPress={() =>
                            patchDraft({
                              participants: {
                                ...draft.participants,
                                teamIds: active ? draft.participants.teamIds.filter((x) => x !== id) : [...draft.participants.teamIds, id],
                              },
                            })
                          }
                        >
                          <Text style={[styles.chipText, active && styles.chipTextOn]}>{String(row?.teams?.name || 'Team')}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              <View style={styles.toggleRow}>
                <Pressable
                  style={[styles.toggleChip, draft.participants.teamFanout && styles.chipOn]}
                  onPress={() =>
                    patchDraft({
                      participants: {
                        ...draft.participants,
                        teamFanout: !draft.participants.teamFanout,
                      },
                    })
                  }
                >
                  <Text style={[styles.chipText, draft.participants.teamFanout && styles.chipTextOn]}>Team fan-out</Text>
                </Pressable>
                <Pressable style={styles.toggleChip} onPress={() => setMembersModalOpen(true)}>
                  <Text style={styles.chipText}>View team members</Text>
                </Pressable>
              </View>

              {draft.participants.teamFanout && draft.participants.teamIds.length > 0 ? (
                <Text style={styles.sub}>All team members will be invited ({participantUserIds.length}).</Text>
              ) : null}
            </GlassCard>
          </>
        ) : null}

        {step === 6 ? (
          <>
            <SectionHeader title='Review & Send' />
            <GlassCard>
              <Text style={styles.reviewText}>{reviewSummary}</Text>
              <Text style={styles.reviewText}>
                {draft.constraints.locationRequirement.replace(/_/g, ' ')} · {draft.mode} · {draft.scoreType.replace(/_/g, ' ')}
              </Text>
              <Text style={styles.reviewText}>
                {new Date(draft.window.startTs).toLocaleString()} - {new Date(draft.window.endTs).toLocaleString()} ({draft.window.timezone})
              </Text>
              <Text style={styles.reviewText}>Participants: {participantUserIds.length} + creator</Text>
              <Pressable style={[styles.createWide, saving && styles.disabled]} onPress={() => void onCreate()} disabled={saving}>
                <Text style={styles.createWideText}>{saving ? 'Creating…' : 'Create Challenge'}</Text>
              </Pressable>
            </GlassCard>
          </>
        ) : null}

        <View style={styles.navRow}>
          <Pressable style={[styles.navBtn, step === 0 && styles.disabled]} onPress={() => void onBack()}>
            <Text style={styles.navText}>Back</Text>
          </Pressable>
          {step < 6 ? (
            <Pressable style={[styles.navBtnPrimary, !canNext && styles.disabled]} disabled={!canNext} onPress={() => void onNext()}>
              <Text style={styles.navTextPrimary}>Next</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={membersModalOpen} transparent animationType="fade" onRequestClose={() => setMembersModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Team members</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {draft.participants.teamIds.map((teamId) => {
                const team = teams.find((t: any) => String(t?.team_id || t?.teams?.id || '') === String(teamId));
                const members = teamMembersById[String(teamId)] || [];
                return (
                  <View key={String(teamId)} style={{ marginBottom: 12 }}>
                    <Text style={styles.modalTeamTitle}>{String(team?.teams?.name || 'Team')}</Text>
                    {members.map((m: any) => (
                      <Text key={String(m?.id || m?.user_id)} style={styles.modalMemberText}>
                        {String(m?.profiles?.display_name || m?.profiles?.username || m?.user_id || 'Member')}
                      </Text>
                    ))}
                  </View>
                );
              })}
            </ScrollView>
            <Pressable style={styles.modalCloseBtn} onPress={() => setMembersModalOpen(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090909' },
  content: { padding: 16, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerCenter: { alignItems: 'center' },
  title: { color: '#FFF', fontWeight: '900', fontSize: 20 },
  stepText: { color: '#8FA6AE', fontWeight: '700', fontSize: 12, marginTop: 2 },
  backBtn: { minHeight: 40, minWidth: 56, justifyContent: 'center' },
  backText: { color: '#8FDBFF', fontWeight: '800' },
  chipWrap: { marginTop: 8, flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  chipOn: { borderColor: 'rgba(0,217,255,0.34)', backgroundColor: 'rgba(0,217,255,0.14)' },
  chipText: { color: '#D5D5D5', fontWeight: '800', fontSize: 12 },
  chipTextOn: { color: '#BFF3FF' },
  templateRow: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  templateRowOn: { borderColor: 'rgba(0,217,255,0.34)', backgroundColor: 'rgba(0,217,255,0.14)' },
  templateText: { color: '#D5D5D5', fontWeight: '800' },
  templateTextOn: { color: '#BFF3FF' },
  input: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    color: '#EAF8FD',
    paddingHorizontal: 12,
    marginTop: 8,
    fontWeight: '700',
  },
  inlineRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  inlineInput: { flex: 1 },
  kicker: { marginTop: 12, color: '#8FA6AE', fontWeight: '800', fontSize: 12 },
  sub: { marginTop: 10, color: '#9DA8AD', fontWeight: '700' },
  toggleRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  participantTabs: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  participantTab: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
  },
  participantTabOn: {
    borderColor: 'rgba(0,217,255,0.34)',
    backgroundColor: 'rgba(0,217,255,0.14)',
  },
  participantTabText: {
    color: '#D5D5D5',
    fontWeight: '800',
  },
  participantTabTextOn: {
    color: '#BFF3FF',
  },
  toggleChip: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
  },
  reviewText: { color: '#C5D6DB', fontWeight: '700', marginTop: 6 },
  createWide: {
    marginTop: 12,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00D9FF',
  },
  createWideText: { color: '#01212A', fontWeight: '900' },
  navRow: { marginTop: 16, flexDirection: 'row', gap: 10 },
  navBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnPrimary: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: { color: '#D5D5D5', fontWeight: '900' },
  navTextPrimary: { color: '#01212A', fontWeight: '900' },
  disabled: { opacity: 0.55 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#0F0F0F', borderRadius: 16, borderWidth: 1, borderColor: '#242424', padding: 14 },
  modalTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 18, marginBottom: 10 },
  modalTeamTitle: { color: '#BFF3FF', fontWeight: '900', marginBottom: 4 },
  modalMemberText: { color: '#C5D6DB', fontWeight: '700', marginBottom: 2, fontSize: 12 },
  modalCloseBtn: { marginTop: 10, minHeight: 42, borderRadius: 12, backgroundColor: '#00D9FF', alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: '#01212A', fontWeight: '900' },
});
