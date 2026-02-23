import { TD, TE } from "../parser/constants";
import { fetchMarkdown } from "./fetch";
import {
  canonicalizeBookLink,
  canonicalizeMarkdownDocumentUrl,
} from "./github-url";

export type BookPart = {
  url: string;
  baseUrl: string;
  bytes: Uint8Array;
  markdown: string;
  title: string;
  discoveredParts: readonly string[];
};

export type BookPrefetchSnapshotPart = {
  url: string;
  baseUrl: string;
  markdown: string;
};

const INLINE_LINK_RE = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const DEFAULT_PREFETCH_CONCURRENCY = 4;
const MAX_BOOK_PARTS = 512;
const MAX_PREFETCH_PARTS_PER_PASS = 64;
const MAX_DISCOVERED_LINKS_PER_PART = 256;

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? parsed.hostname;
    return decodeURIComponent(last);
  } catch {
    return "Untitled";
  }
}

function extractTitle(markdown: string, fallbackUrl: string): string {
  const lines = markdown.split(/\r?\n/);
  const scanLimit = Math.min(lines.length, 24);
  for (let i = 0; i < scanLimit; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("#")) continue;
    const title = trimmed.replace(/^#+\s*/, "").trim();
    if (title) return title;
  }
  return titleFromUrl(fallbackUrl);
}

function rawGithubScopePrefix(url: URL): string | null {
  if (url.hostname !== "raw.githubusercontent.com") {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 3) {
    return null;
  }
  return `/${segments[0]}/${segments[1]}/${segments[2]}/`;
}

export function discoverBookLinks(
  markdown: string,
  baseUrl: string,
  maxLinks: number = Number.POSITIVE_INFINITY,
): string[] {
  const discovered: string[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(INLINE_LINK_RE)) {
    const index = match.index ?? 0;
    // Skip image links: ![alt](src)
    if (index > 0 && markdown[index - 1] === "!") {
      continue;
    }
    const href = match[1];
    const target = canonicalizeBookLink(href, baseUrl);
    if (!target || seen.has(target.canonicalUrl)) continue;
    seen.add(target.canonicalUrl);
    discovered.push(target.canonicalUrl);
    if (discovered.length >= maxLinks) {
      break;
    }
  }

  return discovered;
}

export class BookLoader {
  private readonly entryUrl: string;
  private readonly sourceOrigin: string;
  private readonly sourcePathPrefix: string | null;
  private readonly knownOrder: string[] = [];
  private readonly knownSet = new Set<string>();
  private readonly parts = new Map<string, BookPart>();
  private readonly failures = new Map<string, Error>();
  private readonly inFlight = new Map<string, Promise<BookPart>>();
  private readonly prefetchClaimed = new Set<string>();
  private prefetchTask: Promise<void> | null = null;

  constructor(entryUrl: string) {
    const canonicalEntry = canonicalizeMarkdownDocumentUrl(entryUrl);
    if (!canonicalEntry) {
      throw new Error("Book entry URL is invalid");
    }
    this.entryUrl = canonicalEntry;
    const parsedEntry = new URL(canonicalEntry);
    this.sourceOrigin = parsedEntry.origin;
    this.sourcePathPrefix = rawGithubScopePrefix(parsedEntry);
    this.registerKnownPart(canonicalEntry);
  }

  getEntryUrl(): string {
    return this.entryUrl;
  }

  getKnownParts(): readonly string[] {
    return this.knownOrder;
  }

  getPart(url: string): BookPart | undefined {
    const canonical = canonicalizeMarkdownDocumentUrl(url);
    return canonical ? this.parts.get(canonical) : undefined;
  }

  getCachedPartsSnapshot(): BookPrefetchSnapshotPart[] {
    const snapshot: BookPrefetchSnapshotPart[] = [];
    for (const url of this.knownOrder) {
      const part = this.parts.get(url);
      if (!part) continue;
      snapshot.push({
        url: part.url,
        baseUrl: part.baseUrl,
        markdown: part.markdown,
      });
    }
    return snapshot;
  }

  getPartTitle(url: string): string {
    const part = this.getPart(url);
    if (part) return part.title;
    return titleFromUrl(url);
  }

  isKnownPart(url: string): boolean {
    const canonical = canonicalizeMarkdownDocumentUrl(url);
    return canonical ? this.knownSet.has(canonical) : false;
  }

  registerNavigablePart(url: string): string | null {
    const canonical = canonicalizeMarkdownDocumentUrl(url, this.entryUrl);
    if (!canonical) return null;
    if (!this.isSameSourcePart(canonical)) return null;
    this.registerKnownPart(canonical);
    return canonical;
  }

