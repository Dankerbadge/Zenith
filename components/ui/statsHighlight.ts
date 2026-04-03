import { NEON_THEME } from '../../constants/neonTheme';

export const STATS_HIGHLIGHT_GLOSS = ['rgba(255,255,255,0.12)', 'rgba(0,0,0,0.00)'] as const;

export function statsHighlightWash(color: string): readonly [string, string, string] {
  return [color + '55', color + '22', 'rgba(0,0,0,0)'] as const;
}

export function statsHighlightBorder(color: string): string {
  return color + '99';
}

export function statsHighlightRail(color: string): readonly [string, string] {
  return [color + 'FF', color + '88'] as const;
}

export const STATS_SURFACE = NEON_THEME.color.surface0;
