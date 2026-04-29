import type { BookContentLink } from "./book-topics";
import {
  discoverBookLinks,
  type BookPart,
  type BookPrefetchSnapshotPart,
} from "./book";
import { canonicalizeMarkdownDocumentUrl } from "./github-url";

export type EditorDocumentMode = "single" | "book";
export type EditorTitleMode = "derived" | "manual";
export type EditorPathMode = "derived" | "manual";

export type EditorPage = {
  id: string;
  title: string;
  titleMode: EditorTitleMode;
  url: string;
  baseUrl: string;
  markdown: string;
  sourceUrl: string | null;
  synthetic: boolean;
  pathMode: EditorPathMode;
};

export type EditorDocumentSnapshot = {
  mode: EditorDocumentMode;
  entryUrl: string | null;
  currentPageId: string;
  pages: EditorPage[];
  removedUrls: string[];
};

export type EditorPatch =
  | { type: "replace-snapshot"; snapshot: EditorDocumentSnapshot }
  | { type: "set-current-page"; pageId: string }
  | { type: "update-page-markdown"; pageId: string; markdown: string }
  | { type: "update-page-title"; pageId: string; title: string }
  | {
      type: "update-page-path";
      pageId: string;
      url: string;
      baseUrl: string;
      pathMode: EditorPathMode;
    }
  | { type: "add-page"; page: EditorPage; afterPageId: string | null }
  | {
      type: "remove-page";
      pageId: string;
      removedUrl: string | null;
      nextCurrentPageId: string | null;
    }
  | { type: "upsert-page"; page: EditorPage; makeCurrent: boolean };

type SnapshotListener = (snapshot: EditorDocumentSnapshot) => void;
type PatchListener = (patch: EditorPatch) => void;

const DEFAULT_EDITOR_ORIGIN = "https://editor.smdp.app/";
const PAGE_TITLE_FALLBACK = "Untitled page";
const MARKDOWN_EXT_RE = /\.(md|markdown|mdown|mdx)$/i;

function toFallbackDocumentUrl(
  input: string | undefined,
  fallbackOrigin: string,
): string {
  const canonical = input ? canonicalizeMarkdownDocumentUrl(input) : null;
  if (canonical) {
    return canonical;
  }
  const base = new URL(fallbackOrigin || DEFAULT_EDITOR_ORIGIN);
  return new URL("document.md", base).toString();
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? PAGE_TITLE_FALLBACK;
    return decodeURIComponent(last).replace(/\.(md|markdown|mdown|mdx)$/i, "");
  } catch {
    return PAGE_TITLE_FALLBACK;
  }
}

function extractMarkdownTitle(markdown: string, fallback: string): string {
  const lines = markdown.split(/\r?\n/);
  let bestLevel = Number.POSITIVE_INFINITY;
  let bestTitle = "";

  for (const line of lines) {
    const trimmed = line.trim();
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(trimmed);
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].replace(/\s+#+\s*$/, "").trim();
    if (!title) continue;
    if (level < bestLevel) {
      bestLevel = level;
      bestTitle = title;
      if (level === 1) {
        break;
      }
    }
  }

  return bestTitle || fallback;
}

function createPageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `page-${Math.random().toString(36).slice(2, 10)}`;
}

export function slugifyEditorPageTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureMarkdownPathname(pathname: string): string {
  if (MARKDOWN_EXT_RE.test(pathname)) {
    return pathname;
  }
  return `${pathname}.md`;
}

function normalizeRelativeBookPathInput(value: string): string {
  const cleaned = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!cleaned) {
    return "page.md";
  }

  const segments = cleaned.split("/").filter(Boolean);
  const normalizedSegments = segments.map((segment) => {
    const withoutExtension = segment.replace(MARKDOWN_EXT_RE, "");
    return slugifyEditorPageTitle(withoutExtension) || "page";
  });
  return ensureMarkdownPathname(normalizedSegments.join("/"));
}

