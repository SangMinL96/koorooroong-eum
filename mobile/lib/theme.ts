/**
 * Meta-inspired design tokens.
 * Source: getdesign.md/meta — "Tech retail store. Photography-first,
 *   binary light/dark surfaces, Meta Blue CTAs"
 *
 * 핵심 원칙
 *  - Binary surfaces: 표면은 흰색(또는 검정) 단색. 회색 패널을 남발하지 않음.
 *  - Photography-first: 콘텐츠가 주인공 — UI 크롬은 묵묵하고 헤비한 타이포로 받침.
 *  - Meta Blue CTA: 강한 액션은 단 한 가지 톤 — Meta Blue.
 *  - 굵은 sans-serif 디스플레이/헤딩 + 차분한 그레이 보조 텍스트.
 */

export const colors = {
  // Brand — Meta Blue
  brand: '#0064E0',
  brandHover: '#0150B5',
  brandSubtle: '#E7F0FE',
  onBrand: '#FFFFFF',

  // Binary surfaces
  bg: '#FFFFFF',
  bgInverse: '#000000',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F6F7',

  // Text
  text: '#000000',
  textSecondary: '#65676B',
  textTertiary: '#8A8D91',
  textInverse: '#FFFFFF',
  textLink: '#0064E0',

  // Borders / dividers
  border: '#DADDE1',
  borderStrong: '#BCC0C4',

  // Status
  success: '#1F8A4C',
  danger: '#E0245E',
  warning: '#E2A03F',
  info: '#0064E0',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xl2: 24,
  xl3: 32,
  xl4: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/**
 * Typography presets.
 * - 디스플레이/헤딩: 굵은 weight + 약한 음수 letter spacing (Meta 마케팅 헤더 톤)
 * - body: 시스템 기본
 */
export const typography = {
  displayXL: { fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -0.5 },
  displayL: { fontSize: 32, lineHeight: 36, fontWeight: '800', letterSpacing: -0.3 },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.2 },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  h3: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  bodyLg: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  body: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  bodySm: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  button: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
} as const;

export const elevation = {
  none: {},
  sm: {
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
} as const;

export const theme = { colors, spacing, radius, typography, elevation } as const;
export type Theme = typeof theme;
