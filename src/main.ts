import { MDParser, u8 } from "./parser";
import { createThemeBuilder, defaultTheme, lightTheme } from "./theme";
import { initializeThemeEditor, loadThemeFromUrl, type ThemeEditorHandle } from "./theme/theme-editor";
import "./style.css";

const themeBuilder = createThemeBuilder();

let themeEditorHandle: ThemeEditorHandle | null = null;
let themeEditorViewListenerAttached = false;

const parser = new MDParser({
  // Security: disable raw HTML blocks by default
  allowRawHtml: false,
});

const createElement = <T extends keyof HTMLElementTagNameMap>(tag: T) =>
  document.createElement(tag) as HTMLElementTagNameMap[T];

function ensureThemeEditor(): ThemeEditorHandle {
  if (!themeEditorHandle) {
    themeEditorHandle = initializeThemeEditor(themeBuilder);
  }
  return themeEditorHandle;
}


function getCurrentTheme(): "light" | "dark" {
  if (typeof window === "undefined") {
    return "dark";
  }
  try {
    const stored = window.localStorage?.getItem("smdp-theme");
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // ignore storage errors (private mode, etc.)
  }
  const prefersLight = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches;
  return prefersLight ? "light" : "dark";
}

function applyTheme(theme: "light" | "dark", preserveCustomizations: boolean = false): void {
  const config = theme === "light" ? lightTheme : defaultTheme;
  
  if (preserveCustomizations) {
    // Only update theme-specific meta, keep existing tokens
    themeBuilder
      .withMeta({ colorScheme: config.meta.colorScheme })
      .apply();
  } else {
    // Full theme replacement (initial load)
    themeBuilder
      .withMeta(config.meta)
      .withTokens(config.tokens)
      .withCustomProperties(config.customProperties)
      .apply();
  }
  
  document.documentElement.setAttribute("data-theme", theme);
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("smdp-theme", theme);
    }
  } catch {
    // ignore storage errors
  }
  themeEditorHandle?.refresh();
}


type RenderMode = "html" | "canvas";

type RouteDetails = {
  mode: RenderMode;
  externalUrl: URL | null;
};

function safeParseUrl(value: string | null): URL | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch (error) {
    console.error("Unable to parse external markdown URL", error);
    return null;
  }
}

function parseRoute(): RouteDetails {
  const rawPath = decodeURIComponent(window.location.pathname);

  if (rawPath.startsWith("/canvas/")) {
    const externalPart = rawPath.slice("/canvas/".length);
    return {
      mode: "canvas",
      externalUrl: safeParseUrl(externalPart || null),
    };
  }

  if (rawPath === "/canvas") {
    return {
      mode: "canvas",
      externalUrl: null,
    };
  }

  if (rawPath.startsWith("/html/")) {
    const externalPart = rawPath.slice("/html/".length);
    return {
      mode: "html",
      externalUrl: safeParseUrl(externalPart || null),
    };
  }

  if (rawPath === "/html") {
    return {
      mode: "html",
      externalUrl: null,
    };
  }

  if (rawPath === "/" || rawPath === "") {
    return {
      mode: "html",
      externalUrl: null,
    };
  }

  const externalPart = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
  return {
    mode: "html",
    externalUrl: safeParseUrl(externalPart || null),
  };
}

type MarkdownFetchResult = {
  bytes: Uint8Array;
  baseUrl: string;
};

