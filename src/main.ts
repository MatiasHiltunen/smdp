import { decodeBase64Markdown } from "./data-link";
import { MDParser, u8 } from "./parser/index";
import {
  initializeThemeEditor,
  type ThemeEditorHandle,
} from "./theme/theme-editor";
import "./style.css";
import {
  applyTheme,
  applyThemeUrlOverrides,
  getCurrentTheme,
  getThemeBuilder,
} from "./client/theme";
import { parseRoute } from "./client/routing";
import { BookLoader } from "./client/book";
import {
  createCanvasView,
  createHtmlView,
  type CanvasView,
  type HtmlView,
} from "./client/views";
import { fetchMarkdown, type MarkdownFetchResult } from "./client/fetch";
import { canonicalizeBookLink } from "./client/github-url";
import { sanitizeSharedDataBaseUrl } from "./client/shared-data";
import { createFabMenu, displayError } from "./client/ui";
import { TD } from "./parser/constants";
import { onThemeChange } from "./client/theme-events";
import { mountE2ETestRunner } from "./client/e2e";
import {
  createBookTopicsMenu,
  type BookTopicsMenuHandle,
} from "./client/book-topics";
import { shouldAllowRawHtmlForRoute } from "./client/render-options";
import {
  applyFrameMode,
  applyFrameModeFromUrl,
  applyBackgroundMode,
  applyBackgroundModeFromUrl,
  parseBackgroundMode,
  parseFrameMode,
  setBackgroundModeSearchParam,
  setFrameModeSearchParam,
} from "./client/frame-mode";

let themeEditorHandle: ThemeEditorHandle | null = null;
let themeEditorViewListenerAttached = false;

const parser = new MDParser({
  // Security: disable raw HTML blocks by default
  allowRawHtml: false,
});

function ensureThemeEditor(): ThemeEditorHandle {
  if (!themeEditorHandle) {
    const themeBuilder = getThemeBuilder();
    themeEditorHandle = initializeThemeEditor(themeBuilder, { loadFromUrl: false });
  }
  return themeEditorHandle;
}

async function applyMarkdownToHtml(
  view: HtmlView,
  bytes: Uint8Array,
  baseUrl?: string,
  allowRawHtml: boolean = false,
): Promise<void> {
  const overrides = {
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(allowRawHtml ? { allowRawHtml: true } : {}),
  };
  const html = await parser.parse(bytes, overrides);
  view.viewer.innerHTML = html;
}

function applyMarkdownToCanvas(
  view: CanvasView,
  bytes: Uint8Array,
  baseUrl?: string,
  allowRawHtml: boolean = false,
): void {
  const overrides = {
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(allowRawHtml ? { allowRawHtml: true } : {}),
  };
  parser.renderToCanvas(bytes, view.canvas, overrides);
}

function enableRealtimeUpdates(
  view: HtmlView | CanvasView,
  apply: (bytes: Uint8Array, baseUrl?: string, allowRawHtml?: boolean) => Promise<void>,
  resolveBaseUrl: () => string | undefined,
  resolveAllowRawHtml: () => boolean,
): () => void {
  const DEBOUNCE_MS = 80;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let renderInFlight = false;
  let rerenderRequested = false;

  const runRender = async (): Promise<void> => {
    if (renderInFlight) {
      rerenderRequested = true;
      return;
    }

    renderInFlight = true;
    try {
      do {
        rerenderRequested = false;
        const value = view.textarea.value;
        const bytes = u8(value);
        const baseUrl = resolveBaseUrl();
        const allowRawHtml = resolveAllowRawHtml();
        await apply(bytes, baseUrl, allowRawHtml);
      } while (rerenderRequested);
    } catch (error) {
      console.error("Failed to update preview", error);
    } finally {
      renderInFlight = false;
    }
  };

  const scheduleRender = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runRender();
    }, DEBOUNCE_MS);
  };

  const onInput = () => {
    rerenderRequested = true;
    scheduleRender();
  };

  view.textarea.addEventListener("input", onInput);

  return () => {
    view.textarea.removeEventListener("input", onInput);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };
}

