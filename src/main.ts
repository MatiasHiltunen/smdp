import { decodeBase64Markdown } from "./data-link";
import { MDParser, u8 } from "./parser/index";
import { TD } from "./parser/constants";
import type { ThemeEditorHandle } from "./theme/theme-editor";
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
import { displayError } from "./client/error-banner";
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
import {
  decodeBookPrefetchPayload,
  encodeBookPrefetchPayload,
} from "./client/book-prefetch-share";
import { createElement, replaceElementHtml } from "./client/dom";
import {
  buildEditorBookContentLinks,
  createBookEditorDocumentSnapshot,
  createSingleEditorDocumentSnapshot,
  EditorStateController,
  getCurrentEditorPage,
  snapshotToBookPrefetchParts,
  type EditorDocumentSnapshot,
} from "./client/editor-model";
import { createEditorWindow } from "./client/editor-window";
import type {
  EditorDockPlacement,
  EditorWindowLayout,
} from "./client/editor-window";
import {
  connectEditorSessionBridge,
  createEditorSessionId,
  readPersistedEditorSession,
} from "./client/editor-sync";
import {
  buildEditorDraftSourceKey,
  loadEditorDraftSnapshot,
  saveEditorDraftSnapshot,
} from "./client/editor-storage";
import { initializePwaController } from "./client/pwa";

let themeEditorHandle: ThemeEditorHandle | null = null;
let themeEditorViewListenerAttached = false;
let themeEditorModulePromise:
  | Promise<typeof import("./theme/theme-editor")>
  | null = null;
let uiModulePromise: Promise<typeof import("./client/ui")> | null = null;

const parser = new MDParser({
  allowRawHtml: false,
});

function loadThemeEditorModule(): Promise<typeof import("./theme/theme-editor")> {
  if (!themeEditorModulePromise) {
    themeEditorModulePromise = import("./theme/theme-editor");
  }
  return themeEditorModulePromise;
}

function loadUiModule(): Promise<typeof import("./client/ui")> {
  if (!uiModulePromise) {
    uiModulePromise = import("./client/ui");
  }
  return uiModulePromise;
}

async function ensureThemeEditor(): Promise<ThemeEditorHandle> {
  if (!themeEditorHandle) {
    const { initializeThemeEditor } = await loadThemeEditorModule();
    const themeBuilder = getThemeBuilder();
    themeEditorHandle = initializeThemeEditor(themeBuilder, {
      loadFromUrl: false,
    });
  }
  return themeEditorHandle;
}

async function applyMarkdownToHtml(
  view: HtmlView,
  bytes: Uint8Array,
  baseUrl?: string,
  allowRawHtml = false,
): Promise<void> {
  const overrides = {
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(allowRawHtml ? { allowRawHtml: true } : {}),
  };
  const html = await parser.parse(bytes, overrides);
  replaceElementHtml(view.viewer, html, baseUrl !== undefined ? { baseUrl } : {});
}

function applyMarkdownToCanvas(
  view: CanvasView,
  bytes: Uint8Array,
  baseUrl?: string,
  allowRawHtml = false,
): void {
  const overrides = {
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(allowRawHtml ? { allowRawHtml: true } : {}),
  };
  parser.renderToCanvas(bytes, view.canvas, overrides);
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
  options: {
    sharedMode?: boolean;
    sharedBookPrefetchPayload?: string | null;
  } = {},
): URL {
  const next = new URL(window.location.href);
  if (options.sharedMode) {
    next.pathname = `/book/shared/${entryUrl}`;
  } else {
    next.pathname = `/book/${entryUrl}`;
  }
  preserveThemeQueryParams(next);
  next.searchParams.set("part", partUrl);
  if (options.sharedMode && options.sharedBookPrefetchPayload) {
    next.searchParams.set("bp", options.sharedBookPrefetchPayload);
  } else {
    next.searchParams.delete("bp");
  }
  next.searchParams.delete("be");
  next.hash = anchor ? `#${anchor}` : "";
  return next;
}