function buildUniqueBookPageUrlFromRelativePath(
  entryUrl: string,
  relativePath: string,
  pages: readonly EditorPage[],
  excludePageId: string | null = null,
): string {
  const normalizedPath = normalizeRelativeBookPathInput(relativePath);
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  const directory =
    lastSlashIndex === -1 ? "" : normalizedPath.slice(0, lastSlashIndex + 1);
  const fileName =
    lastSlashIndex === -1
      ? normalizedPath
      : normalizedPath.slice(lastSlashIndex + 1);
  const extensionMatch = fileName.match(MARKDOWN_EXT_RE);
  const extension = extensionMatch?.[0] ?? ".md";
  const stem = fileName.slice(0, Math.max(1, fileName.length - extension.length));
  const base = new URL(entryUrl);
  let attempt = 0;

  while (true) {
    const candidateName =
      attempt === 0 ? `${stem}${extension}` : `${stem}-${attempt + 1}${extension}`;
    const candidate = new URL(`${directory}${candidateName}`, base).toString();
    const exists = pages.some(
      (page) => page.id !== excludePageId && page.url === candidate,
    );
    if (!exists) {
      return candidate;
    }
    attempt += 1;
  }
}

function buildUniqueBookPageUrl(
  entryUrl: string,
  title: string,
  pages: readonly EditorPage[],
  excludePageId: string | null = null,
): string {
  return buildUniqueBookPageUrlFromRelativePath(
    entryUrl,
    slugifyEditorPageTitle(title) || "page",
    pages,
    excludePageId,
  );
}

function toEditorRelativeBookPath(
  entryUrl: string | null,
  targetUrl: string,
): string | null {
  if (!entryUrl) {
    return null;
  }

  try {
    const entry = new URL(entryUrl);
    const target = new URL(targetUrl);
    if (entry.origin !== target.origin) {
      return null;
    }

    const entryDirectory = entry.pathname.replace(/[^/]*$/, "");
    if (!target.pathname.startsWith(entryDirectory)) {
      return null;
    }

    const relativePath = target.pathname.slice(entryDirectory.length).replace(/^\/+/, "");
    return decodeURIComponent(relativePath);
  } catch {
    return null;
  }
}

function cloneSnapshot(snapshot: EditorDocumentSnapshot): EditorDocumentSnapshot {
  return {
    mode: snapshot.mode,
    entryUrl: snapshot.entryUrl,
    currentPageId: snapshot.currentPageId,
    pages: snapshot.pages.map((page) => ({ ...page })),
    removedUrls: [...snapshot.removedUrls],
  };
}

function normalizePageTitle(page: EditorPage): EditorPage {
  if (page.titleMode === "derived") {
    const fallback = titleFromUrl(page.url);
    return {
      ...page,
      title: extractMarkdownTitle(page.markdown, fallback),
    };
  }
  return page;
}

function normalizeSyntheticPagePath(
  snapshot: EditorDocumentSnapshot,
  page: EditorPage,
): EditorPage {
  if (
    snapshot.mode !== "book" ||
    !snapshot.entryUrl ||
    !page.synthetic ||
    page.pathMode !== "derived"
  ) {
    return page;
  }

  const nextUrl = buildUniqueBookPageUrl(
    snapshot.entryUrl,
    page.title,
    snapshot.pages,
    page.id,
  );
  return {
    ...page,
    url: nextUrl,
    baseUrl: nextUrl,
  };
}

function normalizePageForSnapshot(
  snapshot: EditorDocumentSnapshot,
  page: EditorPage,
): EditorPage {
  return normalizeSyntheticPagePath(snapshot, normalizePageTitle(page));
}

function withNormalizedPages(
  snapshot: EditorDocumentSnapshot,
): EditorDocumentSnapshot {
  const next = cloneSnapshot(snapshot);
  next.pages = next.pages.map((page) => normalizePageForSnapshot(next, page));
  return next;
}

