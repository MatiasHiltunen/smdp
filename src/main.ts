import { MDParser, u8 } from "./parser/index";
import {
  initializeThemeEditor,
  type ThemeEditorHandle,
} from "./theme/theme-editor";
import "./style.css";
import { applyTheme, getCurrentTheme, getThemeBuilder } from "./client/theme";
import { parseRoute } from "./client/routing";
import {
  createCanvasView,
  createHtmlView,
  type CanvasView,
  type HtmlView,
} from "./client/views";
import { fetchMarkdown, type MarkdownFetchResult } from "./client/fetch";
import { createFabMenu, displayError } from "./client/ui";

let themeEditorHandle: ThemeEditorHandle | null = null;
let themeEditorViewListenerAttached = false;

const parser = new MDParser({
  // Security: disable raw HTML blocks by default
  allowRawHtml: false,
});

function ensureThemeEditor(): ThemeEditorHandle {
  if (!themeEditorHandle) {
    const themeBuilder = getThemeBuilder();
    themeEditorHandle = initializeThemeEditor(themeBuilder);
  }
  return themeEditorHandle;
}

async function applyMarkdownToHtml(
  view: HtmlView,
  bytes: Uint8Array,
  baseUrl?: string,
): Promise<void> {
  const overrides = baseUrl ? { baseUrl } : undefined;
  const html = await parser.parse(bytes, overrides);
  view.viewer.innerHTML = html;
}

function applyMarkdownToCanvas(
  view: CanvasView,
  bytes: Uint8Array,
  baseUrl?: string,
): void {
  const overrides = baseUrl ? { baseUrl } : undefined;
  parser.renderToCanvas(bytes, view.canvas, overrides);
}

function enableRealtimeUpdates(
  view: HtmlView | CanvasView,
  apply: (bytes: Uint8Array, baseUrl?: string) => Promise<void>,
  resolveBaseUrl: () => string | undefined,
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

async function init(): Promise<void> {
  document.body.classList.add("hydrating");

  const initialTheme = getCurrentTheme();
  applyTheme(initialTheme, themeEditorHandle);

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
    displayError(
      error instanceof Error ? error.message : "Unable to load markdown",
    );
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
