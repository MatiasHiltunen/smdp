const MARKDOWN_EXT_RE = /\.(md|markdown|mdown|mdx)$/i;
const IMAGE_EXT_RE = /\.(apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i;

function splitPathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function fallbackTitleFromPath(pathname: string): string {
  const segments = splitPathSegments(pathname);
  const last = segments[segments.length - 1] ?? "Untitled";
  return decodeURIComponent(last);
}

export function isLikelyMarkdownPath(pathname: string): boolean {
  const clean = pathname.trim();
  if (!clean) return false;
  if (MARKDOWN_EXT_RE.test(clean)) return true;
  const fileName = fallbackTitleFromPath(clean).toLowerCase();
  return fileName === "readme" || fileName === "readme.txt";
}

export function normalizeGitHubUrlToRaw(urlLike: string): string {
  let parsed: URL;
  try {
    parsed = new URL(urlLike);
  } catch {
    return urlLike;
  }

  if (parsed.hostname === "raw.githubusercontent.com") {
    return parsed.toString();
  }

  if (parsed.hostname !== "github.com") {
    return parsed.toString();
  }

  const segments = splitPathSegments(parsed.pathname);
  if (segments.length < 5) {
    return parsed.toString();
  }

  const owner = segments[0];
  const repo = segments[1];
  const marker = segments[2];
  const ref = segments[3];
  const restPath = segments.slice(4).join("/");

  if (!owner || !repo || !ref || !restPath) {
    return parsed.toString();
  }

  if (marker !== "blob" && marker !== "raw") {
    return parsed.toString();
  }

  const lowerPath = restPath.toLowerCase();
  const shouldNormalize =
    MARKDOWN_EXT_RE.test(lowerPath) || IMAGE_EXT_RE.test(lowerPath);
  if (!shouldNormalize) {
    return parsed.toString();
  }

  const normalized = new URL(
    `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${restPath}`,
  );
  normalized.search = parsed.search;
  normalized.hash = parsed.hash;
  return normalized.toString();
}

export function canonicalizeMarkdownDocumentUrl(
  urlLike: string,
  baseUrl?: string,
): string | null {
  let resolved: URL;
  try {
    resolved = baseUrl ? new URL(urlLike, baseUrl) : new URL(urlLike);
  } catch {
    return null;
  }

  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return null;
  }

  const normalized = new URL(normalizeGitHubUrlToRaw(resolved.toString()));
  normalized.search = "";
  normalized.hash = "";
  return normalized.toString();
}

export function canonicalizeBookLink(
  href: string,
  baseUrl: string,
): { canonicalUrl: string; anchor: string } | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  let resolved: URL;
  try {
    resolved = new URL(trimmed, baseUrl);
  } catch {
    return null;
  }

  const anchor = resolved.hash.startsWith("#")
    ? resolved.hash.slice(1)
    : resolved.hash;
  const canonicalUrl = canonicalizeMarkdownDocumentUrl(resolved.toString());
  if (!canonicalUrl) {
    return null;
  }

  const canonical = new URL(canonicalUrl);
  if (!isLikelyMarkdownPath(canonical.pathname)) {
    return null;
  }

  return {
    canonicalUrl,
    anchor,
  };
}