export function createSingleEditorDocumentSnapshot(options: {
  markdown: string;
  baseUrl?: string;
  fallbackOrigin?: string;
  sourceUrl?: string | null;
}): EditorDocumentSnapshot {
  const pageUrl = toFallbackDocumentUrl(options.baseUrl, options.fallbackOrigin ?? DEFAULT_EDITOR_ORIGIN);
  const page: EditorPage = {
    id: createPageId(),
    title: extractMarkdownTitle(options.markdown, titleFromUrl(pageUrl)),
    titleMode: "derived",
    url: pageUrl,
    baseUrl: pageUrl,
    markdown: options.markdown,
    sourceUrl: options.sourceUrl === undefined ? pageUrl : options.sourceUrl,
    synthetic: false,
    pathMode: "manual",
  };

  return {
    mode: "single",
    entryUrl: null,
    currentPageId: page.id,
    pages: [page],
    removedUrls: [],
  };
}

export function createBookSnapshotFromSingleDocument(
  snapshot: EditorDocumentSnapshot,
): EditorDocumentSnapshot {
  const currentPage = getCurrentEditorPage(snapshot) ?? snapshot.pages[0] ?? null;
  if (snapshot.mode === "book" || !currentPage) {
    return cloneSnapshot(snapshot);
  }

  return withNormalizedPages({
    mode: "book",
    entryUrl: currentPage.url,
    currentPageId: currentPage.id,
    pages: snapshot.pages.map((page) => ({
      ...page,
      sourceUrl: page.sourceUrl ?? page.url,
      synthetic: false,
      pathMode: "manual",
    })),
    removedUrls: [],
  });
}

function createBookEditorPageFromSnapshotPart(part: BookPrefetchSnapshotPart): EditorPage {
  const url = canonicalizeMarkdownDocumentUrl(part.url) ?? part.url;
  const baseUrl =
    canonicalizeMarkdownDocumentUrl(part.baseUrl, url) ?? part.baseUrl;
  return {
    id: createPageId(),
    title: extractMarkdownTitle(part.markdown, titleFromUrl(url)),
    titleMode: "derived",
    url,
    baseUrl,
    markdown: part.markdown,
    sourceUrl: url,
    synthetic: false,
    pathMode: "manual",
  };
}

export function createBookEditorDocumentSnapshot(options: {
  entryUrl: string;
  currentPartUrl: string | null;
  parts: readonly BookPrefetchSnapshotPart[];
}): EditorDocumentSnapshot {
  const pages: EditorPage[] = [];
  const seenUrls = new Set<string>();

  for (const part of options.parts) {
    const page = createBookEditorPageFromSnapshotPart(part);
    if (seenUrls.has(page.url)) continue;
    seenUrls.add(page.url);
    pages.push(page);
  }

  if (pages.length === 0) {
    const emptyMarkdown = "# Book\n\nStart writing here.";
    const entryCanonical =
      canonicalizeMarkdownDocumentUrl(options.entryUrl) ?? options.entryUrl;
    pages.push({
      id: createPageId(),
      title: "Book",
      titleMode: "derived",
      url: entryCanonical,
      baseUrl: entryCanonical,
      markdown: emptyMarkdown,
      sourceUrl: entryCanonical,
      synthetic: false,
      pathMode: "manual",
    });
  }

  const currentCanonical = options.currentPartUrl
    ? canonicalizeMarkdownDocumentUrl(options.currentPartUrl, options.entryUrl)
    : null;
  const currentPageId =
    pages.find((page) => page.url === currentCanonical)?.id ?? pages[0].id;

  return {
    mode: "book",
    entryUrl: canonicalizeMarkdownDocumentUrl(options.entryUrl) ?? options.entryUrl,
    currentPageId,
    pages,
    removedUrls: [],
  };
}

export function getCurrentEditorPage(
  snapshot: EditorDocumentSnapshot,
): EditorPage | null {
  return snapshot.pages.find((page) => page.id === snapshot.currentPageId) ?? null;
}