function buildExternalEditorUrl(sessionId: string): URL {
  const next = new URL(window.location.href);
  next.pathname = "/editor";
  preserveThemeQueryParams(next);
  next.searchParams.set("session", sessionId);
  next.hash = "";
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

type MarkdownHeadingRef = {
  line: number;
  title: string;
  ordinal: number;
};

function normalizeHeadingText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function getMarkdownHeadingRefs(markdown: string): MarkdownHeadingRef[] {
  const refs: MarkdownHeadingRef[] = [];
  const titleCounts = new Map<string, number>();
  const lines = markdown.split(/\r?\n/);

  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (!match) {
      return;
    }
    const title = normalizeHeadingText(match[2]);
    if (!title) {
      return;
    }
    const ordinal = titleCounts.get(title) ?? 0;
    titleCounts.set(title, ordinal + 1);
    refs.push({ line: index + 1, title, ordinal });
  });

  return refs;
}

function trackMarkdownLineInHtmlView(
  view: HtmlView,
  markdown: string,
  line: number,
): void {
  const headings = getMarkdownHeadingRefs(markdown);
  let targetHeading: MarkdownHeadingRef | null = null;
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    if (headings[index].line <= line) {
      targetHeading = headings[index];
      break;
    }
  }

  if (targetHeading) {
    let seen = 0;
    const renderedHeadings = view.viewer.querySelectorAll<HTMLElement>(
      "h1,h2,h3,h4,h5,h6",
    );
    for (const heading of renderedHeadings) {
      if (normalizeHeadingText(heading.textContent ?? "") !== targetHeading.title) {
        continue;
      }
      if (seen === targetHeading.ordinal) {
        heading.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      seen += 1;
    }
  }

  const totalLines = Math.max(1, markdown.split(/\r?\n/).length);
  const scrollMax = Math.max(
    0,
    document.documentElement.scrollHeight - window.innerHeight,
  );
  window.scrollTo({
    top: scrollMax * Math.min(1, Math.max(0, (line - 1) / totalLines)),
    behavior: "smooth",
  });
}

function applyEditorDockLayout(layout: EditorWindowLayout): void {
  const placements: EditorDockPlacement[] = ["left", "right", "top", "bottom"];
  document.body.classList.remove(
    "has-docked-editor",
    ...placements.map((placement) => `editor-dock-${placement}`),
  );
  for (const placement of placements) {
    document.body.style.removeProperty(`--editor-dock-${placement}`);
  }

  if (!layout.open || layout.dockPlacement === "floating" || !layout.rect) {
    return;
  }

  document.body.classList.add(
    "has-docked-editor",
    `editor-dock-${layout.dockPlacement}`,
  );
  const size =
    layout.dockPlacement === "left" || layout.dockPlacement === "right"
      ? layout.rect.width
      : layout.rect.height;
  document.body.style.setProperty(
    `--editor-dock-${layout.dockPlacement}`,
    `${size}px`,
  );
}

function prioritizeCurrentBookPart<T extends { url: string }>(
  parts: readonly T[],
  currentPartUrl: string | null,
): T[] {
  const ordered = [...parts];
  if (!currentPartUrl) return ordered;
  const index = ordered.findIndex((part) => part.url === currentPartUrl);
  if (index <= 0) return ordered;
  const [current] = ordered.splice(index, 1);
  ordered.unshift(current);
  return ordered;
}

function shouldHandleBookLinkClick(
  event: MouseEvent,
  link: HTMLAnchorElement,
): boolean {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  const target = link.getAttribute("target");
  if (target && target.toLowerCase() !== "_self") {
    return false;
  }
  return true;
}

