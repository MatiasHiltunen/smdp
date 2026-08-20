export type ThemeTokenKey =
  | 'bgBase'
  | 'bgGlass'
  | 'bgGlassStrong'
  | 'bgPanel'
  | 'borderGlass'
  | 'borderStrong'
  | 'textPrimary'
  | 'textSecondary'
  | 'accent'
  | 'accentStrong'
  | 'shadowSoft'
  | 'shadowButton'
  | 'radiusLg'
  | 'radiusMd'
  | 'radiusSm'
  | 'codeKw'
  | 'codeId'
  | 'codeNum'
  | 'codeStr'
  | 'codeTpl'
  | 'codeCom'
  | 'codeOp'
  | 'codePunc'
  | 'codeRx'
  | 'blockquoteBorder'
  | 'blockquoteBg'
  | 'blockquoteText'
  | 'blockquoteAccent'
  | 'infoBorder'
  | 'infoBg'
  | 'warningBorder'
  | 'warningBg'
  | 'errorBorder'
  | 'errorBg'
  | 'successBorder'
  | 'successBg';

export type ThemeTokens = Record<ThemeTokenKey, string>;

export interface ThemeMeta {
  /**
   * Sets the base color scheme for surfaces (e.g., dark or light).
   */
  colorScheme: string;
  /**
   * Default typography for the container.
   */
  fontFamily: string;
  /**
   * Base font size, applied at the container level.
   */
  fontSize: string;
  /**
   * Base font weight for text.
   */
  fontWeight: string;
  /**
   * Baseline line height for typography.
   */
  lineHeight: string;
  /**
   * Monospace font used for code blocks and editor.
   */
  monoFontFamily: string;
}

export interface ThemeConfiguration {
  meta: ThemeMeta;
  tokens: ThemeTokens;
  customProperties: Record<string, string>;
}

export interface ThemeBuilderInit {
  meta?: Partial<ThemeMeta>;
  tokens?: Partial<ThemeTokens>;
  customProperties?: Record<string, string>;
}

const CSS_VARIABLES: Record<ThemeTokenKey, `--${string}`> = {
  bgBase: '--bg-base',
  bgGlass: '--bg-glass',
  bgGlassStrong: '--bg-glass-strong',
  bgPanel: '--bg-panel',
  borderGlass: '--border-glass',
  borderStrong: '--border-strong',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  accent: '--accent',
  accentStrong: '--accent-strong',
  shadowSoft: '--shadow-soft',
  shadowButton: '--shadow-button',
  radiusLg: '--radius-lg',
  radiusMd: '--radius-md',
  radiusSm: '--radius-sm',
  codeKw: '--code-kw',
  codeId: '--code-id',
  codeNum: '--code-num',
  codeStr: '--code-str',
  codeTpl: '--code-tpl',
  codeCom: '--code-com',
  codeOp: '--code-op',
  codePunc: '--code-punc',
  codeRx: '--code-rx',
  blockquoteBorder: '--blockquote-border',
  blockquoteBg: '--blockquote-bg',
  blockquoteText: '--blockquote-text',
  blockquoteAccent: '--blockquote-accent',
  infoBorder: '--info-border',
  infoBg: '--info-bg',
  warningBorder: '--warning-border',
  warningBg: '--warning-bg',
  errorBorder: '--error-border',
  errorBg: '--error-bg',
  successBorder: '--success-border',
  successBg: '--success-bg',
};

const DEFAULT_TOKENS: ThemeTokens = {
  bgBase: '#0b0d12',
  bgGlass: '#11141b',
  bgGlassStrong: '#151922',
  bgPanel: '#171b24',
  borderGlass: 'rgba(226, 232, 240, 0.10)',
  borderStrong: 'rgba(226, 232, 240, 0.18)',
  textPrimary: '#f3f5f8',
  textSecondary: '#a8b0bd',
  accent: '#4f8cff',
  accentStrong: '#3b82f6',
  shadowSoft: '0 24px 64px rgba(0, 0, 0, 0.32)',
  shadowButton: '0 10px 28px rgba(24, 71, 160, 0.24)',
  radiusLg: '16px',
  radiusMd: '10px',
  radiusSm: '6px',
  codeKw: '#60a5fa',
  codeId: '#e7eaf0',
  codeNum: '#facc15',
  codeStr: '#4ade80',
  codeTpl: '#67e8f9',
  codeCom: '#7f8998',
  codeOp: '#f472b6',
  codePunc: '#b4bbc6',
  codeRx: '#f97316',
  blockquoteBorder: 'rgba(79, 140, 255, 0.58)',
  blockquoteBg: 'transparent',
  blockquoteText: '#c4cad4',
  blockquoteAccent: 'rgba(79, 140, 255, 0.58)',
  infoBorder: 'rgba(79, 140, 255, 0.42)',
  infoBg: 'rgba(79, 140, 255, 0.10)',
  warningBorder: 'rgba(245, 158, 11, 0.45)',
  warningBg: 'rgba(245, 158, 11, 0.16)',
  errorBorder: 'rgba(239, 68, 68, 0.5)',
  errorBg: 'rgba(239, 68, 68, 0.16)',
  successBorder: 'rgba(16, 185, 129, 0.45)',
  successBg: 'rgba(16, 185, 129, 0.16)',
};

