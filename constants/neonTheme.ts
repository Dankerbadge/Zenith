export const NEON_THEME = {
  color: {
    bg0: '#0A0A0A',
    bgTopTint: '#071518',
    surface0: '#0F1114',
    surface1: '#12151B',
    surface2: '#0B0D10',
    strokeSubtle: 'rgba(255,255,255,0.08)',
    strokeStrong: 'rgba(255,255,255,0.14)',
    textPrimary: '#F4F7FF',
    textSecondary: 'rgba(244,247,255,0.72)',
    textTertiary: 'rgba(244,247,255,0.50)',
    neonOrange: '#F5A810',
    neonPurple: '#BB4EF2',
    neonCyan: '#0ED2F4',
    neonGreen: '#7FF960',
    neonRed: '#FF4D6D',
  },
  spacing: {
    4: 4,
    8: 8,
    12: 12,
    16: 16,
    20: 20,
    24: 24,
    32: 32,
  },
  radius: {
    tiny: 12,
    small: 16,
    card: 20,
    pill: 999,
  },
  typography: {
    screenTitle: { fontSize: 34, lineHeight: 40, fontWeight: '800' as const },
    sectionLabel: { fontSize: 13, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 0.52 },
    cardTitle: { fontSize: 16, lineHeight: 20, fontWeight: '700' as const },
    metricValue: { fontSize: 28, lineHeight: 32, fontWeight: '800' as const },
    body: { fontSize: 15, lineHeight: 20, fontWeight: '500' as const },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
  },
} as const;

const SEMANTIC_TO_COLOR = {
  calories: NEON_THEME.color.neonOrange,
  protein: NEON_THEME.color.neonPurple,
  hydration: NEON_THEME.color.neonCyan,
  water: NEON_THEME.color.neonCyan,
  activity: NEON_THEME.color.neonGreen,
  workout: NEON_THEME.color.neonGreen,
  recovery: NEON_THEME.color.neonGreen,
  readiness: NEON_THEME.color.neonCyan,
  warning: NEON_THEME.color.neonOrange,
  error: NEON_THEME.color.neonRed,
} as const;

export type NeonSemantic = keyof typeof SEMANTIC_TO_COLOR;

export function neonColorFor(semantic: NeonSemantic): string {
  return SEMANTIC_TO_COLOR[semantic];
}

export function withAlpha(hex: string, alphaHex: string): string {
  return `${hex}${alphaHex}`;
}

