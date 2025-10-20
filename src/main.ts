import { MDParser, u8 } from "./parser";
import { createThemeBuilder, defaultTheme, lightTheme } from "./theme";
import { initializeThemeEditor, type ThemeEditorHandle } from "./theme/theme-editor";
import "./style.css";

const themeBuilder = createThemeBuilder();

let themeEditorHandle: ThemeEditorHandle | null = null;
let themeToggleButton: HTMLButtonElement | null = null;
let themeEditorButtonListenerAttached = false;
let themeEditorViewListenerAttached = false;
let themeSwitcherButton: HTMLButtonElement | null = null;

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

function ensureThemeToggleButton(): HTMLButtonElement {
  const editor = ensureThemeEditor();
  if (!themeToggleButton) {
    const panel = editor.root.querySelector<HTMLElement>('.theme-editor-panel');
    const panelId = panel?.id ?? 'theme-editor-panel';
    themeToggleButton = createThemeToggleButton(editor, panelId);
    if (!themeEditorButtonListenerAttached) {
      const updatePressed = (event: Event) => {
        const { detail } = event as CustomEvent<{ open: boolean }>;
        themeToggleButton?.setAttribute("aria-expanded", String(detail.open));
      };
      editor.root.addEventListener("theme-editor-toggle", updatePressed);
      themeEditorButtonListenerAttached = true;
    }
  }
  return themeToggleButton;
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

function applyTheme(theme: "light" | "dark"): void {
  const config = theme === "light" ? lightTheme : defaultTheme;
  themeBuilder
    .withMeta(config.meta)
    .withTokens(config.tokens)
    .withCustomProperties(config.customProperties)
    .apply();
  document.documentElement.setAttribute("data-theme", theme);
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.setItem("smdp-theme", theme);
    }
  } catch {
    // ignore storage errors
  }
  if (themeSwitcherButton) {
    themeSwitcherButton.setAttribute("aria-pressed", String(theme === "light"));
    themeSwitcherButton.setAttribute("data-theme", theme);
    const nextLabel = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
    themeSwitcherButton.title = nextLabel;
    themeSwitcherButton.ariaLabel = nextLabel;
  }
  themeEditorHandle?.refresh();
}

function createThemeSwitchButton(): HTMLButtonElement {
  const button = createElement("button");
  button.className = "floating-theme-switch";
  button.type = "button";
  button.title = "Toggle light or dark mode";
  button.ariaLabel = "Toggle light or dark mode";
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("data-theme", getCurrentTheme());
  button.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path
        d="M12 3a1 1 0 0 0 0 2 7 7 0 1 1-6.32 10.11 1 1 0 0 0-1.8.86A9 9 0 1 0 12 3Z"
        fill="currentColor"
      ></path>
    </svg>
  `;

  button.addEventListener("click", () => {
    const current = getCurrentTheme();
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
  });

  return button;
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
  fab: HTMLButtonElement;
  textarea: HTMLTextAreaElement;
  editorPane: HTMLElement;
};

type HtmlView = BaseView & {
  viewer: HTMLElement;
};

type CanvasView = BaseView & {
  canvas: HTMLCanvasElement;
};

function createFloatingButton(): HTMLButtonElement {
  const button = createElement("button");
  button.className = "floating-toggle";
  button.type = "button";
  button.title = "Edit markdown";
  button.ariaLabel = "Toggle editor";
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path
        d="M4.5 20a.5.5 0 0 1-.5-.5v-3.086a1 1 0 0 1 .293-.707L14.586 5.414a2 2 0 0 1 2.828 0l1.172 1.172a2 2 0 0 1 0 2.828L8.293 20.293a1 1 0 0 1-.707.293H4.5Zm12.379-13.207a.5.5 0 0 0-.707 0L6 16.964V19h2.036l10.172-10.172a.5.5 0 0 0 0-.707l-1.329-1.328ZM19 21H5a1 1 0 1 1 0-2h14a1 1 0 1 1 0 2Z"
        fill="currentColor"
      ></path>
    </svg>
  `;
  return button;
}

function createThemeToggleButton(editor: ThemeEditorHandle, panelId: string): HTMLButtonElement {
  const button = createElement("button");
  button.className = "floating-theme";
  button.type = "button";
  button.title = "Open theme editor";
  button.ariaLabel = "Toggle theme editor";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-controls", panelId);
  button.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path
        d="M12 2a1 1 0 0 1 1 1v1.18a4.002 4.002 0 0 0 2.4 3.664l.06.026 1.09.424a1 1 0 0 1 .345 1.635l-.837.837a4 4 0 0 0-.97 3.935l.032.117.307 1.086a1 1 0 0 1-1.24 1.24l-1.086-.307a4 4 0 0 0-3.935.97l-.837.837a1 1 0 0 1-1.635-.345l-.424-1.09a4.002 4.002 0 0 0-3.69-2.457H4a1 1 0 0 1-1-1v-1.1a1 1 0 0 1 .553-.894l1.09-.424a4.002 4.002 0 0 0 2.401-3.664V6.5a4.002 4.002 0 0 0-2.4-3.664L4.494 2.81A1 1 0 0 1 5 1.9l1.086.307a4 4 0 0 0 3.935-.97l.837-.837A1 1 0 0 1 12 1v1Z"
        fill="currentColor"
      ></path>
    </svg>
  `;

  button.addEventListener("click", () => {
    editor.toggle();
  });

  return button;
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

  const fab = createFloatingButton();

  shell.append(viewerPane, editorPane);

  return {
    shell,
    fab,
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

  const fab = createFloatingButton();

  shell.append(canvasPane, editorPane);

  return {
    shell,
    fab,
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

function attachFabToggle(
  view: BaseView,
  options?: {
    onOpen?: () => void;
    onClose?: () => void;
  }
): void {
  const { fab, shell, editorPane } = view;

  shell.classList.remove("show-editor");
  const controlsId = editorPane.id || "markdown-editor-pane";
  editorPane.setAttribute("aria-hidden", "true");
  editorPane.toggleAttribute("inert", true);
  fab.setAttribute("aria-controls", controlsId);
  fab.setAttribute("aria-expanded", "false");

  fab.addEventListener("click", () => {
    const isEditing = document.body.classList.toggle("is-editing");
    shell.classList.toggle("show-editor", isEditing);
    fab.setAttribute("aria-expanded", String(isEditing));
    editorPane.setAttribute("aria-hidden", String(!isEditing));
    editorPane.toggleAttribute("inert", !isEditing);
    if (isEditing) {
      view.textarea.focus();
      options?.onOpen?.();
    } else {
      options?.onClose?.();
    }
  });

  document.body.appendChild(fab);
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
  const themeButton = ensureThemeToggleButton();
  document.body.appendChild(themeButton);
  if (!themeSwitcherButton) {
    themeSwitcherButton = createThemeSwitchButton();
  }
  if (!themeSwitcherButton.isConnected) {
    document.body.appendChild(themeSwitcherButton);
  }
  applyTheme(initialTheme);

  attachFabToggle(view, {
    onOpen: () => themeEditor.close(),
  });

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