function rewriteBookLinksInViewer(
  view: HtmlView,
  loader: BookLoader,
  currentBaseUrl: string,
  options: {
    sharedMode: boolean;
  },
): void {
  const entryUrl = loader.getEntryUrl();
  const anchors = view.viewer.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    const target = canonicalizeBookLink(href, currentBaseUrl);
    if (!target) continue;
    const canonicalPart = loader.registerNavigablePart(target.canonicalUrl);
    if (!canonicalPart) continue;

    const bookUrl = buildBookUrl(entryUrl, canonicalPart, target.anchor, {
      sharedMode: options.sharedMode,
      sharedBookPrefetchPayload: null,
    });
    anchor.href = bookUrl.toString();
    anchor.dataset.bookPart = canonicalPart;
    anchor.dataset.bookAnchor = target.anchor;
  }
}

const MAX_INLINE_BOOK_EXPORT_PARTS = 128;

const EMBEDDED_BOOK_EXPORT_STYLES = `
.embedded-book-nav {
  margin: 0 0 1.5rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
}
.embedded-book-nav-title {
  display: inline-block;
  font-weight: 600;
  margin-bottom: 0.6rem;
}
.embedded-book-nav-list {
  margin: 0;
  padding-left: 1.25rem;
  display: grid;
  gap: 0.4rem;
}
.embedded-book-part {
  margin-top: 2.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border-glass);
}
.embedded-book-part:first-of-type {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
`;

function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtmlText(value).replaceAll('"', "&quot;");
}

function buildEmbeddedBookPartId(index: number): string {
  return `embedded-book-part-${index + 1}`;
}

function rewriteEmbeddedBookPartLinks(
  chapterHtml: string,
  currentBaseUrl: string,
  currentPartUrl: string,
  partIdByUrl: ReadonlyMap<string, string>,
): string {
  if (typeof document === "undefined" || !document.createElement) {
    return chapterHtml;
  }

  const wrapper = document.createElement("div");
  replaceElementHtml(wrapper, chapterHtml, { baseUrl: currentBaseUrl });
  const links = wrapper.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) continue;
    const target = canonicalizeBookLink(href, currentBaseUrl);
    if (!target) continue;

    if (target.canonicalUrl === currentPartUrl && target.anchor) {
      link.setAttribute("href", `#${encodeURIComponent(target.anchor)}`);
      continue;
    }

    const targetPartId = partIdByUrl.get(target.canonicalUrl);
    if (!targetPartId) continue;
    link.setAttribute("href", `#${targetPartId}`);
  }

  return wrapper.innerHTML;
}

async function buildInlineBookEmbedHtmlSource(
  snapshot: EditorDocumentSnapshot,
  currentPartUrl: string | null,
  allowRawHtml: boolean,
): Promise<string | null> {
  if (snapshot.mode !== "book") {
    return null;
  }

  const pages = prioritizeCurrentBookPart(
    snapshot.pages,
    currentPartUrl,
  ).slice(0, MAX_INLINE_BOOK_EXPORT_PARTS);
  if (pages.length === 0) {
    return null;
  }

  const partIdByUrl = new Map<string, string>();
  pages.forEach((page, index) => {
    partIdByUrl.set(page.url, buildEmbeddedBookPartId(index));
  });

  const chapterSections: string[] = [];
  const tocItems: string[] = [];

  for (const page of pages) {
    const renderOptions: { baseUrl: string; allowRawHtml?: true } = {
      baseUrl: page.baseUrl,
    };
    if (allowRawHtml) {
      renderOptions.allowRawHtml = true;
    }
    const rendered = await parser.parse(u8(page.markdown), renderOptions);
    const rewritten = rewriteEmbeddedBookPartLinks(
      rendered,
      page.baseUrl,
      page.url,
      partIdByUrl,
    );
    const chapterId = partIdByUrl.get(page.url)!;
    tocItems.push(
      `<li><a href="#${chapterId}">${escapeHtmlText(page.title)}</a></li>`,
    );
    chapterSections.push(
      `<section class="embedded-book-part" id="${chapterId}" data-book-source="${escapeHtmlAttr(page.url)}">\n${rewritten}\n</section>`,
    );
  }

  const viewerHtml = `<nav class="embedded-book-nav" aria-label="Book chapters">
  <span class="embedded-book-nav-title">Contents</span>
  <ol class="embedded-book-nav-list">
    ${tocItems.join("\n    ")}
  </ol>
</nav>
${chapterSections.join("\n")}`;

  const { buildExportHtmlDocumentFromViewerHtml } = await loadUiModule();
  return buildExportHtmlDocumentFromViewerHtml(viewerHtml, {
    extraStyles: EMBEDDED_BOOK_EXPORT_STYLES,
  });
}

