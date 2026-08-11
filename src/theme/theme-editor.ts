import {
  ThemeBuilder,
  type ThemeTokenKey,
  type ThemeMeta,
  defaultTheme,
} from './theme-builder';
import { serializeTheme } from './theme-serializer';
import { loadThemeFromUrl } from './theme-url';
import { emitThemeChange } from '../client/theme-events';
import { replaceWithIcon } from '../client/dom';
import {
  applyBackgroundMode,
  applyFrameMode,
  getBackgroundModeFromSearch,
  getFrameModeFromSearch,
  parseBackgroundMode,
  parseFrameMode,
  saveBackgroundModeToUrl,
  saveFrameModeToUrl,
} from '../client/frame-mode';

export type ThemeEditorHandle = {
  root: HTMLElement;
  open(): void;
  close(): void;
  toggle(force?: boolean): boolean;
  isOpen(): boolean;
  refresh(): void;
};

type MetaField = {
  key: keyof ThemeMeta;
  label: string;
  placeholder?: string;
};

type TokenField = {
  key: ThemeTokenKey;
  label: string;
};

type CustomField = {
  key: string;
  label: string;
  placeholder?: string;
};

const META_FIELDS: readonly MetaField[] = [
  { key: 'colorScheme', label: 'Color scheme', placeholder: 'dark | light' },
  { key: 'fontFamily', label: 'Font family' },
  { key: 'monoFontFamily', label: 'Mono font family' },
  { key: 'fontSize', label: 'Font size' },
  { key: 'fontWeight', label: 'Font weight' },
  { key: 'lineHeight', label: 'Line height' },
] as const;

const CUSTOM_LAYOUT_FIELDS: readonly CustomField[] = [
  {
    key: '--viewer-padding-inline',
    label: 'Viewer padding (inline)',
    placeholder: 'e.g. clamp(1rem, 2vw, 1.5rem)',
  },
  {
    key: '--viewer-padding-block',
    label: 'Viewer padding (block)',
    placeholder: 'e.g. clamp(1rem, 2vw, 1.5rem)',
  },
  {
    key: '--viewer-margin-block',
    label: 'Viewer margin (block)',
    placeholder: 'e.g. clamp(1.5rem, 4vw, 2.5rem)',
  },
] as const;

const FONT_FAMILIES = [
  '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif', // Default
  '"Inter", system-ui, -apple-system, sans-serif',
  '"Segoe UI", system-ui, -apple-system, sans-serif',
  'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  '"Helvetica Neue", Helvetica, Arial, sans-serif',
  'Georgia, "Times New Roman", Times, serif',
  '"Arial", Helvetica, sans-serif',
  'Verdana, Geneva, Tahoma, sans-serif',
  '"Trebuchet MS", sans-serif',
] as const;

const MONO_FONT_FAMILIES = [
  '"JetBrains Mono", "SFMono-Regular", ui-monospace, monospace',
  '"Fira Code", "SF Mono", Monaco, monospace',
  '"Source Code Pro", "Courier New", monospace',
  '"Consolas", "Monaco", "Andale Mono", monospace',
  '"SF Mono", "Monaco", "Inconsolata", monospace',
  'ui-monospace, "Cascadia Code", monospace',
  'Menlo, Monaco, "Courier New", monospace',
] as const;

const FONT_SIZES = ['12px', '13px', '14px', '15px', '16px', '17px', '18px', '20px', '22px'] as const;

const FONT_WEIGHTS = ['300', '400', '500', '600', '700'] as const;

