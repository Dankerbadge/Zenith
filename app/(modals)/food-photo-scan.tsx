import * as Haptics from 'expo-haptics';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import NumberPadTextInput from '../../components/inputs/NumberPadTextInput';
import GlassCard from '../../components/ui/GlassCard';
import type { CanonicalFoodItem } from '../../utils/foodSearchService';
import { addFoodToDailyLog } from '../../utils/foodSearchService';
import { photoScanFood, type PhotoScanCandidate, type PhotoScanResponse } from '../../utils/foodPhotoScanService';

type Step = 'camera' | 'analyzing' | 'packaged' | 'results' | 'portion';

type DraftEntry = {
  candidate: PhotoScanCandidate;
  grams: number;
};

function clampInt(n: number, min: number, max: number) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function formatInt(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString();
}

function candidateBadge(c: PhotoScanCandidate) {
  switch (c.source) {
    case 'USDA_FDC_BRANDED':
      return 'USDA Branded';
    case 'OPEN_FOOD_FACTS':
      return 'Open Food Facts';
    case 'USDA_FDC':
    default:
      return 'USDA';
  }
}

function candidateAccent(c: PhotoScanCandidate) {
  if (c.confidence?.tier === 'HIGH') return { border: 'rgba(0,255,136,0.22)', bg: 'rgba(0,255,136,0.08)', fg: '#A8FFD7' };
  if (c.confidence?.tier === 'MEDIUM') return { border: 'rgba(0,217,255,0.22)', bg: 'rgba(0,217,255,0.08)', fg: '#BFEFFF' };
  return { border: 'rgba(255,176,0,0.22)', bg: 'rgba(255,176,0,0.08)', fg: '#FFD18A' };
}

function caloriesFromMacros(proteinG: number, carbsG: number, fatG: number) {
  const v = 4 * (Number(proteinG) || 0) + 4 * (Number(carbsG) || 0) + 9 * (Number(fatG) || 0);
  return Number.isFinite(v) ? v : 0;
}

function mealForDate(ts?: string) {
  const d = ts ? new Date(ts) : new Date();
  const h = d.getHours();
  if (h < 11) return 'breakfast' as const;
  if (h < 16) return 'lunch' as const;
  if (h < 21) return 'dinner' as const;
  return 'snack' as const;
}

function candidateToCanonicalFoodItem(candidate: PhotoScanCandidate): CanonicalFoodItem {
  // This app’s nutrition engine expects per-100g values with servingSizes that map to grams.
  // For PER_SERVING candidates, the backend should still include servingSize in grams; we convert to per-100g here.
  const baseKind = candidate.base?.kind;
  const servingG =
    baseKind === 'PER_SERVING' && String(candidate.base?.servingUnit || '').toLowerCase() === 'g'
      ? Number(candidate.base?.servingSize) || 0
      : 0;

  const perServing = candidate.nutrients || ({} as any);
  const per100g =
    baseKind === 'PER_SERVING' && servingG > 0
      ? {
          caloriesKcal: (Number(perServing.caloriesKcal) || 0) * (100 / servingG),
          proteinG: (Number(perServing.proteinG) || 0) * (100 / servingG),
          carbsG: (Number(perServing.carbsG) || 0) * (100 / servingG),
          fatG: (Number(perServing.fatG) || 0) * (100 / servingG),
          fiberG: typeof perServing.fiberG === 'number' ? perServing.fiberG * (100 / servingG) : undefined,
          sugarG: typeof perServing.sugarG === 'number' ? perServing.sugarG * (100 / servingG) : undefined,
          sodiumMg: typeof perServing.sodiumMg === 'number' ? perServing.sodiumMg * (100 / servingG) : undefined,
        }
      : {
          caloriesKcal: Number(perServing.caloriesKcal) || 0,
          proteinG: Number(perServing.proteinG) || 0,
          carbsG: Number(perServing.carbsG) || 0,
          fatG: Number(perServing.fatG) || 0,
          fiberG: typeof perServing.fiberG === 'number' ? perServing.fiberG : undefined,
          sugarG: typeof perServing.sugarG === 'number' ? perServing.sugarG : undefined,
          sodiumMg: typeof perServing.sodiumMg === 'number' ? perServing.sodiumMg : undefined,
        };

  const servingSizes: any[] = [];
  if (servingG > 0) {
    servingSizes.push({ label: '1 serving', grams: servingG, default: true });
  }
  servingSizes.push({ label: '100g', grams: 100, default: servingSizes.length === 0 });

  const source = candidate.source === 'OPEN_FOOD_FACTS' ? 'off' : 'usda';
  const sourceId =
    candidate.source === 'OPEN_FOOD_FACTS'
      ? String(candidate.offBarcode || candidate.candidateId)
      : String(candidate.fdcId || candidate.candidateId);

  return {
    id: `photo:${candidate.candidateId}`,
    source,
    sourceId,
    name: String(candidate.displayName || '').trim() || 'Food',
    brand: typeof candidate.brandOwner === 'string' && candidate.brandOwner.trim() ? candidate.brandOwner.trim() : undefined,
    barcode: candidate.offBarcode ? String(candidate.offBarcode) : undefined,
    kind: 'food',
    nutritionBasis: 'per100g',
    servingSizes,
    nutrientsPer100g: {
      caloriesKcal: Math.max(0, Number(per100g.caloriesKcal) || 0),
      proteinG: Math.max(0, Number(per100g.proteinG) || 0),
      carbsG: Math.max(0, Number(per100g.carbsG) || 0),
      fatG: Math.max(0, Number(per100g.fatG) || 0),
      fiberG: typeof per100g.fiberG === 'number' ? Math.max(0, per100g.fiberG) : undefined,
      sugarG: typeof per100g.sugarG === 'number' ? Math.max(0, per100g.sugarG) : undefined,
      sodiumMg: typeof per100g.sodiumMg === 'number' ? Math.max(0, per100g.sodiumMg) : undefined,
    },
    qualityTier: candidate.source === 'USDA_FDC_BRANDED' ? 'HIGH' : 'MEDIUM',
    completeness: { hasCalories: true, hasMacros: true, hasServing: servingSizes.length > 0 },
  };
}