export function getEditorPagePathValue(
  snapshot: EditorDocumentSnapshot,
  page: EditorPage,
): string {
  if (!page.synthetic) {
    return page.url;
  }

  return (
    toEditorRelativeBookPath(snapshot.entryUrl, page.url) ??
    page.url.split("/").pop() ??
    ""
  );
}

export function buildEditorBookContentLinks(
  snapshot: EditorDocumentSnapshot,
): BookContentLink[] {
  if (snapshot.mode !== "book") {
    return [];
  }

  const pageByUrl = new Map(snapshot.pages.map((page) => [page.url, page]));
  const removedUrls = new Set(snapshot.removedUrls);
  const referencedUrls = new Set<string>();
  const consumedUrls = new Set<string>();
  const currentPage = getCurrentEditorPage(snapshot);

  for (const page of snapshot.pages) {
    for (const childUrl of discoverBookLinks(page.markdown, page.baseUrl)) {
      if (!removedUrls.has(childUrl)) {
        referencedUrls.add(childUrl);
      }
    }
  }

  const buildNode = (
    url: string,
    parentPath: ReadonlySet<string>,
  ): BookContentLink | null => {
    if (removedUrls.has(url) || parentPath.has(url)) {
      return null;
    }

    const page = pageByUrl.get(url);
    const children: BookContentLink[] = [];
    const nextPath = new Set(parentPath);
    nextPath.add(url);
    consumedUrls.add(url);

    if (page) {
      for (const childUrl of discoverBookLinks(page.markdown, page.baseUrl)) {
        const childNode = buildNode(childUrl, nextPath);
        if (childNode) {
          children.push(childNode);
        }
      }
    }

    return {
      url,
      title: page?.title ?? titleFromUrl(url),
      isCurrent: currentPage?.url === url,
      ...(children.length > 0 ? { children } : {}),
    };
  };

  const orderedUrls: string[] = [];
  if (snapshot.entryUrl && !removedUrls.has(snapshot.entryUrl)) {
    orderedUrls.push(snapshot.entryUrl);
  }
  for (const page of snapshot.pages) {
    if (!orderedUrls.includes(page.url) && !removedUrls.has(page.url)) {
      orderedUrls.push(page.url);
    }
  }
  for (const referencedUrl of referencedUrls) {
    if (!orderedUrls.includes(referencedUrl) && !removedUrls.has(referencedUrl)) {
      orderedUrls.push(referencedUrl);
    }
  }

  const roots: BookContentLink[] = [];
  for (const url of orderedUrls) {
    if (consumedUrls.has(url)) {
      continue;
    }
    const node = buildNode(url, new Set<string>());
    if (node) {
      roots.push(node);
    }
  }
  return roots;
}

export function snapshotToBookPrefetchParts(
  snapshot: EditorDocumentSnapshot,
): BookPrefetchSnapshotPart[] {
  if (snapshot.mode !== "book") {
    return [];
  }
  return snapshot.pages.map((page) => ({
    url: page.url,
    baseUrl: page.baseUrl,
    markdown: page.markdown,
  }));
}

export class EditorStateController {
  private snapshot: EditorDocumentSnapshot;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly patchListeners = new Set<PatchListener>();

  constructor(snapshot: EditorDocumentSnapshot) {
    this.snapshot = withNormalizedPages(snapshot);
  }

  getSnapshot(): EditorDocumentSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  onPatch(listener: PatchListener): () => void {
    this.patchListeners.add(listener);
    return () => {
      this.patchListeners.delete(listener);
    };
  }

  replaceSnapshot(snapshot: EditorDocumentSnapshot): void {
    this.snapshot = withNormalizedPages(snapshot);
    this.emitSnapshot();
  }

  applyRemotePatch(patch: EditorPatch): void {
    this.applyPatch(patch, false);
  }

  setCurrentPage(pageId: string): void {
    this.applyPatch({ type: "set-current-page", pageId }, true);
  }