async function fetchMarkdown(externalUrl: URL | null): Promise<MarkdownFetchResult> {
  const target = externalUrl?.toString() ?? "/test.md";
  const response = await fetch(target);

  if (!response.ok) {
    throw new Error(`Failed to fetch markdown: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const baseUrl = externalUrl?.toString() ?? new URL(target, window.location.href).toString();
  return { bytes, baseUrl };
}

type BaseView = {
  shell: HTMLElement;
  textarea: HTMLTextAreaElement;
  editorPane: HTMLElement;
};

type HtmlView = BaseView & {
  viewer: HTMLElement;
};

type CanvasView = BaseView & {
  canvas: HTMLCanvasElement;
};


/**
 * Export the rendered HTML as a self-contained HTML5 file
 */
function exportAsHtml(view: HtmlView | CanvasView): void {
  const viewer = view.shell.querySelector('.markdown-viewer');
  if (!viewer) {
    alert('No rendered content to export');
    return;
  }

  // Get all styles from the document
  const styles = Array.from(document.styleSheets)
    .map(sheet => {
      try {
        return Array.from(sheet.cssRules)
          .map(rule => rule.cssText)
          .join('\n');
      } catch (e) {
        // Can't access cross-origin stylesheets
        return '';
      }
    })
    .join('\n');

  // Get current theme attribute
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  
  // Parse URL parameters to extract mode-specific customizations
  const params = new URLSearchParams(window.location.search);
  const darkCustomProps: string[] = [];
  const lightCustomProps: string[] = [];
  
  // Helper to convert theme params to CSS properties
  const convertParamsToCss = (prefix: string, targetArray: string[]) => {
    const meta: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    const customs: Record<string, string> = {};
    
    params.forEach((value, key) => {
      if (key.startsWith(`${prefix}m_`)) {
        const metaKey = key.slice(prefix.length + 2);
        meta[metaKey] = value;
      } else if (key.startsWith(`${prefix}t_`)) {
        const tokenKey = key.slice(prefix.length + 2);
        tokens[tokenKey] = value;
      } else if (key.startsWith(`${prefix}c_`)) {
        const propKey = `--${key.slice(prefix.length + 2)}`;
        customs[propKey] = value;
      }
    });
    
    // Add meta properties
    if (meta.fontFamily) targetArray.push(`  font-family: ${meta.fontFamily};`);
    if (meta.fontSize) targetArray.push(`  font-size: ${meta.fontSize};`);
    if (meta.fontWeight) targetArray.push(`  font-weight: ${meta.fontWeight};`);
    if (meta.lineHeight) targetArray.push(`  line-height: ${meta.lineHeight};`);
    if (meta.monoFontFamily) targetArray.push(`  --font-mono: ${meta.monoFontFamily};`);
    
    // Add token properties (converted to CSS variables)
    Object.entries(tokens).forEach(([key, value]) => {
      // Convert camelCase token names to kebab-case CSS variable names
      const cssVarName = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
      targetArray.push(`  ${cssVarName}: ${value};`);
    });
    
    // Add custom properties
    Object.entries(customs).forEach(([key, value]) => {
      targetArray.push(`  ${key}: ${value};`);
    });
  };
  
  // Extract dark mode customizations
  convertParamsToCss('d_', darkCustomProps);
  
  // Extract light mode customizations
  convertParamsToCss('l_', lightCustomProps);
  
  // Build theme override styles
  let themeOverrides = '';
  
  if (darkCustomProps.length > 0) {
    themeOverrides += `\n:root, :root[data-theme="dark"] {\n${darkCustomProps.join('\n')}\n}`;
  }
  
  if (lightCustomProps.length > 0) {
    themeOverrides += `\n:root[data-theme="light"] {\n${lightCustomProps.join('\n')}\n}`;
  }

  // Create HTML5 document
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="${currentTheme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="SMDP - Simple Markdown Parser">
  <title>Exported Markdown</title>
  <style>
${styles}${themeOverrides}
  </style>
</head>
<body>
  <div class="app-shell">
    <div class="viewer-pane">
      <article class="markdown-viewer">
${viewer.innerHTML}
      </article>
    </div>
  </div>
</body>
</html>`;

  // Create blob and download
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = createElement('a');
  a.href = url;
  a.download = `markdown-export-${Date.now()}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Create a FAB menu with all actions
 */
function createFabMenu(
  view: HtmlView | CanvasView,
  themeEditor: ThemeEditorHandle,
  onToggleEditor?: () => void
): HTMLElement {
  const menu = createElement('div');
  menu.className = 'fab-menu';

  // Main FAB button (plus icon)
  const mainButton = createElement('button');
  mainButton.className = 'fab-main';
  mainButton.type = 'button';
  mainButton.title = 'Menu';
  mainButton.ariaLabel = 'Toggle menu';
  mainButton.setAttribute('aria-expanded', 'false');
  mainButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1Z" fill="currentColor"/>
    </svg>
  `;

  // Actions container
  const actions = createElement('div');
  actions.className = 'fab-actions';

  // Edit button
  const editButton = createElement('button');
  editButton.className = 'fab-action';
  editButton.type = 'button';
  editButton.setAttribute('data-tooltip', 'Edit Markdown');
  editButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M4.5 20a.5.5 0 0 1-.5-.5v-3.086a1 1 0 0 1 .293-.707L14.586 5.414a2 2 0 0 1 2.828 0l1.172 1.172a2 2 0 0 1 0 2.828L8.293 20.293a1 1 0 0 1-.707.293H4.5Zm12.379-13.207a.5.5 0 0 0-.707 0L6 16.964V19h2.036l10.172-10.172a.5.5 0 0 0 0-.707l-1.329-1.328Z" fill="currentColor"/>
    </svg>
  `;

  // Theme editor button
  const themeButton = createElement('button');
  themeButton.className = 'fab-action';
  themeButton.type = 'button';
  themeButton.setAttribute('data-tooltip', 'Theme Editor');
  themeButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9Zm0 2a7 7 0 0 0-7 7 7 7 0 0 0 7 7V5Z" fill="currentColor"/>
    </svg>
  `;

  // Light/Dark theme toggle button
  const themeToggleButton = createElement('button');
  themeToggleButton.className = 'fab-action';
  themeToggleButton.type = 'button';
  
  // Function to update theme toggle icon
  const updateThemeIcon = (theme: 'light' | 'dark') => {
    themeToggleButton.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      // Show sun icon (click to go light)
      themeToggleButton.setAttribute('data-tooltip', 'Switch to Light Mode');
      themeToggleButton.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
          <path d="M12 2a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 17a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm9-8a1 1 0 0 1 0 2h-1a1 1 0 1 1 0-2h1ZM4 11a1 1 0 1 0 0 2H3a1 1 0 1 0 0-2h1Zm14.071-5.071a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0ZM8.05 15.95a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0Zm9.9 0a1 1 0 0 1 1.414 0l.707.707a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 0 1 0-1.414ZM8.05 5.93a1 1 0 0 0-1.414 0l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707a1 1 0 0 0 0-1.414ZM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-7 5a7 7 0 1 1 14 0 7 7 0 0 1-14 0Z" fill="currentColor"/>
        </svg>
      `;
    } else {
      // Show moon icon (click to go dark)
      themeToggleButton.setAttribute('data-tooltip', 'Switch to Dark Mode');
      themeToggleButton.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
          <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1Z" fill="currentColor"/>
        </svg>
      `;
    }
  };
  
  // Initialize with current theme
  updateThemeIcon(getCurrentTheme());

  // Export HTML button
  const exportButton = createElement('button');
  exportButton.className = 'fab-action';
  exportButton.type = 'button';
  exportButton.setAttribute('data-tooltip', 'Export as HTML');
  exportButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M13 3a1 1 0 1 0-2 0v12.586l-3.293-3.293a1 1 0 0 0-1.414 1.414l5 5a1 1 0 0 0 1.414 0l5-5a1 1 0 0 0-1.414-1.414L13 15.586V3ZM4 17a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4Z" fill="currentColor"/>
    </svg>
  `;

  // Event handlers
  let isMenuOpen = false;

  mainButton.addEventListener('click', () => {
    isMenuOpen = !isMenuOpen;
    menu.classList.toggle('is-open', isMenuOpen);
    mainButton.setAttribute('aria-expanded', String(isMenuOpen));
  });

  editButton.addEventListener('click', () => {
    onToggleEditor?.();
    isMenuOpen = false;
    menu.classList.remove('is-open');
    mainButton.setAttribute('aria-expanded', 'false');
  });

  themeButton.addEventListener('click', () => {
    themeEditor.toggle();
    isMenuOpen = false;
    menu.classList.remove('is-open');
    mainButton.setAttribute('aria-expanded', 'false');
  });

  themeToggleButton.addEventListener('click', () => {
    const current = getCurrentTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next, false); // Apply new theme defaults
    // Reload customizations from URL if present
    const hasUrlTheme = loadThemeFromUrl(themeBuilder);
    if (hasUrlTheme) {
      themeBuilder.apply();
      themeEditorHandle?.refresh();
    }
    updateThemeIcon(next);
    isMenuOpen = false;
    menu.classList.remove('is-open');
    mainButton.setAttribute('aria-expanded', 'false');
  });

  exportButton.addEventListener('click', () => {
    exportAsHtml(view);
    isMenuOpen = false;
    menu.classList.remove('is-open');
    mainButton.setAttribute('aria-expanded', 'false');
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (isMenuOpen && !menu.contains(e.target as Node)) {
      isMenuOpen = false;
      menu.classList.remove('is-open');
      mainButton.setAttribute('aria-expanded', 'false');
    }
  });

  actions.append(editButton, themeButton, themeToggleButton, exportButton);
  menu.append(mainButton, actions);

  return menu;
}

function createHtmlView(): HtmlView {
  const shell = createElement("div");
  shell.className = "app-shell mode-html";

  const viewerPane = createElement("div");
  viewerPane.className = "viewer-pane";

  const viewer = createElement("article");
  viewer.className = "markdown-viewer";
  viewer.id = "markdown-view";

  const editorPane = createElement("section");
  editorPane.className = "editor-pane";
  editorPane.id = "markdown-editor-pane";
  editorPane.setAttribute("aria-hidden", "true");

  const textarea = createElement("textarea");
  textarea.className = "editor";
  textarea.spellcheck = false;
  textarea.id = "markdown-editor-input";
  textarea.autocomplete = "off";
  textarea.setAttribute("aria-label", "Markdown source");

  editorPane.appendChild(textarea);
  viewerPane.appendChild(viewer);

  shell.append(viewerPane, editorPane);

  return {
    shell,
    textarea,
    editorPane,
    viewer,
  };
}

function createCanvasView(): CanvasView {
  const shell = createElement("div");
  shell.className = "app-shell mode-canvas";

  const canvasPane = createElement("div");
  canvasPane.className = "canvas-pane";

  const canvasScroll = createElement("div");
  canvasScroll.className = "canvas-scroll";

  const canvas = createElement("canvas");
  canvas.className = "md-canvas";

  const canvasSpacer = createElement("div");
  canvasSpacer.id = "canvas-spacer";
  canvasSpacer.setAttribute("aria-hidden", "true");

  const editorPane = createElement("section");
  editorPane.className = "editor-pane";
  editorPane.id = "markdown-editor-pane";
  editorPane.setAttribute("aria-hidden", "true");

  const textarea = createElement("textarea");
  textarea.className = "editor";
  textarea.spellcheck = false;
  textarea.id = "markdown-editor-input";
  textarea.autocomplete = "off";
  textarea.setAttribute("aria-label", "Markdown source");

  editorPane.appendChild(textarea);
  canvasScroll.append(canvas, canvasSpacer);
  canvasPane.appendChild(canvasScroll);

  shell.append(canvasPane, editorPane);

  return {
    shell,
    textarea,
    editorPane,
    canvas,
  };
}

async function applyMarkdownToHtml(view: HtmlView, bytes: Uint8Array, baseUrl?: string): Promise<void> {
  const overrides = baseUrl ? { baseUrl } : undefined;
  const html = await parser.parse(bytes, overrides);
  view.viewer.innerHTML = html;
}

function applyMarkdownToCanvas(view: CanvasView, bytes: Uint8Array, baseUrl?: string): void {
  const overrides = baseUrl ? { baseUrl } : undefined;
  parser.renderToCanvas(bytes, view.canvas, overrides);
}


function enableRealtimeUpdates(
  view: HtmlView | CanvasView,
  apply: (bytes: Uint8Array, baseUrl?: string) => Promise<void>,
  resolveBaseUrl: () => string | undefined
): void {
  view.textarea.addEventListener("input", (event) => {
    const value = (event.target as HTMLTextAreaElement).value;
    const bytes = u8(value);
    const baseUrl = resolveBaseUrl();
    void apply(bytes, baseUrl).catch((error) => {
      console.error("Failed to update preview", error);
    });
  });
}

function displayError(message: string): void {
  const alert = createElement("div");
  alert.className = "error-banner";
  alert.role = "alert";
  alert.setAttribute("aria-live", "polite");
  alert.textContent = message;
  document.body.appendChild(alert);
}

async function init(): Promise<void> {
  document.body.classList.add("hydrating");

  const initialTheme = getCurrentTheme();
  applyTheme(initialTheme);

  const route = parseRoute();

  let view: HtmlView | CanvasView;
  let apply: (bytes: Uint8Array, baseUrl?: string) => Promise<void>;

  if (route.mode === "canvas") {
    const canvasView = createCanvasView();
    view = canvasView;
    apply = async (bytes, baseUrl) => {
      applyMarkdownToCanvas(canvasView, bytes, baseUrl);
    };
  } else {
    const htmlView = createHtmlView();
    view = htmlView;
    apply = (bytes, baseUrl) => applyMarkdownToHtml(htmlView, bytes, baseUrl);
  }

  document.body.classList.remove("is-editing");
  document.body.replaceChildren(view.shell);
  const themeEditor = ensureThemeEditor();
  document.body.appendChild(themeEditor.root);
  
  // Create FAB menu with editor toggle callback
  const fabMenu = createFabMenu(view, themeEditor, () => {
    const isEditing = document.body.classList.toggle("is-editing");
    view.shell.classList.toggle("show-editor", isEditing);
    view.editorPane.setAttribute("aria-hidden", String(!isEditing));
    view.editorPane.toggleAttribute("inert", !isEditing);
    if (isEditing) {
      view.textarea.focus();
      themeEditor.close();
    }
  });
  document.body.appendChild(fabMenu);
  
  // Theme editor already loaded from URL, no need to reapply

  if (!themeEditorViewListenerAttached) {
    themeEditor.root.addEventListener("theme-editor-toggle", (event) => {
      const open = (event as CustomEvent<{ open: boolean }>).detail.open;
      if (open) {
        document.body.classList.remove("is-editing");
        view.shell.classList.remove("show-editor");
      }
    });
    themeEditorViewListenerAttached = true;
  }

  let resolved: MarkdownFetchResult | null = null;
  let resolvedText: string | null = null;
  let currentBaseUrl: string | undefined;

  try {
    resolved = await fetchMarkdown(route.externalUrl);
    resolvedText = new TextDecoder().decode(resolved.bytes);
  } catch (error) {
    console.error(error);
    displayError(error instanceof Error ? error.message : "Unable to load markdown");
    if (route.externalUrl) {
      try {
        resolved = await fetchMarkdown(null);
        resolvedText = new TextDecoder().decode(resolved.bytes);
      } catch (fallbackError) {
        console.error("Unable to load fallback markdown", fallbackError);
      }
    }
  } finally {
    document.body.classList.remove("hydrating");
  }

  if (resolvedText !== null) {
    view.textarea.value = resolvedText;
  } else {
    view.textarea.value = "";
  }

  if (resolved) {
    currentBaseUrl = resolved.baseUrl;
    await apply(resolved.bytes, currentBaseUrl);
  }

  enableRealtimeUpdates(view, apply, () => currentBaseUrl);
}

void init();