export default function FoodPhotoScanModal() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);

  const [step, setStep] = useState<Step>('camera');
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<PhotoScanResponse | null>(null);
  const [selected, setSelected] = useState<PhotoScanCandidate | null>(null);
  const [gramsText, setGramsText] = useState('200');
  const [draft, setDraft] = useState<DraftEntry[]>([]);
  const [logging, setLogging] = useState(false);

  const grams = useMemo(() => clampInt(Number(gramsText), 1, 2000), [gramsText]);

  const totals = useMemo(() => {
    const acc = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    for (const row of draft) {
      const ratio = Math.max(0, Number(row.grams) || 0) / 100;
      const n = row.candidate.nutrients;
      acc.calories += (Number(n.caloriesKcal) || 0) * ratio;
      acc.protein += (Number(n.proteinG) || 0) * ratio;
      acc.carbs += (Number(n.carbsG) || 0) * ratio;
      acc.fat += (Number(n.fatG) || 0) * ratio;
    }
    return {
      calories: Math.round(acc.calories),
      protein: Math.round(acc.protein * 10) / 10,
      carbs: Math.round(acc.carbs * 10) / 10,
      fat: Math.round(acc.fat * 10) / 10,
    };
  }, [draft]);

  const capture = useCallback(async () => {
    setError(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (!cameraRef.current) throw new Error('camera_not_ready');
      const raw = await cameraRef.current.takePictureAsync({ quality: 0.9, exif: false, base64: false });
      if (!raw?.uri) throw new Error('capture_failed');

      setStep('analyzing');
      const manipulated = await manipulateAsync(
        raw.uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.85, format: SaveFormat.JPEG, base64: true }
      );
      const imageBase64 = String(manipulated.base64 || '').trim();
      if (!imageBase64) throw new Error('encode_failed');

      const res = await photoScanFood({ imageBase64, locale: Intl.DateTimeFormat?.().resolvedOptions?.().locale || 'en-US' });
      setScan(res);
      if (res.isPackagedLikely) setStep('packaged');
      else setStep('results');
    } catch (e: any) {
      setError(String(e?.message || 'Scan failed'));
      setStep('camera');
    }
  }, []);

  const chooseCandidate = useCallback((c: PhotoScanCandidate) => {
    setSelected(c);
    setGramsText('200');
    setStep('portion');
  }, []);

  const addSelectedToDraft = useCallback(() => {
    if (!selected) return;
    setDraft((prev) => [...prev, { candidate: selected, grams }]);
    setSelected(null);
    setStep('results');
  }, [selected, grams]);

  const logDraft = useCallback(async () => {
    if (logging) return;
    if (!draft.length) return;
    setLogging(true);
    try {
      for (const row of draft) {
        const item = candidateToCanonicalFoodItem(row.candidate);
        const qty = Math.max(0.01, (Number(row.grams) || 0) / 100);
        await addFoodToDailyLog({
          item,
          servingLabel: '100g',
          quantity: qty,
          meal: mealForDate(),
          note: `${candidateBadge(row.candidate)} · Photo scan`,
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace('/(modals)/food' as any);
    } catch {
      setError('Could not log foods. Try again.');
    } finally {
      setLogging(false);
    }
  }, [draft, logging]);

  if (!permission) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.title}>Loading camera…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.title}>Camera access needed</Text>
          <Text style={styles.sub}>Enable camera to scan meals from a photo.</Text>
          <Pressable style={styles.button} onPress={() => requestPermission()}>
            <Text style={styles.buttonText}>Allow Camera</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.ghost]} onPress={() => router.back()}>
            <Text style={styles.ghostText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'camera') {
    return (
      <SafeAreaView style={styles.screen}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />

        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.photoBox} />
          <Text style={styles.sub}>Good lighting, fill frame, avoid blur</Text>
          {error ? <Text style={styles.err}>{error}</Text> : null}
        </View>

        <View style={styles.topBar}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        </View>

        <View style={styles.bottomBar}>
          <Pressable style={styles.captureButton} onPress={capture}>
            <Text style={styles.captureText}>Capture</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'analyzing') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator color="#00D9FF" />
          <Text style={styles.title}>Identifying foods…</Text>
          <Text style={styles.sub}>Accuracy first. You will confirm portions.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'packaged') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={[styles.center, { paddingHorizontal: 16 }]}>
          <Text style={styles.title}>This looks packaged</Text>
          <Text style={styles.sub}>Barcode is most accurate.</Text>
          <Pressable style={styles.button} onPress={() => router.replace('/(modals)/food-scan' as any)}>
            <Text style={styles.buttonText}>Scan BC</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.ghost]} onPress={() => setStep('results')}>
            <Text style={styles.ghostText}>Continue with Photo</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.ghost]} onPress={() => router.replace('/(modals)/food' as any)}>
            <Text style={styles.ghostText}>Search manually</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'portion' && selected) {
    const n = selected.nutrients;
    const ratio = grams / 100;
    const kcal = Math.round((Number(n.caloriesKcal) || 0) * ratio);
    const p = Math.round((Number(n.proteinG) || 0) * ratio * 10) / 10;
    const c = Math.round((Number(n.carbsG) || 0) * ratio * 10) / 10;
    const f = Math.round((Number(n.fatG) || 0) * ratio * 10) / 10;

    const kcalMacro = caloriesFromMacros(p, c, f);
    const delta = kcal > 0 ? Math.abs(kcal - kcalMacro) / kcal : 0;
    const hasEnergyMismatch = delta > 0.35 || (selected.confidence?.reasons || []).some((r) => String(r).toLowerCase().includes('energy mismatch'));

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.sheet} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => setStep('results')}>
              <Text style={styles.link}>Back</Text>
            </Pressable>
            <Text style={styles.hTitle}>Confirm portion</Text>
            <View style={{ width: 44 }} />
          </View>

          <GlassCard>
            <Text style={styles.kicker}>Selected</Text>
            <Text style={styles.foodName}>{selected.displayName}</Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, { borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)' }]}>
                <Text style={styles.badgeText}>{candidateBadge(selected)}</Text>
              </View>
              <View style={[styles.badge, { borderColor: candidateAccent(selected).border, backgroundColor: candidateAccent(selected).bg }]}>
                <Text style={[styles.badgeText, { color: candidateAccent(selected).fg }]}>{selected.confidence?.tier || 'LOW'}</Text>
              </View>
            </View>
          </GlassCard>

          <GlassCard style={{ marginTop: 12 }}>
            <Text style={styles.kicker}>Portion (grams)</Text>
            <NumberPadTextInput
              style={styles.gramsInput}
              value={String(gramsText)}
              onChangeText={setGramsText}
              placeholder="e.g. 200"
              placeholderTextColor="rgba(255,255,255,0.35)"
              keyboardType="number-pad"
            />
            <View style={styles.quickRow}>
              {[50, 100, 200, 300].map((v) => (
                <Pressable key={String(v)} style={styles.quickBtn} onPress={() => setGramsText(String(v))}>
                  <Text style={styles.quickBtnText}>{v}g</Text>
                </Pressable>
              ))}
            </View>
          </GlassCard>

          <GlassCard style={{ marginTop: 12 }}>
            <Text style={styles.kicker}>Totals</Text>
            <Text style={styles.macroLine}>{formatInt(kcal)} kcal</Text>
            <Text style={styles.metaLine}>P {p}g · C {c}g · F {f}g</Text>
            {selected.confidence?.tier === 'LOW' ? (
              <Text style={[styles.warnLine, { color: '#FFB000' }]}>Low confidence. Verify selection.</Text>
            ) : null}
            {hasEnergyMismatch ? (
              <Text style={[styles.warnLine, { color: '#FFB000' }]}>Energy mismatch. Verify.</Text>
            ) : null}
          </GlassCard>

          <View style={styles.actionsRow}>
            <Pressable style={styles.primaryBtn} onPress={addSelectedToDraft}>
              <Text style={styles.primaryBtnText}>Add Item</Text>
            </Pressable>
            <Pressable style={styles.ghostBtn} onPress={() => setStep('results')}>
              <Text style={styles.ghostBtnText}>Choose different</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Results
  const candidates = Array.isArray(scan?.candidates) ? scan!.candidates : [];
  const top = candidates.slice(0, 1);
  const rest = candidates.slice(1, 11);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.sheet} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.link}>Back</Text>
          </Pressable>
          <Text style={styles.hTitle}>Scan results</Text>
          <Pressable onPress={() => router.replace('/(modals)/food' as any)}>
            <Text style={styles.link}>Search</Text>
          </Pressable>
        </View>

        {scan?.warnings?.length ? (
          <GlassCard style={{ borderColor: 'rgba(255,176,0,0.22)' }}>
            <Text style={styles.kicker}>Warning</Text>
            {scan.warnings.slice(0, 2).map((w, idx) => (
              <Text key={String(idx)} style={styles.warnLine}>
                {w}
              </Text>
            ))}
          </GlassCard>
        ) : null}

        <GlassCard style={{ marginTop: scan?.warnings?.length ? 12 : 0 }}>
          <Text style={styles.kicker}>Top match</Text>
          {top.length ? (
            top.map((c) => {
              const accent = candidateAccent(c);
              return (
                <Pressable key={c.candidateId} style={[styles.row, { borderColor: accent.border, backgroundColor: accent.bg }]} onPress={() => chooseCandidate(c)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{c.displayName}</Text>
                    <Text style={styles.rowMeta}>
                      {candidateBadge(c)} · {c.base?.kind === 'PER_SERVING' ? 'per serving' : 'per 100g'}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {formatInt(c.nutrients?.caloriesKcal || 0)} kcal · P {c.nutrients?.proteinG ?? 0} · C {c.nutrients?.carbsG ?? 0} · F {c.nutrients?.fatG ?? 0}
                    </Text>
                  </View>
                  <View style={[styles.badge, { borderColor: accent.border, backgroundColor: accent.bg }]}>
                    <Text style={[styles.badgeText, { color: accent.fg }]}>{c.confidence?.tier || 'LOW'}</Text>
                  </View>
                </Pressable>
              );
            })
          ) : (
            <Text style={styles.sub}>No candidates. Try manual search.</Text>
          )}
        </GlassCard>

        <GlassCard style={{ marginTop: 12 }}>
          <Text style={styles.kicker}>Other matches</Text>
          {rest.map((c) => {
            const accent = candidateAccent(c);
            return (
              <Pressable key={c.candidateId} style={[styles.row, { borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(0,0,0,0.14)' }]} onPress={() => chooseCandidate(c)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{c.displayName}</Text>
                  <Text style={styles.rowMeta}>
                    {candidateBadge(c)} · {c.base?.kind === 'PER_SERVING' ? 'per serving' : 'per 100g'} · {c.confidence?.tier || 'LOW'}
                  </Text>
                </View>
                <View style={[styles.badge, { borderColor: accent.border, backgroundColor: accent.bg }]}>
                  <Text style={[styles.badgeText, { color: accent.fg }]}>{formatInt(c.nutrients?.caloriesKcal || 0)} kcal</Text>
                </View>
              </Pressable>
            );
          })}
          {!rest.length ? <Text style={styles.sub}>No additional matches.</Text> : null}
        </GlassCard>

        <GlassCard style={{ marginTop: 12 }}>
          <Text style={styles.kicker}>Draft meal</Text>
          {draft.length ? (
            <>
              {draft.map((row, idx) => (
                <View key={String(idx)} style={[styles.draftRow, idx === draft.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={styles.draftName} numberOfLines={1}>
                    {row.candidate.displayName}
                  </Text>
                  <Text style={styles.draftMeta}>{row.grams}g</Text>
                </View>
              ))}
              <Text style={[styles.metaLine, { marginTop: 10 }]}>
                Total: {formatInt(totals.calories)} kcal · P {totals.protein} · C {totals.carbs} · F {totals.fat}
              </Text>
              <Pressable style={[styles.primaryBtn, { marginTop: 10, opacity: logging ? 0.7 : 1 }]} onPress={logDraft} disabled={logging}>
                <Text style={styles.primaryBtnText}>{logging ? 'Logging…' : 'Log Meal'}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.sub}>Add one or more items, then log.</Text>
          )}
        </GlassCard>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  photoBox: {
    width: 260,
    height: 260,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#00D9FF',
    backgroundColor: 'rgba(0,0,0,0.14)',
  },
  topBar: { position: 'absolute', top: 10, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  bottomBar: { position: 'absolute', left: 16, right: 16, bottom: 20 },
  backButton: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backText: { color: '#FFF', fontWeight: '700' },
  captureButton: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureText: { color: '#03141A', fontWeight: '900', fontSize: 16 },
  title: { color: '#FFF', fontWeight: '900', fontSize: 20, textAlign: 'center', marginTop: 12 },
  sub: { color: '#D4EAF2', textAlign: 'center', marginTop: 10, fontWeight: '700', lineHeight: 18 },
  err: { color: '#FF8A8A', textAlign: 'center', marginTop: 10, fontWeight: '800' },
  button: {
    backgroundColor: '#00D9FF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginTop: 14,
    minWidth: 220,
    alignItems: 'center',
  },
  buttonText: { color: '#03141A', fontWeight: '900' },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#3B4B54' },
  ghostText: { color: '#C7DFE7', fontWeight: '800' },

  sheet: { padding: 16, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  hTitle: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  link: { color: '#7EDCFF', fontWeight: '900' },
  kicker: { color: '#9EB8C1', fontWeight: '900', fontSize: 11, letterSpacing: 1, marginBottom: 8 },
  foodName: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  badgesRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  badgeText: { color: '#EAFBFF', fontWeight: '900', fontSize: 11, letterSpacing: 0.2 },

  gramsInput: {
    marginTop: 8,
    minHeight: 50,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
    color: '#FFF',
    fontWeight: '900',
    fontSize: 18,
  } as any,
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  quickBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  quickBtnText: { color: '#EAFBFF', fontWeight: '900', fontSize: 12 },

  macroLine: { color: '#FFF', fontWeight: '900', fontSize: 18 },
  metaLine: { color: 'rgba(255,255,255,0.72)', fontWeight: '800', marginTop: 6 },
  warnLine: { color: '#FFD18A', fontWeight: '800', marginTop: 6 },

  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primaryBtn: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: '#00D9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#03141A', fontWeight: '900' },
  ghostBtn: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnText: { color: '#EAFBFF', fontWeight: '900' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 8,
  },
  rowTitle: { color: '#FFF', fontWeight: '900' },
  rowMeta: { color: 'rgba(255,255,255,0.65)', fontWeight: '700', marginTop: 4, fontSize: 12, lineHeight: 16 },

  draftRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  draftName: { color: '#EAEAEA', fontWeight: '900', flex: 1 },
  draftMeta: { color: 'rgba(255,255,255,0.65)', fontWeight: '800' },
});