  updateCurrentMarkdown(markdown: string): void {
    const currentPage = getCurrentEditorPage(this.snapshot);
    if (!currentPage) return;
    this.applyPatch(
      { type: "update-page-markdown", pageId: currentPage.id, markdown },
      true,
    );
  }

  updateCurrentPageTitle(title: string): void {
    const currentPage = getCurrentEditorPage(this.snapshot);
    if (!currentPage) return;
    this.applyPatch(
      { type: "update-page-title", pageId: currentPage.id, title },
      true,
    );
  }

  updateCurrentSyntheticPagePath(pathValue: string): void {
    const currentPage = getCurrentEditorPage(this.snapshot);
    if (!currentPage || !currentPage.synthetic || this.snapshot.mode !== "book") {
      return;
    }

    const nextUrl = buildUniqueBookPageUrlFromRelativePath(
      this.snapshot.entryUrl ?? currentPage.baseUrl,
      pathValue,
      this.snapshot.pages,
      currentPage.id,
    );
    this.applyPatch(
      {
        type: "update-page-path",
        pageId: currentPage.id,
        url: nextUrl,
        baseUrl: nextUrl,
        pathMode: "manual",
      },
      true,
    );
  }

  addBookPage(afterPageId?: string | null): EditorPage | null {
    if (this.snapshot.mode !== "book" || !this.snapshot.entryUrl) {
      return null;
    }

    const proposedTitle = `Page ${this.snapshot.pages.length + 1}`;
    const markdown = `# ${proposedTitle}\n\nStart writing here.`;
    const url = buildUniqueBookPageUrl(
      this.snapshot.entryUrl,
      proposedTitle,
      this.snapshot.pages,
      null,
    );
    const page: EditorPage = {
      id: createPageId(),
      title: proposedTitle,
      titleMode: "derived",
      url,
      baseUrl: url,
      markdown,
      sourceUrl: null,
      synthetic: true,
      pathMode: "derived",
    };

    this.applyPatch(
      { type: "add-page", page, afterPageId: afterPageId ?? this.snapshot.currentPageId },
      true,
    );
    return page;
  }

  addPage(afterPageId?: string | null): EditorPage | null {
    if (this.snapshot.mode === "single") {
      this.applyPatch(
        {
          type: "replace-snapshot",
          snapshot: createBookSnapshotFromSingleDocument(this.snapshot),
        },
        true,
      );
    }
    return this.addBookPage(afterPageId);
  }

  removeCurrentBookPage(): void {
    if (this.snapshot.mode !== "book" || this.snapshot.pages.length <= 1) {
      return;
    }
    const currentPage = getCurrentEditorPage(this.snapshot);
    if (!currentPage) return;
    const index = this.snapshot.pages.findIndex((page) => page.id === currentPage.id);
    const fallback =
      this.snapshot.pages[index - 1] ??
      this.snapshot.pages[index + 1] ??
      null;
    this.applyPatch(
      {
        type: "remove-page",
        pageId: currentPage.id,
        removedUrl: currentPage.url,
        nextCurrentPageId: fallback?.id ?? null,
      },
      true,
    );
  }

  findPageByUrl(url: string): EditorPage | null {
    const canonical = canonicalizeMarkdownDocumentUrl(url, this.snapshot.entryUrl ?? undefined);
    if (!canonical) {
      return null;
    }
    return this.snapshot.pages.find((page) => page.url === canonical) ?? null;
  }

  isRemovedUrl(url: string): boolean {
    const canonical = canonicalizeMarkdownDocumentUrl(url, this.snapshot.entryUrl ?? undefined);
    if (!canonical) {
      return false;
    }
    return this.snapshot.removedUrls.includes(canonical);
  }