const LINE_HEIGHTS = ['1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '2.0'] as const;

const FRAME_MODES = ['full', 'minimal', 'none'] as const;
const BACKGROUND_MODES = ['full', 'soft', 'none'] as const;
const CLOSE_ICON_PATH =
  "M17.53 6.47a.75.75 0 0 0-1.06 0L12 10.94 7.53 6.47a.75.75 0 0 0-1.06 1.06L10.94 12l-4.47 4.47a.75.75 0 0 0 1.06 1.06L12 13.06l4.47 4.47a.75.75 0 0 0 1.06-1.06L13.06 12l4.47-4.47a.75.75 0 0 0 0-1.06Z";

const TOKEN_GROUPS: ReadonlyArray<{ title: string; fields: readonly TokenField[] }> = [
  {
    title: 'Background & Surfaces',
    fields: [
      { key: 'bgBase', label: 'Base background' },
      { key: 'bgGlass', label: 'Glass background' },
      { key: 'bgGlassStrong', label: 'Glass background (strong)' },
      { key: 'bgPanel', label: 'Panel background' },
    ],
  },
  {
    title: 'Borders & Depth',
    fields: [
      { key: 'borderGlass', label: 'Glass border' },
      { key: 'borderStrong', label: 'Strong border' },
      { key: 'shadowSoft', label: 'Soft shadow' },
      { key: 'shadowButton', label: 'Button shadow' },
    ],
  },
  {
    title: 'Typography & Accent',
    fields: [
      { key: 'textPrimary', label: 'Primary text' },
      { key: 'textSecondary', label: 'Secondary text' },
      { key: 'accent', label: 'Accent' },
      { key: 'accentStrong', label: 'Accent (strong)' },
    ],
  },
  {
    title: 'Radius',
    fields: [
      { key: 'radiusLg', label: 'Large radius' },
      { key: 'radiusMd', label: 'Medium radius' },
      { key: 'radiusSm', label: 'Small radius' },
    ],
  },
  {
    title: 'Blockquote',
    fields: [
      { key: 'blockquoteBorder', label: 'Border' },
      { key: 'blockquoteBg', label: 'Background' },
      { key: 'blockquoteText', label: 'Text' },
      { key: 'blockquoteAccent', label: 'Accent' },
    ],
  },
  {
    title: 'Info Blocks',
    fields: [
      { key: 'infoBorder', label: 'Info border' },
      { key: 'infoBg', label: 'Info background' },
      { key: 'warningBorder', label: 'Warning border' },
      { key: 'warningBg', label: 'Warning background' },
      { key: 'errorBorder', label: 'Error border' },
      { key: 'errorBg', label: 'Error background' },
      { key: 'successBorder', label: 'Success border' },
      { key: 'successBg', label: 'Success background' },
    ],
  },
  {
    title: 'Code Highlighting',
    fields: [
      { key: 'codeKw', label: 'Keyword' },
      { key: 'codeId', label: 'Identifier' },
      { key: 'codeNum', label: 'Number' },
      { key: 'codeStr', label: 'String' },
      { key: 'codeTpl', label: 'Template literal' },
      { key: 'codeCom', label: 'Comment' },
      { key: 'codeOp', label: 'Operator' },
      { key: 'codePunc', label: 'Punctuation' },
      { key: 'codeRx', label: 'Regular expression' },
    ],
  },
] as const;

/**
 * Save theme configuration to URL search parameters using compact serialization
 */
function saveThemeToUrl(builder: ThemeBuilder): void {
  const config = builder.build();
  const params = new URLSearchParams(window.location.search);
  
  // Determine current theme mode
  const currentMode = (document.documentElement.getAttribute('data-theme') || 'dark') as 'light' | 'dark';
  const modeKey = currentMode === 'light' ? 'l' : 'd';
  
  // Remove existing theme param for current mode
  params.delete(modeKey);
  
  // Serialize theme using compact format (only diffs from default)
  const serialized = serializeTheme(config, currentMode);
  
  // Only add param if there are customizations
  if (serialized) {
    params.set(modeKey, serialized);
  }
  
  // Update URL without reload
  const newUrl = params.toString() 
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  window.history.replaceState({}, '', newUrl);
}

/**
 * Check if a field key represents a color value
 */
function isColorField(key: string): boolean {
  return key.startsWith('bg') || 
         key.startsWith('text') || 
         key.startsWith('accent') || 
         key.startsWith('border') ||
         key.startsWith('code') ||
         key.startsWith('blockquote') ||
         key.startsWith('info') ||
         key.startsWith('warning') ||
         key.startsWith('error') ||
         key.startsWith('success');
}

/**
 * Convert rgba/rgb/hex color to hex format for color picker
 */
function toHexColor(value: string): string {
  // Already hex
  if (value.startsWith('#')) {
    return value.slice(0, 7); // Remove alpha if present
  }
  
  // Parse rgba/rgb
  const rgbaMatch = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
  if (rgbaMatch) {
    const [, r, g, b] = rgbaMatch;
    const hex = '#' + [r, g, b].map(n => {
      const val = parseInt(n, 10);
      return val.toString(16).padStart(2, '0');
    }).join('');
    return hex;
  }
  
  return '#000000'; // fallback
}

function createInputField(
  labelText: string,
  id: string,
  key: string,
  fieldOptions?: { placeholder?: string },
): { field: HTMLDivElement; input: HTMLInputElement | HTMLSelectElement; textInput?: HTMLInputElement } {
  const field = document.createElement('div');
  field.className = 'theme-editor-field';

  const label = document.createElement('label');
  label.className = 'theme-editor-label';
  label.htmlFor = id;
  label.textContent = labelText;

  const isColor = isColorField(key);

  // Handle select fields for fonts and specific properties
  let choices: readonly string[] | null = null;
  if (key === 'fontFamily') choices = FONT_FAMILIES;
  else if (key === 'monoFontFamily') choices = MONO_FONT_FAMILIES;
  else if (key === 'fontSize') choices = FONT_SIZES;
  else if (key === 'fontWeight') choices = FONT_WEIGHTS;
  else if (key === 'lineHeight') choices = LINE_HEIGHTS;
  else if (key === 'frameMode') choices = FRAME_MODES;
  else if (key === 'backgroundMode') choices = BACKGROUND_MODES;

  if (choices) {
    const select = document.createElement('select');
    select.className = 'theme-editor-input';
    select.id = id;

    for (const option of choices) {
      const opt = document.createElement('option');
      opt.value = option;
      if (key === 'frameMode' || key === 'backgroundMode') {
        opt.textContent = option.charAt(0).toUpperCase() + option.slice(1);
      } else {
        opt.textContent = option;
      }
      select.appendChild(opt);
    }

    if (fieldOptions?.placeholder) {
      select.setAttribute('data-placeholder', fieldOptions.placeholder);
    }
    field.append(label, select);
    return { field, input: select };
  }

  const input = document.createElement('input');
  input.className = 'theme-editor-input';
  input.id = id;
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (fieldOptions?.placeholder) {
    input.placeholder = fieldOptions.placeholder;
  }

  if (isColor) {
    // Create a wrapper for color picker + text input
    const inputWrapper = document.createElement('div');
    inputWrapper.style.display = 'flex';
    inputWrapper.style.gap = '0.5rem';
    
    // Color picker
    input.type = 'color';
    input.style.width = '3rem';
    input.style.height = '2.25rem';
    input.style.padding = '0.25rem';
    input.style.cursor = 'pointer';
    
    // Text input for manual editing
    const textInput = document.createElement('input');
    textInput.className = 'theme-editor-input';
    textInput.type = 'text';
    textInput.style.flex = '1';
    textInput.autocomplete = 'off';
    textInput.spellcheck = false;
    textInput.placeholder = fieldOptions?.placeholder ?? 'Color value';

    inputWrapper.append(input, textInput);
    field.append(label, inputWrapper);
    return { field, input, textInput };
  } else {
    input.type = 'text';
    field.append(label, input);
    return { field, input };
  }
}

export function initializeThemeEditor(
  builder: ThemeBuilder,
  options: { loadFromUrl?: boolean } = {},
): ThemeEditorHandle {
  // Load theme from URL if present unless caller already applied URL overrides.
  const shouldLoadFromUrl = options.loadFromUrl !== false;
  const hasUrlTheme = shouldLoadFromUrl && loadThemeFromUrl(builder);
  if (hasUrlTheme) {
    builder.apply();
    emitThemeChange('url');
  }
  
  const wrapper = document.createElement('div');
  wrapper.className = 'theme-editor-wrapper';
  wrapper.setAttribute('aria-hidden', 'true');

  const overlay = document.createElement('div');
  overlay.className = 'theme-editor-overlay';

  const panel = document.createElement('aside');
  panel.className = 'theme-editor-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const panelId = 'theme-editor-panel';
  panel.id = panelId;
  panel.tabIndex = -1;

  const title = document.createElement('h2');
  title.className = 'theme-editor-title';
  title.id = 'theme-editor-title';
  title.textContent = 'Theme editor';
  panel.setAttribute('aria-labelledby', title.id);

  const closeButton = document.createElement('button');
  closeButton.className = 'theme-editor-close';
  closeButton.type = 'button';
  closeButton.title = 'Close theme editor';
  closeButton.setAttribute('aria-label', 'Close theme editor');
  replaceWithIcon(closeButton, CLOSE_ICON_PATH, { className: '' });

  const header = document.createElement('header');
  header.className = 'theme-editor-header';
  header.append(title, closeButton);

  const content = document.createElement('div');
  content.className = 'theme-editor-content';

  const metaSection = document.createElement('section');
  metaSection.className = 'theme-editor-section';

  const metaHeading = document.createElement('h3');
  metaHeading.className = 'theme-editor-section-title';
  metaHeading.textContent = 'Base settings';

  const metaFieldsContainer = document.createElement('div');
  metaFieldsContainer.className = 'theme-editor-fields';

  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const textInputs = new Map<string, HTMLInputElement>();

  META_FIELDS.forEach((fieldDef) => {
    const fieldId = `theme-meta-${fieldDef.key}`;
    const placeholderOptions = fieldDef.placeholder
      ? { placeholder: fieldDef.placeholder }
      : undefined;
    const { field, input, textInput } = createInputField(fieldDef.label, fieldId, fieldDef.key, placeholderOptions);
    input.dataset.section = 'meta';
    input.dataset.key = fieldDef.key;
    metaFieldsContainer.append(field);
    inputs.set(`meta:${fieldDef.key}`, input);
    if (textInput) {
      textInput.dataset.section = 'meta';
      textInput.dataset.key = fieldDef.key;
      textInputs.set(`meta:${fieldDef.key}`, textInput);
    }
  });

  metaSection.append(metaHeading, metaFieldsContainer);

  const viewerSection = document.createElement('section');
  viewerSection.className = 'theme-editor-section';

  const viewerHeading = document.createElement('h3');
  viewerHeading.className = 'theme-editor-section-title';
  viewerHeading.textContent = 'Viewer';

  const viewerFieldsContainer = document.createElement('div');
  viewerFieldsContainer.className = 'theme-editor-fields';

  const frameModeFieldId = 'theme-viewer-frame-mode';
  const { field: frameModeField, input: frameModeInput } = createInputField(
    'Frame mode',
    frameModeFieldId,
    'frameMode',
  );
  frameModeInput.dataset.section = 'viewer';
  frameModeInput.dataset.key = 'frameMode';
  viewerFieldsContainer.append(frameModeField);
  inputs.set('viewer:frameMode', frameModeInput);

  const backgroundModeFieldId = 'theme-viewer-background-mode';
  const { field: backgroundModeField, input: backgroundModeInput } = createInputField(
    'Background effects',
    backgroundModeFieldId,
    'backgroundMode',
  );
  backgroundModeInput.dataset.section = 'viewer';
  backgroundModeInput.dataset.key = 'backgroundMode';
  viewerFieldsContainer.append(backgroundModeField);
  inputs.set('viewer:backgroundMode', backgroundModeInput);

  viewerSection.append(viewerHeading, viewerFieldsContainer);

  const layoutSection = document.createElement('section');
  layoutSection.className = 'theme-editor-section';

  const layoutHeading = document.createElement('h3');
  layoutHeading.className = 'theme-editor-section-title';
  layoutHeading.textContent = 'Layout & spacing';

  const layoutFieldsContainer = document.createElement('div');
  layoutFieldsContainer.className = 'theme-editor-fields';

  CUSTOM_LAYOUT_FIELDS.forEach((fieldDef) => {
    const sanitizedKey = fieldDef.key.replace(/^--/, '');
    const fieldId = `theme-custom-${sanitizedKey}`;
    const placeholderOptions = fieldDef.placeholder
      ? { placeholder: fieldDef.placeholder }
      : undefined;
    const { field, input } = createInputField(fieldDef.label, fieldId, fieldDef.key, placeholderOptions);
    input.dataset.section = 'custom';
    input.dataset.key = fieldDef.key;
    layoutFieldsContainer.append(field);
    inputs.set(`custom:${fieldDef.key}`, input);
  });

  layoutSection.append(layoutHeading, layoutFieldsContainer);

  const tokenSections = TOKEN_GROUPS.map((group) => {
    const section = document.createElement('section');
    section.className = 'theme-editor-section';

    const heading = document.createElement('h3');
    heading.className = 'theme-editor-section-title';
    heading.textContent = group.title;

    const fieldsContainer = document.createElement('div');
    fieldsContainer.className = 'theme-editor-fields';

    group.fields.forEach((fieldDef) => {
      const fieldId = `theme-token-${fieldDef.key}`;
      const { field, input, textInput } = createInputField(fieldDef.label, fieldId, fieldDef.key);
      input.dataset.section = 'token';
      input.dataset.key = fieldDef.key;
      fieldsContainer.append(field);
      inputs.set(`token:${fieldDef.key}`, input);
      if (textInput) {
        textInput.dataset.section = 'token';
        textInput.dataset.key = fieldDef.key;
        textInputs.set(`token:${fieldDef.key}`, textInput);
      }
    });

    section.append(heading, fieldsContainer);
    return section;
  });

  const resetButton = document.createElement('button');
  resetButton.className = 'theme-editor-reset';
  resetButton.type = 'button';
  resetButton.textContent = 'Reset to defaults';

  const footer = document.createElement('footer');
  footer.className = 'theme-editor-footer';
  footer.append(resetButton);

  content.append(metaSection, viewerSection, layoutSection, ...tokenSections);
  panel.append(header, content, footer);
  wrapper.append(overlay, panel);

  const firstInput = inputs.values().next().value ?? null;
  const notify = (open: boolean) => {
    const event = new CustomEvent<{ open: boolean }>('theme-editor-toggle', {
      detail: { open },
    });
    wrapper.dispatchEvent(event);
  };

  let focusableElements: HTMLElement[] = [];
  let restoreFocus: HTMLElement | null = null;

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === 'Tab' && wrapper.classList.contains('is-open')) {
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }
      const current = document.activeElement as HTMLElement | null;
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        if (!current || current === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (!current || current === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  };

  const refresh = () => {
    const configuration = builder.build();
    META_FIELDS.forEach((fieldDef) => {
      const key = `meta:${fieldDef.key}`;
      const input = inputs.get(key);
      const textInput = textInputs.get(key);
      if (input) {
        const value = configuration.meta[fieldDef.key];
        if (document.activeElement !== input && document.activeElement !== textInput) {
          if (input instanceof HTMLInputElement && input.type === 'color') {
            input.value = toHexColor(value);
            if (textInput) {
              textInput.value = value;
            }
          } else {
            input.value = value;
          }
        }
      }
    });
    const viewerFrameMode = inputs.get('viewer:frameMode');
    if (viewerFrameMode && document.activeElement !== viewerFrameMode) {
      const mode = getFrameModeFromSearch(window.location.search);
      viewerFrameMode.value = mode;
    }
    const viewerBackgroundMode = inputs.get('viewer:backgroundMode');
    if (viewerBackgroundMode && document.activeElement !== viewerBackgroundMode) {
      const mode = getBackgroundModeFromSearch(window.location.search);
      viewerBackgroundMode.value = mode;
    }
    TOKEN_GROUPS.forEach((group) => {
      group.fields.forEach((fieldDef) => {
        const key = `token:${fieldDef.key}`;
        const input = inputs.get(key);
        const textInput = textInputs.get(key);
        if (input) {
          const value = configuration.tokens[fieldDef.key];
          if (document.activeElement !== input && document.activeElement !== textInput) {
            if (input instanceof HTMLInputElement && input.type === 'color') {
              input.value = toHexColor(value);
              if (textInput) {
                textInput.value = value;
              }
            } else {
              input.value = value;
            }
          }
        }
      });
    });
    CUSTOM_LAYOUT_FIELDS.forEach((fieldDef) => {
      const key = `custom:${fieldDef.key}`;
      const input = inputs.get(key);
      if (input && document.activeElement !== input) {
        const value = configuration.customProperties[fieldDef.key] ?? '';
        input.value = value;
      }
    });
  };

  const open = () => {
    if (wrapper.classList.contains('is-open')) {
      return;
    }
    refresh();
    focusableElements = Array.from(panel.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
    wrapper.classList.add('is-open');
    wrapper.setAttribute('aria-hidden', 'false');
    document.body.classList.add('show-theme-editor');
    document.addEventListener('keydown', handleKeydown);
    restoreFocus = (document.activeElement as HTMLElement) ?? null;
    queueMicrotask(() => {
      if (document.body.classList.contains('show-theme-editor')) {
        const target = focusableElements[0] ?? firstInput ?? panel;
        target.focus();
      }
    });
    notify(true);
  };

  const close = () => {
    if (!wrapper.classList.contains('is-open')) {
      return;
    }
    wrapper.classList.remove('is-open');
    wrapper.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('show-theme-editor');
    document.removeEventListener('keydown', handleKeydown);
    if (restoreFocus) {
      restoreFocus.focus({ preventScroll: true });
    }
    restoreFocus = null;
    notify(false);
  };

  const isOpen = () => wrapper.classList.contains('is-open');

  const toggle = (force?: boolean) => {
    const shouldOpen = typeof force === 'boolean' ? force : !isOpen();
    if (shouldOpen) {
      open();
    } else {
      close();
    }
    return shouldOpen;
  };

  const applyFromInput = (input: HTMLInputElement | HTMLSelectElement) => {
    const section = input.dataset.section;
    const key = input.dataset.key;
    if (!section || !key) return;
    const value = input.value;
    if (section === 'viewer' && key === 'frameMode') {
      const mode = parseFrameMode(value);
      applyFrameMode(mode);
      saveFrameModeToUrl(mode);
      emitThemeChange('editor');
      return;
    }
    if (section === 'viewer' && key === 'backgroundMode') {
      const mode = parseBackgroundMode(value);
      applyBackgroundMode(mode);
      saveBackgroundModeToUrl(mode);
      emitThemeChange('editor');
      return;
    }
    if (section === 'meta') {
      const partial: Partial<ThemeMeta> = {};
      (partial as Record<string, string>)[key] = value;
      builder.withMeta(partial);
    } else if (section === 'token') {
      builder.withToken(key as ThemeTokenKey, value);
    } else if (section === 'custom') {
      builder.withCustomProperty(key, value);
    }
    builder.apply();
    saveThemeToUrl(builder);
    emitThemeChange('editor');
  };

  // Handle color picker changes
  inputs.forEach((input, key) => {
    input.addEventListener('input', (event) => {
      const target = event.currentTarget as HTMLInputElement | HTMLSelectElement;
      if (target instanceof HTMLInputElement && target.type === 'color') {
        // Update the corresponding text input
        const textInput = textInputs.get(key);
        if (textInput) {
          textInput.value = target.value;
        }
      }
      applyFromInput(target);
    });
  });
  
  // Handle text input changes for color fields
  textInputs.forEach((textInput, key) => {
    textInput.addEventListener('input', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const colorInput = inputs.get(key);
      
      // Try to update the color picker if the value is valid
      if (colorInput) {
        try {
          const hexValue = toHexColor(target.value);
          if (hexValue !== '#000000' || target.value.includes('0')) {
            colorInput.value = hexValue;
          }
        } catch (e) {
          // Invalid color, don't update color picker
        }
      }
      
      applyFromInput(target);
    });
  });

  resetButton.addEventListener('click', () => {
    builder.withMeta(defaultTheme.meta);
    builder.withTokens(defaultTheme.tokens);
    builder.withCustomProperties(defaultTheme.customProperties);
    builder.apply();
    saveThemeToUrl(builder);
    applyBackgroundMode('full');
    saveBackgroundModeToUrl('full');
    applyFrameMode('full');
    saveFrameModeToUrl('full');
    refresh();
    emitThemeChange('reset');
  });

  closeButton.addEventListener('click', () => {
    close();
  });

  overlay.addEventListener('click', () => {
    close();
  });

  refresh();

  return {
    root: wrapper,
    open,
    close,
    toggle,
    isOpen,
    refresh,
  };
}
