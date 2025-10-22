/**
 * Compact theme serialization for URL parameters and data sharing
 * 
 * This module provides efficient serialization of theme configurations by:
 * - Only encoding values that differ from defaults
 * - Using short keys for common properties
 * - Supporting both light and dark themes
 */

import type { ThemeConfiguration, ThemeTokenKey, ThemeMeta } from './theme-builder';
import { defaultTheme, lightTheme } from './theme-builder';

/**
 * Compact key mappings for URL parameters (single character where possible)
 */
const COMPACT_TOKEN_KEYS: Record<ThemeTokenKey, string> = {
  // Backgrounds & Surfaces (b prefix)
  bgBase: 'bb',
  bgGlass: 'bg',
  bgGlassStrong: 'bs',
  bgPanel: 'bp',
  
  // Borders (r prefix)
  borderGlass: 'rg',
  borderStrong: 'rs',
  
  // Text (t prefix)
  textPrimary: 'tp',
  textSecondary: 'ts',
  
  // Accent (a prefix)
  accent: 'a',
  accentStrong: 'as',
  
  // Shadow (s prefix)
  shadowSoft: 'ss',
  shadowButton: 'sb',
  
  // Radius (d prefix for dimension)
  radiusLg: 'dl',
  radiusMd: 'dm',
  radiusSm: 'ds',
  
  // Code highlighting (c prefix)
  codeKw: 'ck',
  codeId: 'ci',
  codeNum: 'cn',
  codeStr: 'cs',
  codeTpl: 'ct',
  codeCom: 'cc',
  codeOp: 'co',
  codePunc: 'cp',
  codeRx: 'cr',
  
  // Blockquote (q prefix)
  blockquoteBorder: 'qb',
  blockquoteBg: 'qg',
  blockquoteText: 'qt',
  blockquoteAccent: 'qa',
  
  // Info/Warning/Error/Success (i/w/e/u prefix)
  infoBorder: 'ib',
  infoBg: 'ig',
  warningBorder: 'wb',
  warningBg: 'wg',
  errorBorder: 'eb',
  errorBg: 'eg',
  successBorder: 'ub',
  successBg: 'ug',
};

/**
 * Reverse mapping for deserialization
 */
const COMPACT_TOKEN_KEYS_REVERSE: Record<string, ThemeTokenKey> = Object.fromEntries(
  Object.entries(COMPACT_TOKEN_KEYS).map(([k, v]) => [v, k as ThemeTokenKey])
) as Record<string, ThemeTokenKey>;

/**
 * Compact meta keys
 */
const COMPACT_META_KEYS = {
  fontFamily: 'ff',
  fontSize: 'fs',
  fontWeight: 'fw',
  lineHeight: 'lh',
  monoFontFamily: 'mf',
} as const;

/**
 * Reverse mapping for meta keys
 */
const COMPACT_META_KEYS_REVERSE: Record<string, keyof typeof COMPACT_META_KEYS> = Object.fromEntries(
  Object.entries(COMPACT_META_KEYS).map(([k, v]) => [v, k])
) as Record<string, keyof typeof COMPACT_META_KEYS>;

/**
 * Serializes a theme configuration to a compact string
 * Only includes values that differ from the default theme
 */