  upsertBookPart(part: BookPrefetchSnapshotPart | BookPart, makeCurrent = false): EditorPage | null {
    if (this.snapshot.mode !== "book") {
      return null;
    }
    const url = canonicalizeMarkdownDocumentUrl(part.url, this.snapshot.entryUrl ?? undefined);
    if (!url || this.snapshot.removedUrls.includes(url)) {
      return null;
    }
    const markdown = part.markdown;
    const baseUrl =
      canonicalizeMarkdownDocumentUrl(part.baseUrl, url) ?? part.baseUrl;
    const existing = this.snapshot.pages.find((page) => page.url === url);
    const page: EditorPage = {
      id: existing?.id ?? createPageId(),
      title:
        existing?.titleMode === "manual"
          ? existing.title
          : extractMarkdownTitle(markdown, titleFromUrl(url)),
      titleMode: existing?.titleMode ?? "derived",
      url,
      baseUrl,
      markdown,
      sourceUrl: url,
      synthetic: existing?.synthetic ?? false,
      pathMode: existing?.pathMode ?? "manual",
    };

    this.applyPatch({ type: "upsert-page", page, makeCurrent }, true);
    return page;
  }

  toBookPrefetchParts(): BookPrefetchSnapshotPart[] {
    return snapshotToBookPrefetchParts(this.snapshot);
  }

  private applyPatch(patch: EditorPatch, emitPatch: boolean): void {
    const next = cloneSnapshot(this.snapshot);

    switch (patch.type) {
      case "replace-snapshot": {
        this.snapshot = withNormalizedPages(patch.snapshot);
        this.emitSnapshot();
        if (emitPatch) {
          this.emitPatch(patch);
        }
        return;
      }
      case "set-current-page": {
        if (next.pages.some((page) => page.id === patch.pageId)) {
          next.currentPageId = patch.pageId;
        }
        break;
      }
      case "update-page-markdown": {
        next.pages = next.pages.map((page) =>
          page.id === patch.pageId
            ? { ...page, markdown: patch.markdown }
            : page,
        );
        break;
      }
      case "update-page-title": {
        next.pages = next.pages.map((page) =>
          page.id === patch.pageId
            ? { ...page, title: patch.title || PAGE_TITLE_FALLBACK, titleMode: "manual" }
            : page,
        );
        break;
      }
      case "update-page-path": {
        next.pages = next.pages.map((page) =>
          page.id === patch.pageId
            ? {
                ...page,
                url: patch.url,
                baseUrl: patch.baseUrl,
                pathMode: patch.pathMode,
              }
            : page,
        );
        break;
      }
      case "add-page": {
        const index =
          patch.afterPageId === null
            ? next.pages.length
            : Math.max(
                0,
                next.pages.findIndex((page) => page.id === patch.afterPageId) + 1,
              );
        next.pages.splice(index, 0, patch.page);
        next.currentPageId = patch.page.id;
        next.removedUrls = next.removedUrls.filter((url) => url !== patch.page.url);
        break;
      }
      case "remove-page": {
        next.pages = next.pages.filter((page) => page.id !== patch.pageId);
        if (patch.removedUrl && !next.removedUrls.includes(patch.removedUrl)) {
          next.removedUrls.push(patch.removedUrl);
        }
        if (patch.nextCurrentPageId && next.pages.some((page) => page.id === patch.nextCurrentPageId)) {
          next.currentPageId = patch.nextCurrentPageId;
        } else if (next.pages.length > 0) {
          next.currentPageId = next.pages[0].id;
        }
        break;
      }
      case "upsert-page": {
        const index = next.pages.findIndex((page) => page.url === patch.page.url || page.id === patch.page.id);
        if (index === -1) {
          next.pages.push(patch.page);
        } else {
          next.pages[index] = patch.page;
        }
        next.removedUrls = next.removedUrls.filter((url) => url !== patch.page.url);
        if (patch.makeCurrent) {
          next.currentPageId = patch.page.id;
        }
        break;
      }
      default:
        break;
    }

    this.snapshot = withNormalizedPages(next);
    this.emitSnapshot();
    if (emitPatch) {
      this.emitPatch(patch);
    }
  }

  private emitPatch(patch: EditorPatch): void {
    for (const listener of this.patchListeners) {
      listener(patch);
    }
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
