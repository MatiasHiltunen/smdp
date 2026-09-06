import type { DiagramPaint, DiagramTheme } from './types';

export const DEFAULT_DIAGRAM_THEME: DiagramTheme = {
  background: '#ffffff',
  surface: '#f8fafc',
  surfaceAlt: '#eef2ff',
  text: '#172033',
  muted: '#667085',
  accent: '#4f46e5',
  border: '#aeb8ca',
  success: '#16865b',
  warning: '#b06d0a',
  danger: '#c43d4b',
  palette: ['#4f46e5', '#0f8f8a', '#d97706', '#c2416c', '#6d56c9', '#3684b8'],
};

const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%degturnrad]+\)|[a-z]+)$/i;

function safeColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  return SAFE_COLOR.test(trimmed) ? trimmed : fallback;
}

export function resolveDiagramTheme(input: Partial<DiagramTheme> | undefined): DiagramTheme {
  const palette = DEFAULT_DIAGRAM_THEME.palette.map((fallback, index) =>
    safeColor(input?.palette?.[index], fallback),
  ) as unknown as DiagramTheme['palette'];
  return {
    background: safeColor(input?.background, DEFAULT_DIAGRAM_THEME.background),
    surface: safeColor(input?.surface, DEFAULT_DIAGRAM_THEME.surface),
    surfaceAlt: safeColor(input?.surfaceAlt, DEFAULT_DIAGRAM_THEME.surfaceAlt),
    text: safeColor(input?.text, DEFAULT_DIAGRAM_THEME.text),
    muted: safeColor(input?.muted, DEFAULT_DIAGRAM_THEME.muted),
    accent: safeColor(input?.accent, DEFAULT_DIAGRAM_THEME.accent),
    border: safeColor(input?.border, DEFAULT_DIAGRAM_THEME.border),
    success: safeColor(input?.success, DEFAULT_DIAGRAM_THEME.success),
    warning: safeColor(input?.warning, DEFAULT_DIAGRAM_THEME.warning),
    danger: safeColor(input?.danger, DEFAULT_DIAGRAM_THEME.danger),
    palette,
  };
}

export function diagramPaintColor(paint: DiagramPaint | undefined, theme: DiagramTheme): string {
  if (!paint || paint === 'none') return 'none';
  if (paint.startsWith('palette')) {
    const index = Number(paint.slice('palette'.length));
    return theme.palette[index] ?? theme.accent;
  }
  switch (paint) {
    case 'background': return theme.background;
    case 'surface': return theme.surface;
    case 'surfaceAlt': return theme.surfaceAlt;
    case 'text': return theme.text;
    case 'muted': return theme.muted;
    case 'accent': return theme.accent;
    case 'border': return theme.border;
    case 'success': return theme.success;
    case 'warning': return theme.warning;
    case 'danger': return theme.danger;
    default: return theme.accent;
  }
}
