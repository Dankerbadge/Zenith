import { NEON_THEME } from './neonTheme';

export const TOKENS = {
  spacing: {
    1: NEON_THEME.spacing[8],
    2: NEON_THEME.spacing[16],
    3: NEON_THEME.spacing[24],
    4: NEON_THEME.spacing[32],
  },
  radius: {
    chip: NEON_THEME.radius.tiny,
    card: NEON_THEME.radius.small,
    sheet: NEON_THEME.radius.card,
    pill: NEON_THEME.radius.pill,
  },
  color: {
    surface0: NEON_THEME.color.bg0,
    surface1: NEON_THEME.color.surface0,
    surface2: NEON_THEME.color.surface1,
    stroke: NEON_THEME.color.strokeSubtle,
    text: NEON_THEME.color.textPrimary,
    textMuted: NEON_THEME.color.textSecondary,
    textFaint: NEON_THEME.color.textTertiary,
    accent: NEON_THEME.color.neonCyan,
    accentSoft: `${NEON_THEME.color.neonCyan}2A`,
    success: NEON_THEME.color.neonGreen,
    warning: NEON_THEME.color.neonOrange,
    danger: NEON_THEME.color.neonRed,
  },
  typography: {
    title: { fontSize: NEON_THEME.typography.screenTitle.fontSize, fontWeight: '800' as const },
    section: { fontSize: NEON_THEME.typography.cardTitle.fontSize, fontWeight: '700' as const },
    body: { fontSize: NEON_THEME.typography.body.fontSize, fontWeight: '500' as const },
    meta: { fontSize: NEON_THEME.typography.sectionLabel.fontSize, fontWeight: '700' as const },
    caption: { fontSize: NEON_THEME.typography.caption.fontSize, fontWeight: '500' as const },
  },
} as const;