async function bootExternalEditor(
  sessionId: string | null,
  pwaController: ReturnType<typeof initializePwaController>,
  registerCleanup: (fn: () => void) => void,
): Promise<void> {
  document.body.classList.add("mode-editor");
  document.body.classList.remove("mode-canvas");
  document.body.classList.remove("is-editing");

  const host = createElement("div");
  document.body.replaceChildren(host);

  const textarea = createElement("textarea");
  textarea.id = "markdown-editor-input";
  textarea.setAttribute("aria-label", "Markdown source");
  textarea.autocomplete = "off";

  const activeSessionId = sessionId ?? createEditorSessionId();
  const persistedSnapshot = readPersistedEditorSession(activeSessionId);
  const fallbackSnapshot = createSingleEditorDocumentSnapshot({
    markdown: "# Untitled\n\nStart writing here.",
    baseUrl: window.location.href,
    sourceUrl: null,
    fallbackOrigin: window.location.href,
  });
  const controller = new EditorStateController(
    persistedSnapshot ?? fallbackSnapshot,
  );
  const bridge = connectEditorSessionBridge({
    sessionId: activeSessionId,
    mode: "guest",
    controller,
  });
  registerCleanup(() => bridge.destroy());

  const flushSnapshot = (): void => {
    bridge.flushSnapshot();
  };
  window.addEventListener("beforeunload", flushSnapshot);
  registerCleanup(() => window.removeEventListener("beforeunload", flushSnapshot));

  const editorWindow = createEditorWindow({
    host,
    textarea,
    controller,
    externalWindow: true,
    onRequestClose: () => {
      bridge.flushSnapshot();
      window.close();
    },
    onRequestInstall: async () => {
      await pwaController.promptInstall();
    },
    subscribeInstallAvailability: (listener) =>
      pwaController.subscribe(listener),
  });
  registerCleanup(() => editorWindow.destroy());

  document.title = "SMDP Editor";
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

  const themeBuilder = getThemeBuilder();
  const hasUrlTheme = applyThemeUrlOverrides(themeEditorHandle);
  if (!hasUrlTheme) {
    themeBuilder.apply();
  }

  const route = parseRoute();
  const pwaController = initializePwaController();

  if (route.mode === "html") {
    applyBackgroundModeFromUrl();
    applyFrameModeFromUrl();
  } else if (route.mode === "editor") {
    applyBackgroundModeFromUrl();
    applyFrameMode("none");
  } else {
    applyBackgroundMode("full");
    applyFrameMode("full");
  }

  document.body.classList.toggle("mode-canvas", route.mode === "canvas");
  document.body.classList.toggle("mode-editor", route.mode === "editor");

  if (route.mode === "test_e2e") {
    document.body.classList.remove("hydrating");
    mountE2ETestRunner(route.externalUrl);
    return;
  }

  if (route.mode === "editor") {
    try {
      await bootExternalEditor(route.editorSessionId, pwaController, registerCleanup);
    } finally {
      document.body.classList.remove("hydrating");
    }
    return;
  }

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

  const rerenderCurrent = async (): Promise<void> => {
    if (latestBytes.byteLength === 0) {
      return;
    }
    await apply(latestBytes, latestBaseUrl, latestAllowRawHtml);
  };

  document.body.classList.remove("is-editing");
  document.body.replaceChildren(view.shell);

  if (route.shared) {
    try {
      view.editorPane.remove();
    } catch {
      // Ignore missing editor host in readonly routes.
    }
  }

  if (!route.shared) {
    themeEditorLocal = await ensureThemeEditor();
    document.body.appendChild(themeEditorLocal.root);
  }

  if (!route.shared && !themeEditorViewListenerAttached && themeEditorLocal) {
    themeEditorLocal.root.addEventListener("theme-editor-toggle", (event) => {
      const open = (event as CustomEvent<{ open: boolean }>).detail.open;
      if (!open) return;
      document.body.classList.remove("is-editing");
    });
    themeEditorViewListenerAttached = true;
  }

  let bookTopicsMenu: BookTopicsMenuHandle | null = null;
  if (route.mode === "html" && route.bookEntryUrl) {
    bookTopicsMenu = createBookTopicsMenu();
    document.body.appendChild(bookTopicsMenu.root);
    registerCleanup(() => {
      bookTopicsMenu?.destroy();
      bookTopicsMenu?.root.remove();
      bookTopicsMenu = null;
    });
  }

  let resolved: MarkdownFetchResult | null = null;
  let bookLoader: BookLoader | null = null;
  let currentBookPartUrl: string | null = null;
  let currentSourceUrl: string | null = null;

  try {
    if (route.bookEntryUrl) {
      bookLoader = new BookLoader(route.bookEntryUrl.toString());
      if (route.bookPrefetchPayload) {
        const prefetched = await decodeBookPrefetchPayload(
          route.bookPrefetchPayload,
        );
        if (prefetched && prefetched.entryUrl === bookLoader.getEntryUrl()) {
          bookLoader.seedPrefetchedParts(prefetched.parts);
        }
      }
      const initialTarget =
        route.bookPartUrl?.toString() ?? bookLoader.getEntryUrl();
      const initialPart = await bookLoader.loadPart(initialTarget);
      currentBookPartUrl = initialPart.url;
      currentSourceUrl = initialPart.url;
      resolved = {
        bytes: initialPart.bytes,
        baseUrl: initialPart.baseUrl,
      };
      bookLoader.prefetchInBackground();
    } else if (route.dataPayload) {
      const decoded = await decodeBase64Markdown(route.dataPayload);
      resolved = {
        bytes: decoded,
        baseUrl: sanitizeSharedDataBaseUrl(window.location.href),
      };
      currentSourceUrl = null;
    } else {
      resolved = await fetchMarkdown(route.externalUrl);
      currentSourceUrl = route.externalUrl?.toString() ?? null;
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
        currentSourceUrl = null;
      } catch (fallbackError) {
        console.error("Unable to load fallback markdown", fallbackError);
      }
    }
  } finally {
    document.body.classList.remove("hydrating");
  }

  if (!resolved) {
    return;
  }

  const initialMarkdown = TD.decode(resolved.bytes);
  const loadedSnapshot = bookLoader
    ? createBookEditorDocumentSnapshot({
        entryUrl: bookLoader.getEntryUrl(),
        currentPartUrl: currentBookPartUrl,
        parts: prioritizeCurrentBookPart(
          bookLoader.getCachedPartsSnapshot(),
          currentBookPartUrl,
        ),
      })
    : createSingleEditorDocumentSnapshot({
        markdown: initialMarkdown,
        baseUrl: resolved.baseUrl,
        sourceUrl: currentSourceUrl,
      });
  const draftSourceKey = buildEditorDraftSourceKey({
    mode: route.mode,
    sourceUrl: currentSourceUrl,
    bookEntryUrl: bookLoader?.getEntryUrl() ?? null,
    dataPayload: route.dataPayload,
    locationHref: window.location.href,
  });
  const restoredDraft = route.shared
    ? null
    : await loadEditorDraftSnapshot(draftSourceKey).catch((error) => {
        console.warn("Unable to restore editor draft", error);
        return null;
      });
  const initialSnapshot = restoredDraft ?? loadedSnapshot;

  const controller = new EditorStateController(initialSnapshot);

  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let renderInFlight = false;
  let rerenderRequested = false;
  let latestSnapshot = controller.getSnapshot();
  let previousSnapshot = latestSnapshot;
  let pendingAnchor = window.location.hash.replace(/^#/, "");
  let shouldScrollAfterPageChange = false;
  let activeEditorLine = 1;
  let lineTrackingFrame = 0;

  const requestLineTracking = (line = activeEditorLine): void => {
    activeEditorLine = Math.max(1, line);
    if (route.mode !== "html") {
      return;
    }
    if (lineTrackingFrame) {
      cancelAnimationFrame(lineTrackingFrame);
    }
    lineTrackingFrame = requestAnimationFrame(() => {
      lineTrackingFrame = 0;
      const currentPage = getCurrentEditorPage(latestSnapshot);
      if (!currentPage) {
        return;
      }
      trackMarkdownLineInHtmlView(
        view as HtmlView,
        currentPage.markdown,
        activeEditorLine,
      );
    });
  };

  async function renderCurrentSnapshot(): Promise<void> {
    if (renderInFlight) {
      rerenderRequested = true;
      return;
    }

    renderInFlight = true;
    try {
      do {
        rerenderRequested = false;
        const snapshot = latestSnapshot;
        const currentPage = getCurrentEditorPage(snapshot);
        if (!currentPage) {
          return;
        }

        latestAllowRawHtml = allowRawHtml;
        latestBaseUrl = currentPage.baseUrl;
        currentBookPartUrl = snapshot.mode === "book" ? currentPage.url : null;
        currentSourceUrl = currentPage.sourceUrl;

        await apply(u8(currentPage.markdown), currentPage.baseUrl, allowRawHtml);

        if (route.mode === "html") {
          const htmlView = view as HtmlView;
          if (snapshot.mode === "book" && bookLoader) {
            rewriteBookLinksInViewer(htmlView, bookLoader, currentPage.baseUrl, {
              sharedMode: route.shared,
            });
          }

          const anchor = pendingAnchor;
          const shouldScrollTop = shouldScrollAfterPageChange && !anchor;
          pendingAnchor = "";
          shouldScrollAfterPageChange = false;

          if (anchor) {
            scrollToHeadingAnchor(htmlView, anchor);
          } else if (snapshot.mode === "book" && shouldScrollTop) {
            scrollToTop();
          } else if (document.body.classList.contains("is-editing")) {
            requestLineTracking();
          }
        }
      } while (rerenderRequested);
    } catch (error) {
      console.error("Failed to render markdown snapshot", error);
    } finally {
      renderInFlight = false;
    }
  }

  const requestDebouncedRender = (): void => {
    if (renderTimer) {
      clearTimeout(renderTimer);
    }
    renderTimer = setTimeout(() => {
      renderTimer = null;
      void renderCurrentSnapshot();
    }, 80);
  };

  const requestImmediateRender = (): void => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    void renderCurrentSnapshot();
  };

  async function navigateToBookPart(
    targetPartUrl: string,
    anchor: string,
    pushHistory: boolean,
  ): Promise<void> {
    if (!bookLoader) {
      return;
    }

    pendingAnchor = anchor;
    shouldScrollAfterPageChange = !anchor;

    const existingPage = controller.findPageByUrl(targetPartUrl);
    if (existingPage) {
      controller.setCurrentPage(existingPage.id);
      if (pushHistory) {
        const next = buildBookUrl(
          bookLoader.getEntryUrl(),
          existingPage.url,
          anchor,
          {
            sharedMode: route.shared,
            sharedBookPrefetchPayload: null,
          },
        );
        window.history.pushState(
          { bookPartUrl: existingPage.url, bookAnchor: anchor },
          "",
          next,
        );
      }
      return;
    }

    if (controller.isRemovedUrl(targetPartUrl)) {
      displayError("That chapter was removed from the local draft");
      return;
    }

    const nextPart = await bookLoader.loadPart(targetPartUrl);
    const nextPage = controller.upsertBookPart(nextPart, true);
    if (!nextPage) {
      throw new Error("Unable to merge chapter into local editor state");
    }

    if (pushHistory) {
      const next = buildBookUrl(bookLoader.getEntryUrl(), nextPage.url, anchor, {
        sharedMode: route.shared,
        sharedBookPrefetchPayload: null,
      });
      window.history.pushState(
        { bookPartUrl: nextPage.url, bookAnchor: anchor },
        "",
        next,
      );
    }

    bookLoader.prefetchInBackground();
  }

  const refreshBookTopicsMenu = (snapshot: EditorDocumentSnapshot): void => {
    if (route.mode !== "html" || snapshot.mode !== "book" || !bookTopicsMenu) {
      return;
    }

    const htmlView = view as HtmlView;
    bookTopicsMenu.update(htmlView.viewer, {
      contents: buildEditorBookContentLinks(snapshot),
      onSelectContent: (targetPartUrl) => {
        void navigateToBookPart(targetPartUrl, "", true).catch((error) => {
          console.error("Unable to open selected chapter", error);
          displayError("Unable to open selected chapter");
        });
      },
    });
  };

  refreshBookTopicsMenu(latestSnapshot);
  await renderCurrentSnapshot();

  const stopSnapshotSubscription = controller.subscribe((snapshot) => {
    latestSnapshot = snapshot;
    refreshBookTopicsMenu(snapshot);

    const currentPage = getCurrentEditorPage(snapshot);
    const previousPage = getCurrentEditorPage(previousSnapshot);
    const pageChanged = currentPage?.id !== previousPage?.id;
    const contentChanged =
      previousPage?.markdown !== currentPage?.markdown ||
      previousPage?.baseUrl !== currentPage?.baseUrl ||
      previousPage?.url !== currentPage?.url;

    previousSnapshot = snapshot;

    if (pageChanged) {
      shouldScrollAfterPageChange ||= !pendingAnchor;
      requestImmediateRender();
      return;
    }

    if (contentChanged) {
      requestDebouncedRender();
    }
  });
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveDraftNow = (): void => {
    if (route.shared) {
      return;
    }
    const snapshot = controller.getSnapshot();
    void saveEditorDraftSnapshot(draftSourceKey, snapshot).catch((error) => {
      console.warn("Unable to save editor draft", error);
    });
  };
  const scheduleDraftSave = (): void => {
    if (route.shared) {
      return;
    }
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
    }
    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = null;
      saveDraftNow();
    }, 250);
  };
  const stopDraftSubscription = controller.subscribe(() => {
    scheduleDraftSave();
  });
  registerCleanup(() => {
    stopSnapshotSubscription();
    stopDraftSubscription();
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
      saveDraftNow();
    }
    if (lineTrackingFrame) {
      cancelAnimationFrame(lineTrackingFrame);
      lineTrackingFrame = 0;
    }
  });

  let editorSessionId: string | null = null;
  let editorWindowHandle: ReturnType<typeof createEditorWindow> | null = null;
  let externalEditorWindow: Window | null = null;

  const setEditorOpen = (open: boolean): void => {
    if (!editorWindowHandle || route.shared) {
      return;
    }
    document.body.classList.toggle("is-editing", open);
    editorWindowHandle.setOpen(open);
    if (open) {
      editorWindowHandle.focusEditor();
      themeEditorLocal?.close();
      requestLineTracking();
    } else {
      applyEditorDockLayout({
        open: false,
        dockPlacement: "floating",
        rect: null,
      });
    }
  };

  if (!route.shared) {
    editorSessionId = createEditorSessionId();
    const bridge = connectEditorSessionBridge({
      sessionId: editorSessionId,
      mode: "host",
      controller,
    });
    registerCleanup(() => bridge.destroy());
    registerCleanup(() => bridge.flushSnapshot());

    editorWindowHandle = createEditorWindow({
      host: view.editorPane,
      textarea: view.textarea,
      controller,
      onRequestClose: () => {
        setEditorOpen(false);
      },
      onRequestOpenExternal: () => {
        bridge.flushSnapshot();
        const popupUrl = buildExternalEditorUrl(editorSessionId!);
        externalEditorWindow = window.open(
          popupUrl.toString(),
          "smdp-editor",
          "popup=yes,width=1240,height=900,resizable=yes,scrollbars=no",
        );
        if (!externalEditorWindow) {
          displayError("Popup blocked; allow popups to use the external editor");
          return;
        }
        externalEditorWindow.focus();
      },
      onRequestInstall: async () => {
        await pwaController.promptInstall();
      },
      onActiveLineChange: (line) => {
        if (document.body.classList.contains("is-editing")) {
          requestLineTracking(line);
        }
      },
      onLayoutChange: applyEditorDockLayout,
      subscribeInstallAvailability: (listener) =>
        pwaController.subscribe(listener),
    });
    registerCleanup(() => {
      applyEditorDockLayout({
        open: false,
        dockPlacement: "floating",
        rect: null,
      });
      editorWindowHandle?.destroy();
    });

    if (themeEditorLocal) {
      const { createFabMenu } = await loadUiModule();
      const fabMenu = createFabMenu(view, themeEditorLocal, {
        onToggleEditor: () => {
          setEditorOpen(!document.body.classList.contains("is-editing"));
        },
        enableLoadUrlEmbed:
          route.mode === "html" &&
          !route.dataPayload &&
          (route.externalUrl !== null || route.bookEntryUrl !== null),
        getCurrentLoadUrl: () => {
          const snapshot = controller.getSnapshot();
          const currentPage = getCurrentEditorPage(snapshot);
          return currentPage?.sourceUrl ?? null;
        },
        buildHtmlExportSource: async () => {
          const snapshot = controller.getSnapshot();
          const currentPage = getCurrentEditorPage(snapshot);
          if (snapshot.mode !== "book") return null;
          return buildInlineBookEmbedHtmlSource(
            snapshot,
            currentPage?.url ?? null,
            allowRawHtml,
          );
        },
        buildInlineEmbedHtmlSource: async () => {
          const snapshot = controller.getSnapshot();
          const currentPage = getCurrentEditorPage(snapshot);
          if (snapshot.mode !== "book") return null;
          return buildInlineBookEmbedHtmlSource(
            snapshot,
            currentPage?.url ?? null,
            allowRawHtml,
          );
        },
        getBookEmbedContext: async () => {
          const snapshot = controller.getSnapshot();
          if (snapshot.mode !== "book" || !snapshot.entryUrl) {
            return null;
          }
          const currentPage = getCurrentEditorPage(snapshot);
          const payload = await encodeBookPrefetchPayload(
            snapshot.entryUrl,
            prioritizeCurrentBookPart(
              snapshotToBookPrefetchParts(snapshot),
              currentPage?.url ?? null,
            ),
          );
          return {
            entryUrl: snapshot.entryUrl,
            prefetchPayload: payload,
          };
        },
      });
      document.body.appendChild(fabMenu);
    }
  }

  if (bookLoader && route.mode === "html") {
    const htmlView = view as HtmlView;

    const onBookLinkClick = (event: Event): void => {
      if (!(event instanceof MouseEvent)) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest("a[data-book-part]") as HTMLAnchorElement | null;
      if (!link) return;
      if (!shouldHandleBookLinkClick(event, link)) return;
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
    registerCleanup(() =>
      htmlView.viewer.removeEventListener("click", onBookLinkClick),
    );

    const onBookPopState = (): void => {
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
