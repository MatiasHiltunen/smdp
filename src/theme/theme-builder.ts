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
  | 'codeRx';

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
};

const DEFAULT_TOKENS: ThemeTokens = {
  bgBase: '#050b18',
  bgGlass: 'rgba(15, 23, 42, 0.64)',
  bgGlassStrong: 'rgba(15, 23, 42, 0.82)',
  bgPanel: 'rgba(15, 23, 42, 0.78)',
  borderGlass: 'rgba(148, 163, 184, 0.22)',
  borderStrong: 'rgba(148, 163, 184, 0.35)',
  textPrimary: '#f8fafc',
  textSecondary: 'rgba(226, 232, 240, 0.75)',
  accent: '#38bdf8',
  accentStrong: '#0ea5e9',
  shadowSoft: '0 24px 80px rgba(15, 23, 42, 0.55)',
  shadowButton: '0 18px 40px rgba(14, 165, 233, 0.25)',
  radiusLg: '28px',
  radiusMd: '18px',
  radiusSm: '10px',
  codeKw: '#38bdf8',
  codeId: 'rgba(248, 250, 252, 0.92)',
  codeNum: '#facc15',
  codeStr: '#4ade80',
  codeTpl: '#22d3ee',
  codeCom: 'rgba(148, 163, 184, 0.65)',
  codeOp: '#f472b6',
  codePunc: 'rgba(226, 232, 240, 0.7)',
  codeRx: '#f97316',
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
  '--bg-glow-a': 'rgba(56, 189, 248, 0.12)',
  '--bg-glow-b': 'rgba(94, 234, 212, 0.12)',
  '--blockquote-border': 'rgba(94, 234, 212, 0.3)',
  '--blockquote-bg': 'rgba(45, 212, 191, 0.06)',
  '--blockquote-text': 'rgba(226, 232, 240, 0.85)',
  '--blockquote-accent': 'rgba(94, 234, 212, 0.4)',
};

const LIGHT_TOKENS: ThemeTokens = {
  bgBase: '#f7f9fc',
  bgGlass: 'rgba(255, 255, 255, 0.86)',
  bgGlassStrong: 'rgba(255, 255, 255, 0.95)',
  bgPanel: 'rgba(255, 255, 255, 0.92)',
  borderGlass: 'rgba(148, 163, 184, 0.28)',
  borderStrong: 'rgba(100, 116, 139, 0.35)',
  textPrimary: '#1e293b',
  textSecondary: 'rgba(30, 41, 59, 0.75)',
  accent: '#2563eb',
  accentStrong: '#1d4ed8',
  shadowSoft: '0 18px 48px rgba(15, 23, 42, 0.15)',
  shadowButton: '0 16px 30px rgba(37, 99, 235, 0.25)',
  radiusLg: '28px',
  radiusMd: '18px',
  radiusSm: '10px',
  codeKw: '#2563eb',
  codeId: 'rgba(30, 41, 59, 0.92)',
  codeNum: '#ca8a04',
  codeStr: '#15803d',
  codeTpl: '#0d9488',
  codeCom: 'rgba(71, 85, 105, 0.72)',
  codeOp: '#9333ea',
  codePunc: 'rgba(51, 65, 85, 0.75)',
  codeRx: '#c2410c',
};

const LIGHT_META: ThemeMeta = {
  ...DEFAULT_META,
  colorScheme: 'light',
};

const LIGHT_CUSTOM_PROPERTIES: Record<string, string> = {
  '--bg-glow-a': 'rgba(37, 99, 235, 0.18)',
  '--bg-glow-b': 'rgba(14, 165, 233, 0.14)',
  '--blockquote-border': 'rgba(59, 130, 246, 0.45)',
  '--blockquote-bg': 'rgba(59, 130, 246, 0.12)',
  '--blockquote-text': 'rgba(30, 41, 59, 0.85)',
  '--blockquote-accent': 'rgba(37, 99, 235, 0.55)',
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