export function serializeTheme(
  config: ThemeConfiguration,
  mode: 'light' | 'dark' = 'dark'
): string {
  const defaultConfig = mode === 'light' ? lightTheme : defaultTheme;
  const parts: string[] = [];
  
  // Serialize tokens (only if different from default)
  for (const [fullKey, compactKey] of Object.entries(COMPACT_TOKEN_KEYS)) {
    const key = fullKey as ThemeTokenKey;
    const value = config.tokens[key];
    const defaultValue = defaultConfig.tokens[key];
    
    if (value !== defaultValue) {
      parts.push(`${compactKey}=${encodeURIComponent(value)}`);
    }
  }
  
  // Serialize meta (only if different from default, excluding colorScheme)
  for (const [fullKey, compactKey] of Object.entries(COMPACT_META_KEYS)) {
    const key = fullKey as keyof ThemeMeta;
    const value = config.meta[key];
    const defaultValue = defaultConfig.meta[key];
    
    if (value !== defaultValue) {
      parts.push(`${compactKey}=${encodeURIComponent(value)}`);
    }
  }
  
  // Serialize custom properties (prefix with 'x_')
  for (const [key, value] of Object.entries(config.customProperties)) {
    const defaultValue = defaultConfig.customProperties[key];
    if (value !== defaultValue) {
      const cleanKey = key.replace(/^--/, '');
      parts.push(`x_${cleanKey}=${encodeURIComponent(value)}`);
    }
  }
  
  return parts.join('&');
}

/**
 * Deserializes a compact theme string into a partial theme configuration
 */
export function deserializeTheme(
  serialized: string,
  mode: 'light' | 'dark' = 'dark'
): Partial<ThemeConfiguration> {
  const defaultConfig = mode === 'light' ? lightTheme : defaultTheme;
  const tokens: Partial<Record<ThemeTokenKey, string>> = {};
  const meta: Partial<ThemeMeta> = {};
  const customProperties: Record<string, string> = {};
  
  const parts = serialized.split('&');
  
  for (const part of parts) {
    if (!part) continue;
    
    const [key, value] = part.split('=');
    if (!key || !value) continue;
    
    const decodedValue = decodeURIComponent(value);
    
    // Check if it's a custom property
    if (key.startsWith('x_')) {
      const propKey = `--${key.slice(2)}`;
      customProperties[propKey] = decodedValue;
    }
    // Check if it's a meta property
    else if (key in COMPACT_META_KEYS_REVERSE) {
      const metaKey = COMPACT_META_KEYS_REVERSE[key];
      (meta as Record<string, string>)[metaKey] = decodedValue;
    }
    // Check if it's a token
    else if (key in COMPACT_TOKEN_KEYS_REVERSE) {
      const tokenKey = COMPACT_TOKEN_KEYS_REVERSE[key];
      tokens[tokenKey] = decodedValue;
    }
  }
  
  const result: Partial<ThemeConfiguration> = {};
  
  if (Object.keys(meta).length > 0) {
    result.meta = { ...defaultConfig.meta, ...meta };
  }
  
  if (Object.keys(tokens).length > 0) {
    result.tokens = { ...defaultConfig.tokens, ...tokens };
  }
  
  if (Object.keys(customProperties).length > 0) {
    result.customProperties = { ...defaultConfig.customProperties, ...customProperties };
  }
  
  return result;
}

/**
 * Serializes theme configurations for both light and dark modes
 * Returns an object with 'd' and 'l' keys for dark and light themes
 */
export function serializeThemes(
  darkConfig: ThemeConfiguration,
  lightConfig: ThemeConfiguration
): { d?: string; l?: string } {
  const result: { d?: string; l?: string } = {};
  
  const darkSerialized = serializeTheme(darkConfig, 'dark');
  const lightSerialized = serializeTheme(lightConfig, 'light');
  
  if (darkSerialized) {
    result.d = darkSerialized;
  }
  
  if (lightSerialized) {
    result.l = lightSerialized;
  }
  
  return result;
}

/**
 * Deserializes theme data for both modes
 */
export function deserializeThemes(data: { d?: string; l?: string }): {
  dark?: Partial<ThemeConfiguration>;
  light?: Partial<ThemeConfiguration>;
} {
  const result: {
    dark?: Partial<ThemeConfiguration>;
    light?: Partial<ThemeConfiguration>;
  } = {};
  
  if (data.d) {
    result.dark = deserializeTheme(data.d, 'dark');
  }
  
  if (data.l) {
    result.light = deserializeTheme(data.l, 'light');
  }
  
  return result;
}