const DEFAULT_META: ThemeMeta = {
  colorScheme: 'dark',
  fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  fontSize: '16px',
  fontWeight: '400',
  lineHeight: '1.7',
  monoFontFamily: '"JetBrains Mono", "SFMono-Regular", ui-monospace, monospace',
};

const DEFAULT_CUSTOM_PROPERTIES: Record<string, string> = {
  '--bg-glow-a': 'rgba(79, 140, 255, 0.04)',
  '--bg-glow-b': 'rgba(79, 140, 255, 0.02)',
  '--viewer-padding-inline': 'clamp(1.25rem, 5vw, 4rem)',
  '--viewer-padding-block': 'clamp(2.5rem, 7vw, 5.5rem)',
  '--viewer-margin-block': '0',
};

const LIGHT_TOKENS: ThemeTokens = {
  bgBase: '#edf0f4',
  bgGlass: '#f8f9fb',
  bgGlassStrong: '#ffffff',
  bgPanel: '#f5f7fa',
  borderGlass: '#dce1e8',
  borderStrong: '#c7ced8',
  textPrimary: '#171a21',
  textSecondary: '#596273',
  accent: '#2563eb',
  accentStrong: '#1d4ed8',
  shadowSoft: '0 24px 64px rgba(15, 23, 42, 0.10)',
  shadowButton: '0 10px 28px rgba(37, 99, 235, 0.18)',
  radiusLg: '16px',
  radiusMd: '10px',
  radiusSm: '6px',
  codeKw: '#2563eb',
  codeId: '#273142',
  codeNum: '#ca8a04',
  codeStr: '#15803d',
  codeTpl: '#0d9488',
  codeCom: '#687386',
  codeOp: '#9333ea',
  codePunc: '#536075',
  codeRx: '#c2410c',
  blockquoteBorder: 'rgba(37, 99, 235, 0.55)',
  blockquoteBg: 'transparent',
  blockquoteText: '#455064',
  blockquoteAccent: 'rgba(37, 99, 235, 0.55)',
  infoBorder: 'rgba(37, 99, 235, 0.40)',
  infoBg: 'rgba(37, 99, 235, 0.08)',
  warningBorder: 'rgba(234, 179, 8, 0.55)',
  warningBg: 'rgba(234, 179, 8, 0.12)',
  errorBorder: 'rgba(220, 38, 38, 0.55)',
  errorBg: 'rgba(220, 38, 38, 0.12)',
  successBorder: 'rgba(34, 197, 94, 0.55)',
  successBg: 'rgba(34, 197, 94, 0.12)',
};

const LIGHT_META: ThemeMeta = {
  ...DEFAULT_META,
  colorScheme: 'light',
};

const LIGHT_CUSTOM_PROPERTIES: Record<string, string> = {
  '--bg-glow-a': 'rgba(37, 99, 235, 0.04)',
  '--bg-glow-b': 'rgba(37, 99, 235, 0.02)',
  '--viewer-padding-inline': 'clamp(1.25rem, 5vw, 4rem)',
  '--viewer-padding-block': 'clamp(2.5rem, 7vw, 5.5rem)',
  '--viewer-margin-block': '0',
};

function cloneTokens(tokens: ThemeTokens): ThemeTokens {
  return { ...tokens };
}

function cloneMeta(meta: ThemeMeta): ThemeMeta {
  return { ...meta };
}

function normalizeCustomProperties(map: Record<string, string> | undefined): Record<string, string> {
  if (!map) {
    return {};
  }

  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(map)) {
    const propertyName = key.startsWith('--') ? key : `--${key}`;
    entries.push([propertyName, value]);
  }

  return Object.fromEntries(entries);
}

function resolveTargetElement(target?: Document | HTMLElement): HTMLElement {
  if (!target) {
    if (typeof document === 'undefined') {
      throw new Error('theme builder apply requires a DOM Document or HTMLElement');
    }

    return document.documentElement;
  }

  if ('documentElement' in target) {
    return target.documentElement;
  }

  return target;
}

export class ThemeBuilder {
  private readonly meta: ThemeMeta;
  private readonly tokens: ThemeTokens;
  private readonly customProperties: Record<string, string>;

