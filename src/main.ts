import { decodeSharePayload, type ThemePayload } from "./data-link";
import { MDParser, u8 } from "./parser/index";
import {
  initializeThemeEditor,
  loadThemeFromUrl,
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

function applyEmbeddedThemes(themes: ThemePayload, builder: ReturnType<typeof getThemeBuilder>): void {
  if (!themes.dark && !themes.light) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (themes.dark) {
    params.set("d", themes.dark);
  } else {
    params.delete("d");
  }
  if (themes.light) {
    params.set("l", themes.light);
  } else {
    params.delete("l");
  }

  const search = params.toString();
  const newUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", newUrl);

  const applied = loadThemeFromUrl(builder);
  if (applied) {
    builder.apply();
    themeEditorHandle?.refresh();
  }
}

async function applyMarkdownToHtml(
  view: HtmlView,
  bytes: Uint8Array,
  baseUrl?: string,
  blockData?: Uint8Array,
): Promise<void> {
  const overrides = baseUrl ? { baseUrl } : {};
  const html = blockData
    ? await parser.parseFromBlocks(bytes, blockData, overrides)
    : await parser.parse(bytes, overrides);
  view.viewer.innerHTML = html;
}

function applyMarkdownToCanvas(
  view: CanvasView,
  bytes: Uint8Array,
  baseUrl?: string,
  blockData?: Uint8Array,
): void {
  const overrides = baseUrl ? { baseUrl } : {};
  if (blockData) {
    parser.renderToCanvasFromBlocksPayload(bytes, blockData, view.canvas, overrides);
  } else {
    parser.renderToCanvas(bytes, view.canvas, overrides);
  }
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
  applyTheme(initialTheme, themeEditorHandle, false);

  // Apply theme overrides from URL for both shared and normal modes.
  // Ensures shared/embed pages pick up style params supplied in the query string.
  const themeBuilder = getThemeBuilder();
  const hasUrlTheme = loadThemeFromUrl(themeBuilder);
  if (hasUrlTheme) {
    themeBuilder.apply();
    // If a theme editor exists, refresh it; otherwise it's a no-op and
    // when the editor is later created it will reflect current builder state.
    themeEditorHandle?.refresh();
  }

  const route = parseRoute();

  let view: HtmlView | CanvasView;
  let apply: (bytes: Uint8Array, baseUrl?: string) => Promise<void>;
  let themeEditorLocal: ThemeEditorHandle | null = null;

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
  if (route.shared) {
    // Remove editor pane entirely for shared/embed mode
    try { view.editorPane.remove(); } catch {}
  } else {
    themeEditorLocal = ensureThemeEditor();
    document.body.appendChild(themeEditorLocal.root);

    // Create FAB menu with editor toggle callback
    const fabMenu = createFabMenu(view, themeEditorLocal, () => {
      const isEditing = document.body.classList.toggle("is-editing");
      view.shell.classList.toggle("show-editor", isEditing);
      view.editorPane.setAttribute("aria-hidden", String(!isEditing));
      view.editorPane.toggleAttribute("inert", !isEditing);
      if (isEditing) {
        view.textarea.focus();
        themeEditorLocal?.close();
      }
    });
    document.body.appendChild(fabMenu);
  }

  // Theme editor already loaded from URL, no need to reapply

  if (!route.shared && !themeEditorViewListenerAttached && themeEditorLocal) {
    themeEditorLocal.root.addEventListener("theme-editor-toggle", (event) => {
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
    if (route.dataPayload) {
      const decoded = await decodeSharePayload(route.dataPayload, undefined, {
        encoding: route.dataFormat === "binary" ? "base79" : "base64",
      });
      if (decoded.themes && (decoded.themes.dark || decoded.themes.light)) {
        applyEmbeddedThemes(decoded.themes, themeBuilder);
      }
      resolved = {
        bytes: decoded.markdown,
        baseUrl: window.location.href,
        blocks: decoded.blocks ?? null,
      };
      resolvedText = new TextDecoder().decode(decoded.markdown);
    } else {
      resolved = await fetchMarkdown(route.externalUrl);
      resolvedText = new TextDecoder().decode(resolved.bytes);
    }
  } catch (error) {
    console.error(error);
    const message =
      route.dataPayload && error instanceof Error
        ? "Unable to decode shared markdown link"
        : error instanceof Error
          ? error.message
          : "Unable to load markdown";
    displayError(message);
    if (!route.dataPayload && route.externalUrl) {
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

  if (!route.shared) {
    if (resolvedText !== null) {
      view.textarea.value = resolvedText;
    } else {
      view.textarea.value = "";
    }
  }

  if (resolved) {
    currentBaseUrl = resolved.baseUrl;
    if (resolved.blocks) {
      if ("canvas" in view) {
        applyMarkdownToCanvas(view as CanvasView, resolved.bytes, currentBaseUrl, resolved.blocks);
      } else {
        await applyMarkdownToHtml(view as HtmlView, resolved.bytes, currentBaseUrl, resolved.blocks);
      }
    } else {
      await apply(resolved.bytes, currentBaseUrl);
    }
  }

  if (!route.shared) {
    enableRealtimeUpdates(view, apply, () => currentBaseUrl);
  }
}

void init();