function preserveThemeQueryParams(target: URL): void {
  const current = new URLSearchParams(window.location.search);
  const next = new URLSearchParams();
  const dark = current.get("d");
  const light = current.get("l");
  if (dark) next.set("d", dark);
  if (light) next.set("l", light);
  const backgroundMode = parseBackgroundMode(current.get("bg"));
  setBackgroundModeSearchParam(next, backgroundMode);
  const frameMode = parseFrameMode(current.get("fm"));
  setFrameModeSearchParam(next, frameMode);
  target.search = next.toString();
}

function buildBookUrl(
  entryUrl: string,
  partUrl: string,
  anchor?: string,
): URL {
  const next = new URL(window.location.href);
  next.pathname = `/book/${entryUrl}`;
  preserveThemeQueryParams(next);
  next.searchParams.set("part", partUrl);
  next.hash = anchor ? `#${anchor}` : "";
  return next;
}

function scrollToHeadingAnchor(view: HtmlView, anchor: string): void {
  if (!anchor) return;
  let decoded = anchor;
  try {
    decoded = decodeURIComponent(anchor);
  } catch {
    decoded = anchor;
  }
  const escaped = globalThis.CSS?.escape
    ? globalThis.CSS.escape(decoded)
    : decoded.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  requestAnimationFrame(() => {
    const target = view.viewer.querySelector<HTMLElement>(`#${escaped}`);
    target?.scrollIntoView({ block: "start" });
  });
}

function scrollToTop(): void {
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}

function rewriteBookLinksInViewer(
  view: HtmlView,
  loader: BookLoader,
  currentBaseUrl: string,
): void {
  const entryUrl = loader.getEntryUrl();
  const anchors = view.viewer.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    const target = canonicalizeBookLink(href, currentBaseUrl);
    if (!target) continue;
    if (!loader.isKnownPart(target.canonicalUrl)) continue;

    const bookUrl = buildBookUrl(entryUrl, target.canonicalUrl, target.anchor);
    anchor.href = bookUrl.toString();
    anchor.dataset.bookPart = target.canonicalUrl;
    anchor.dataset.bookAnchor = target.anchor;
  }
}