  seedPrefetchedParts(parts: readonly BookPrefetchSnapshotPart[]): void {
    for (const part of parts) {
      const canonicalUrl = this.registerNavigablePart(part.url);
      if (!canonicalUrl) continue;
      if (this.parts.has(canonicalUrl)) continue;
      if (typeof part.markdown !== "string" || part.markdown.length === 0) {
        continue;
      }

      const canonicalBaseUrl =
        canonicalizeMarkdownDocumentUrl(part.baseUrl, canonicalUrl) ??
        canonicalUrl;
      const discovered = discoverBookLinks(
        part.markdown,
        canonicalBaseUrl,
        MAX_DISCOVERED_LINKS_PER_PART,
      );
      const discoveredParts: string[] = [];
      for (const discoveredUrl of discovered) {
        const canonicalDiscovered = this.registerNavigablePart(discoveredUrl);
        if (!canonicalDiscovered) continue;
        discoveredParts.push(canonicalDiscovered);
      }

      const seededPart: BookPart = {
        url: canonicalUrl,
        baseUrl: canonicalBaseUrl,
        bytes: TE.encode(part.markdown),
        markdown: part.markdown,
        title: extractTitle(part.markdown, canonicalUrl),
        discoveredParts,
      };
      this.parts.set(canonicalUrl, seededPart);
      this.failures.delete(canonicalUrl);
      this.prefetchClaimed.delete(canonicalUrl);
    }
  }

  async loadPart(url: string): Promise<BookPart> {
    const canonical = canonicalizeMarkdownDocumentUrl(url, this.entryUrl);
    if (!canonical) {
      throw new Error(`Invalid book part URL: ${url}`);
    }

    this.registerKnownPart(canonical);

    const cached = this.parts.get(canonical);
    if (cached) return cached;

    const inFlight = this.inFlight.get(canonical);
    if (inFlight) return inFlight;

    const task = this.fetchPart(canonical).finally(() => {
      this.inFlight.delete(canonical);
      this.prefetchClaimed.delete(canonical);
    });
    this.inFlight.set(canonical, task);
    return task;
  }

  prefetchInBackground(concurrency = DEFAULT_PREFETCH_CONCURRENCY): void {
    if (this.prefetchTask) {
      return;
    }

    this.prefetchTask = this.prefetchAll(concurrency).finally(() => {
      this.prefetchTask = null;
      if (this.hasPendingPrefetch()) {
        this.prefetchInBackground(concurrency);
      }
    });
  }

  private hasPendingPrefetch(): boolean {
    for (const url of this.knownOrder) {
      if (this.parts.has(url)) continue;
      if (this.failures.has(url)) continue;
      if (this.inFlight.has(url)) continue;
      return true;
    }
    return false;
  }

  private claimNextPrefetchTarget(): string | null {
    for (const url of this.knownOrder) {
      if (this.parts.has(url)) continue;
      if (this.failures.has(url)) continue;
      if (this.inFlight.has(url)) continue;
      if (this.prefetchClaimed.has(url)) continue;
      this.prefetchClaimed.add(url);
      return url;
    }
    return null;
  }

  private async prefetchAll(concurrency: number): Promise<void> {
    const workers: Promise<void>[] = [];
    const workerCount = Math.max(1, concurrency | 0);
    let remaining = MAX_PREFETCH_PARTS_PER_PASS;

    for (let i = 0; i < workerCount; i++) {
      workers.push(
        (async () => {
          while (true) {
            if (remaining <= 0) break;
            const target = this.claimNextPrefetchTarget();
            if (!target) break;
            remaining -= 1;
            try {
              await this.loadPart(target);
            } catch {
              // Ignore failed prefetches; explicit navigation can retry.
            } finally {
              this.prefetchClaimed.delete(target);
            }
          }
        })(),
      );
    }

    await Promise.all(workers);
  }

  private registerKnownPart(url: string): void {
    if (this.knownSet.has(url)) return;
    if (this.knownOrder.length >= MAX_BOOK_PARTS) return;
    this.knownSet.add(url);
    this.knownOrder.push(url);
  }

  private isSameSourcePart(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== this.sourceOrigin) {
        return false;
      }
      if (!this.sourcePathPrefix) {
        return true;
      }
      return parsed.pathname.startsWith(this.sourcePathPrefix);
    } catch {
      return false;
    }
  }

  private async fetchPart(canonicalUrl: string): Promise<BookPart> {
    try {
      const result = await fetchMarkdown(new URL(canonicalUrl));
      const markdown = TD.decode(result.bytes);
      const discoveredParts = discoverBookLinks(
        markdown,
        result.baseUrl,
        MAX_DISCOVERED_LINKS_PER_PART,
      );
      const navigableDiscoveredParts: string[] = [];
      for (const partUrl of discoveredParts) {
        const canonicalPart = this.registerNavigablePart(partUrl);
        if (!canonicalPart) continue;
        navigableDiscoveredParts.push(canonicalPart);
      }

      const part: BookPart = {
        url: canonicalUrl,
        baseUrl: result.baseUrl,
        bytes: result.bytes,
        markdown,
        title: extractTitle(markdown, canonicalUrl),
        discoveredParts: navigableDiscoveredParts,
      };
      this.parts.set(canonicalUrl, part);
      return part;
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      this.failures.set(canonicalUrl, normalized);
      throw normalized;
    }
  }
}
