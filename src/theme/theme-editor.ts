import {
  ThemeBuilder,
  type ThemeTokenKey,
  type ThemeMeta,
  defaultTheme,
} from './theme-builder';

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
};

type TokenField = {
  key: ThemeTokenKey;
  label: string;
};

const META_FIELDS: readonly MetaField[] = [
  { key: 'colorScheme', label: 'Color scheme' },
  { key: 'fontFamily', label: 'Font family' },
  { key: 'monoFontFamily', label: 'Mono font family' },
  { key: 'fontSize', label: 'Font size' },
  { key: 'fontWeight', label: 'Font weight' },
  { key: 'lineHeight', label: 'Line height' },
] as const;

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

function createInputField(labelText: string, id: string): { field: HTMLDivElement; input: HTMLInputElement } {
  const field = document.createElement('div');
  field.className = 'theme-editor-field';

  const label = document.createElement('label');
  label.className = 'theme-editor-label';
  label.htmlFor = id;
  label.textContent = labelText;

  const input = document.createElement('input');
  input.className = 'theme-editor-input';
  input.type = 'text';
  input.id = id;
  input.autocomplete = 'off';
  input.spellcheck = false;

  field.append(label, input);
  return { field, input };
}

export function initializeThemeEditor(builder: ThemeBuilder): ThemeEditorHandle {
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
  closeButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M17.53 6.47a.75.75 0 0 0-1.06 0L12 10.94 7.53 6.47a.75.75 0 0 0-1.06 1.06L10.94 12l-4.47 4.47a.75.75 0 0 0 1.06 1.06L12 13.06l4.47 4.47a.75.75 0 0 0 1.06-1.06L13.06 12l4.47-4.47a.75.75 0 0 0 0-1.06Z" fill="currentColor"/>
    </svg>
  `;

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

  const inputs = new Map<string, HTMLInputElement>();

  META_FIELDS.forEach((fieldDef, index) => {
    const fieldId = `theme-meta-${fieldDef.key}`;
    const { field, input } = createInputField(fieldDef.label, fieldId);
    input.dataset.section = 'meta';
    input.dataset.key = fieldDef.key;
    if (index === 0) {
      input.setAttribute('placeholder', 'dark | light');
    }
    metaFieldsContainer.append(field);
    inputs.set(`meta:${fieldDef.key}`, input);
  });

  metaSection.append(metaHeading, metaFieldsContainer);

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
      const { field, input } = createInputField(fieldDef.label, fieldId);
      input.dataset.section = 'token';
      input.dataset.key = fieldDef.key;
      fieldsContainer.append(field);
      inputs.set(`token:${fieldDef.key}`, input);
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

  content.append(metaSection, ...tokenSections);
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
  let previousBodyOverflow: string | null = null;

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
      const input = inputs.get(`meta:${fieldDef.key}`);
      if (input) {
        const value = configuration.meta[fieldDef.key];
        if (document.activeElement !== input) {
          input.value = value;
        }
      }
    });
    TOKEN_GROUPS.forEach((group) => {
      group.fields.forEach((fieldDef) => {
        const input = inputs.get(`token:${fieldDef.key}`);
        if (input) {
          const value = configuration.tokens[fieldDef.key];
          if (document.activeElement !== input) {
            input.value = value;
          }
        }
      });
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
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
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
    document.body.style.overflow = previousBodyOverflow ?? '';
    previousBodyOverflow = null;
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

  const applyFromInput = (input: HTMLInputElement) => {
    const section = input.dataset.section;
    const key = input.dataset.key;
    if (!section || !key) return;
    const value = input.value;
    if (section === 'meta') {
      const partial: Partial<ThemeMeta> = {};
      (partial as Record<string, string>)[key] = value;
      builder.withMeta(partial);
    } else if (section === 'token') {
      builder.withToken(key as ThemeTokenKey, value);
    }
    builder.apply();
  };

  inputs.forEach((input) => {
    input.addEventListener('input', (event) => {
      applyFromInput(event.currentTarget as HTMLInputElement);
    });
  });

  resetButton.addEventListener('click', () => {
    builder.withMeta(defaultTheme.meta);
    builder.withTokens(defaultTheme.tokens);
    builder.withCustomProperties(defaultTheme.customProperties);
    builder.apply();
    refresh();
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