async function init(): Promise<void> {
  document.body.classList.add("hydrating");
  const cleanupFns: Array<() => void> = [];
  const registerCleanup = (fn: () => void): void => {
    cleanupFns.push(fn);
  };
  const runCleanup = (): void => {
    while (cleanupFns.length > 0) {
      const fn = cleanupFns.pop();
      try {
        fn?.();
      } catch (error) {
        console.warn("cleanup failed", error);
      }
    }
  };
  window.addEventListener("pagehide", runCleanup, { once: true });

  const initialTheme = getCurrentTheme();
  applyTheme(initialTheme, themeEditorHandle, false, false, "init");

  // Apply theme overrides from URL for both shared and normal modes.
  // Ensures shared/embed pages pick up style params supplied in the query string.
  const themeBuilder = getThemeBuilder();
  const hasUrlTheme = applyThemeUrlOverrides(themeEditorHandle);
  if (!hasUrlTheme) {
    themeBuilder.apply();
  }

  const route = parseRoute();
  if (route.mode === "html") {
    applyBackgroundModeFromUrl();
    applyFrameModeFromUrl();
  } else {
    applyBackgroundMode("full");
    applyFrameMode("full");
  }
  document.body.classList.toggle("mode-canvas", route.mode === "canvas");
  if (route.mode === "test_e2e") {
    document.body.classList.remove("hydrating");
    mountE2ETestRunner(route.externalUrl);
    return;
  }
  // HTML and canvas modes keep raw HTML enabled so sanitized tags (tables,
  // links, emphasis, inline images, etc.) render consistently by default.
  const allowRawHtml = shouldAllowRawHtmlForRoute(route);

  let view: HtmlView | CanvasView;
  let applyRender: (
    bytes: Uint8Array,
    baseUrl?: string,
    allowRawHtml?: boolean,
  ) => Promise<void>;
  let themeEditorLocal: ThemeEditorHandle | null = null;

  if (route.mode === "canvas") {
    const canvasView = createCanvasView();
    view = canvasView;
    applyRender = async (bytes, baseUrl, allowRawHtmlOverride) => {
      applyMarkdownToCanvas(
        canvasView,
        bytes,
        baseUrl,
        allowRawHtmlOverride ?? false,
      );
    };
  } else {
    const htmlView = createHtmlView();
    view = htmlView;
    applyRender = (bytes, baseUrl, allowRawHtmlOverride) =>
      applyMarkdownToHtml(
        htmlView,
        bytes,
        baseUrl,
        allowRawHtmlOverride ?? false,
      );
  }

  let latestBytes = u8("");
  let latestBaseUrl: string | undefined;
  let latestAllowRawHtml = allowRawHtml;

  const apply = async (
    bytes: Uint8Array,
    baseUrl?: string,
    allowRawHtmlOverride?: boolean,
  ): Promise<void> => {
    latestBytes = bytes;
    latestBaseUrl = baseUrl;
    latestAllowRawHtml = allowRawHtmlOverride ?? false;
    await applyRender(bytes, baseUrl, latestAllowRawHtml);
  };

  let resolved: MarkdownFetchResult | null = null;
  let currentBaseUrl: string | undefined;
  let bookLoader: BookLoader | null = null;
  let currentBookPartUrl: string | null = null;
  let bookTopicsMenu: BookTopicsMenuHandle | null = null;

  const rerenderCurrent = async (): Promise<void> => {
    if (!latestBytes || latestBytes.byteLength === 0) {
      return;
    }
    await apply(latestBytes, latestBaseUrl, latestAllowRawHtml);
  };

  document.body.classList.remove("is-editing");
  document.body.replaceChildren(view.shell);
  if (route.shared) {
    // Remove editor pane entirely for shared/embed mode
    try { view.editorPane.remove(); } catch {}
  } else {
    themeEditorLocal = ensureThemeEditor();
    document.body.appendChild(themeEditorLocal.root);

    // Create FAB menu with editor toggle callback
    const fabMenu = createFabMenu(view, themeEditorLocal, {
      onToggleEditor: () => {
        const isEditing = document.body.classList.toggle("is-editing");
        view.shell.classList.toggle("show-editor", isEditing);
        view.editorPane.setAttribute("aria-hidden", String(!isEditing));
        view.editorPane.toggleAttribute("inert", !isEditing);
        if (isEditing) {
          view.textarea.focus();
          themeEditorLocal?.close();
        }
      },
      enableLoadUrlEmbed: route.mode === "html",
      getCurrentLoadUrl: () => currentBaseUrl ?? null,
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

  if (route.mode === "html" && route.bookEntryUrl) {
    bookTopicsMenu = createBookTopicsMenu();
    document.body.appendChild(bookTopicsMenu.root);
    registerCleanup(() => {
      bookTopicsMenu?.destroy();
      bookTopicsMenu?.root.remove();
      bookTopicsMenu = null;
    });
  }

  try {
    if (route.bookEntryUrl) {
      bookLoader = new BookLoader(route.bookEntryUrl.toString());
      const initialTarget =
        route.bookPartUrl?.toString() ?? bookLoader.getEntryUrl();
      const initialPart = await bookLoader.loadPart(initialTarget);
      currentBookPartUrl = initialPart.url;
      resolved = {
        bytes: initialPart.bytes,
        baseUrl: initialPart.baseUrl,
      };
      bookLoader.prefetchInBackground();
    } else if (route.dataPayload) {
      const decoded = await decodeBase64Markdown(route.dataPayload);
      const baseUrl = sanitizeSharedDataBaseUrl(window.location.href);
      resolved = {
        bytes: decoded,
        baseUrl,
      };

    } else {
      resolved = await fetchMarkdown(route.externalUrl);
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
        //resolvedText = new TextDecoder().decode(resolved.bytes);
      } catch (fallbackError) {
        console.error("Unable to load fallback markdown", fallbackError);
      }
    }
  } finally {
    document.body.classList.remove("hydrating");
  }


  if (resolved) {
    currentBaseUrl = resolved.baseUrl;
    await apply(resolved.bytes, currentBaseUrl, allowRawHtml);

    if (bookLoader && route.mode === "html") {
      const htmlView = view as HtmlView;
      rewriteBookLinksInViewer(htmlView, bookLoader, currentBaseUrl);
      bookTopicsMenu?.update(htmlView.viewer);
      scrollToHeadingAnchor(htmlView, window.location.hash.replace(/^#/, ""));
    }

    view.textarea.value = TD.decode(resolved.bytes);
  }

  if (bookLoader && route.mode === "html") {
    const htmlView = view as HtmlView;

    const navigateToBookPart = async (
      targetPartUrl: string,
      anchor: string,
      pushHistory: boolean,
    ): Promise<void> => {
      if (!bookLoader) return;
      const nextPart = await bookLoader.loadPart(targetPartUrl);
      const isSamePart = currentBookPartUrl === nextPart.url;
      currentBookPartUrl = nextPart.url;
      currentBaseUrl = nextPart.baseUrl;

      if (!isSamePart) {
        await apply(nextPart.bytes, currentBaseUrl, allowRawHtml);
        view.textarea.value = nextPart.markdown;
      }

      rewriteBookLinksInViewer(htmlView, bookLoader, currentBaseUrl);
      bookTopicsMenu?.update(htmlView.viewer);
      if (anchor) {
        scrollToHeadingAnchor(htmlView, anchor);
      } else {
        scrollToTop();
      }

      if (pushHistory) {
        const next = buildBookUrl(bookLoader.getEntryUrl(), nextPart.url, anchor);
        window.history.pushState(
          { bookPartUrl: nextPart.url, bookAnchor: anchor },
          "",
          next,
        );
      }

      bookLoader.prefetchInBackground();
    };

    const onBookLinkClick = (event: Event): void => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest("a[data-book-part]") as HTMLAnchorElement | null;
      if (!link) return;
      const partUrl = link.dataset.bookPart;
      if (!partUrl) return;
      event.preventDefault();
      const anchor = link.dataset.bookAnchor ?? "";
      void navigateToBookPart(partUrl, anchor, true).catch((error) => {
        console.error("Unable to navigate to book chapter", error);
        displayError("Unable to open linked chapter");
      });
    };
    htmlView.viewer.addEventListener("click", onBookLinkClick);
    registerCleanup(() => htmlView.viewer.removeEventListener("click", onBookLinkClick));

    const onBookPopState = () => {
      const nextRoute = parseRoute();
      if (!nextRoute.bookEntryUrl || !bookLoader) return;
      const partUrl = nextRoute.bookPartUrl?.toString() ?? bookLoader.getEntryUrl();
      const anchor = window.location.hash.replace(/^#/, "");
      void navigateToBookPart(partUrl, anchor, false).catch((error) => {
        console.error("Unable to restore book navigation state", error);
      });
    };
    window.addEventListener("popstate", onBookPopState);
    registerCleanup(() => window.removeEventListener("popstate", onBookPopState));
  }

  if (!route.shared) {
    const stopRealtimeUpdates = enableRealtimeUpdates(
      view,
      apply,
      () => currentBaseUrl,
      () => allowRawHtml,
    );
    registerCleanup(stopRealtimeUpdates);
  }

  if (route.mode === "canvas") {
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleCanvasRerender = (): void => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        void rerenderCurrent().catch((error) => {
          console.error("Canvas rerender failed after resize/theme change", error);
        });
      }, 120);
    };

    const onResize = (): void => {
      scheduleCanvasRerender();
    };
    window.addEventListener("resize", onResize, { passive: true });
    registerCleanup(() => window.removeEventListener("resize", onResize));

    const removeThemeListener = onThemeChange(() => {
      scheduleCanvasRerender();
    });
    registerCleanup(removeThemeListener);

    const canvasView = view as CanvasView;
    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(() => {
        scheduleCanvasRerender();
      });
      const resizeTarget =
        canvasView.canvas.parentElement?.closest(".canvas-scroll") ??
        canvasView.canvas.parentElement ??
        canvasView.canvas;
      resizeObserver.observe(resizeTarget);
      registerCleanup(() => resizeObserver.disconnect());
    }

    registerCleanup(() => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
        resizeTimer = null;
      }
    });
  }
}

void init();