  constructor(init?: ThemeBuilderInit) {
    this.meta = cloneMeta(DEFAULT_META);
    this.tokens = cloneTokens(DEFAULT_TOKENS);
    this.customProperties = { ...DEFAULT_CUSTOM_PROPERTIES };

    if (init?.meta) {
      this.withMeta(init.meta);
    }

    if (init?.tokens) {
      this.withTokens(init.tokens);
    }

    if (init?.customProperties) {
      this.withCustomProperties(init.customProperties);
    }
  }

  withMeta(meta: Partial<ThemeMeta>): this {
    for (const [key, value] of Object.entries(meta)) {
      if (value !== undefined) {
        (this.meta as unknown as Record<string, string>)[key] = value;
      }
    }
    return this;
  }

  withTokens(tokens: Partial<ThemeTokens>): this {
    for (const [key, value] of Object.entries(tokens)) {
      if (value !== undefined) {
        this.tokens[key as ThemeTokenKey] = value;
      }
    }
    return this;
  }

  withToken(name: ThemeTokenKey, value: string): this {
    this.tokens[name] = value;
    return this;
  }

  withCustomProperties(properties: Record<string, string>): this {
    const normalized = normalizeCustomProperties(properties);
    for (const [key, value] of Object.entries(normalized)) {
      this.customProperties[key] = value;
    }
    return this;
  }

  withCustomProperty(name: string, value: string): this {
    const propertyName = name.startsWith('--') ? name : `--${name}`;
    this.customProperties[propertyName] = value;
    return this;
  }

  clone(): ThemeBuilder {
    const builder = new ThemeBuilder();
    builder.withMeta(this.meta);
    builder.withTokens(this.tokens);
    builder.withCustomProperties(this.customProperties);
    return builder;
  }

  build(): ThemeConfiguration {
    return {
      meta: cloneMeta(this.meta),
      tokens: cloneTokens(this.tokens),
      customProperties: { ...this.customProperties },
    };
  }

  buildCss(scope = ':root'): string {
    const { meta, tokens, customProperties } = this.build();
    const rules: string[] = [];
    rules.push(`${scope} {`);
    rules.push(`  color-scheme: ${meta.colorScheme};`);
    rules.push(`  font-family: ${meta.fontFamily};`);
    rules.push(`  font-size: ${meta.fontSize};`);
    rules.push(`  font-weight: ${meta.fontWeight};`);
    rules.push(`  line-height: ${meta.lineHeight};`);
    rules.push(`  --font-mono: ${meta.monoFontFamily};`);
    for (const [token, value] of Object.entries(tokens)) {
      const variableName = CSS_VARIABLES[token as ThemeTokenKey];
      rules.push(`  ${variableName}: ${value};`);
    }
    for (const [name, value] of Object.entries(customProperties)) {
      rules.push(`  ${name}: ${value};`);
    }
    rules.push('}');
    return rules.join('\n');
  }

  buildStyleElement(options: { scope?: string; nonce?: string } = {}): HTMLStyleElement {
    const scope = options.scope ?? ':root';
    if (typeof document === 'undefined') {
      throw new Error('theme builder buildStyleElement requires a DOM Document');
    }
    const element = document.createElement('style');
    if (options.nonce) {
      element.nonce = options.nonce;
    }
    element.textContent = this.buildCss(scope);
    return element;
  }

  apply(target?: Document | HTMLElement): ThemeConfiguration {
    const element = resolveTargetElement(target);
    const theme = this.build();

    element.style.setProperty('color-scheme', theme.meta.colorScheme);
    element.style.setProperty('font-family', theme.meta.fontFamily);
    element.style.setProperty('font-size', theme.meta.fontSize);
    element.style.setProperty('font-weight', theme.meta.fontWeight);
    element.style.setProperty('line-height', theme.meta.lineHeight);
    element.style.setProperty('--font-mono', theme.meta.monoFontFamily);

    for (const [token, value] of Object.entries(theme.tokens)) {
      const name = CSS_VARIABLES[token as ThemeTokenKey];
      element.style.setProperty(name, value);
    }

    for (const [name, value] of Object.entries(theme.customProperties)) {
      element.style.setProperty(name, value);
    }

    return theme;
  }
}

export function createThemeBuilder(init?: ThemeBuilderInit): ThemeBuilder {
  return new ThemeBuilder(init);
}

export const defaultTheme: ThemeConfiguration = {
  meta: cloneMeta(DEFAULT_META),
  tokens: cloneTokens(DEFAULT_TOKENS),
  customProperties: { ...DEFAULT_CUSTOM_PROPERTIES },
};

export const lightTheme: ThemeConfiguration = {
  meta: cloneMeta(LIGHT_META),
  tokens: cloneTokens(LIGHT_TOKENS),
  customProperties: { ...LIGHT_CUSTOM_PROPERTIES },
};
