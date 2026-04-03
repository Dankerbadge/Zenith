import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { calculateCurrentRank, RANKS, type Rank } from '../constants/ranks';
import { getWinningSnapshot } from '../utils/winningSystem';
import RankUpModal from './RankUpModal';

const LAST_CELEBRATED_RANK_KEY = 'zenith:lastCelebratedRankId:v1';

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rankIndex(rankId: string | null | undefined) {
  const id = String(rankId || '');
  const idx = RANKS.findIndex((r) => r.id === id);
  return idx >= 0 ? idx : 0;
}

export default function RankUpCelebrationController(props: { pathname?: string | null }) {
  const [visible, setVisible] = useState(false);
  const [rank, setRank] = useState<Rank | null>(null);
  const activeCheckRef = useRef(false);

  const isSuppressedRoute = useMemo(() => {
    const p = String(props.pathname || '');
    // Avoid rank-up overlays during onboarding/paywall/permission funnels.
    return (
      p.includes('onboarding') ||
      p.includes('paywall') ||
      p.includes('health-permissions') ||
      p.includes('/auth')
    );
  }, [props.pathname]);

  const checkRankUp = useCallback(async (reason: 'mount' | 'route' | 'foreground' | 'event') => {
    if (activeCheckRef.current) return;
    if (visible) return;
    if (isSuppressedRoute) return;

    activeCheckRef.current = true;
    try {
      const [rawProgress, lastCelebratedIdRaw, winning] = await Promise.all([
        AsyncStorage.getItem('userProgress'),
        AsyncStorage.getItem(LAST_CELEBRATED_RANK_KEY),
        getWinningSnapshot(),
      ]);

      const progress = safeParseJson<{ totalXP?: number }>(rawProgress, {});
      const totalXP = Number(progress?.totalXP) || 0;
      const totalWinningDays = Number(winning?.totalWinningDays) || 0;

      const current = calculateCurrentRank(totalXP, totalWinningDays);
      const lastCelebratedId = (lastCelebratedIdRaw || '').trim();

      // First run: set baseline and never show a modal.
      if (!lastCelebratedId) {
        await AsyncStorage.setItem(LAST_CELEBRATED_RANK_KEY, current.id);
        return;
      }

      if (current.id === lastCelebratedId) return;

      const currentIdx = rankIndex(current.id);
      const lastIdx = rankIndex(lastCelebratedId);

      // Only celebrate actual rank-ups, not rank-downs or schema changes.
      if (currentIdx <= lastIdx) {
        await AsyncStorage.setItem(LAST_CELEBRATED_RANK_KEY, current.id);
        return;
      }

      setRank(current);
      setVisible(true);
    } catch {
      // Ignore; celebrations should never crash the app.
      void reason;
    } finally {
      activeCheckRef.current = false;
    }
  }, [visible, isSuppressedRoute]);

  useEffect(() => {
    void checkRankUp('mount');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void checkRankUp('route');
  }, [props.pathname, checkRankUp]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkRankUp('foreground');
    });
    return () => sub.remove();
  }, [checkRankUp]);

  return (
    <RankUpModal
      visible={visible}
      rankName={rank?.name || ''}
      rankColor={rank?.color || '#00D9FF'}
      onClose={() => {
        const next = rank?.id;
        setVisible(false);
        setRank(null);
        if (next) {
          void AsyncStorage.setItem(LAST_CELEBRATED_RANK_KEY, next);
        }
      }}
    />
  );
}

