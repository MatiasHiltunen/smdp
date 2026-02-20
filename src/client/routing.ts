export type RenderMode = "html" | "canvas" | "test_e2e";

export type RouteDetails = {
  mode: RenderMode;
  externalUrl: URL | null;
  shared: boolean;
  dataPayload: string | null;
  bookEntryUrl: URL | null;
  bookPartUrl: URL | null;
};

function safeDecodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

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

function extractHashPayload(): string | null {
  const rawHash = window.location.hash || "";
  if (!rawHash || rawHash === "#") {
    return null;
  }

  const trimmed = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  if (!trimmed) {
    return null;
  }

  try {
    return decodeURIComponent(trimmed);
  } catch (error) {
    console.warn("Unable to decode hash payload", error);
    return trimmed;
  }
}

export function parseRoute(): RouteDetails {
  const rawPath = safeDecodePathname(window.location.pathname);
  const hashPayload = extractHashPayload();
  const query = new URLSearchParams(window.location.search);
  const testE2eQueryUrl = safeParseUrl(query.get("url"));

  // Shared (embed) mode: no FABs, no editor/theme UI, HTML render
  if (rawPath.startsWith("/shared/")) {
    const externalPart = rawPath.slice("/shared/".length);
    return {
      mode: "html",
      externalUrl: safeParseUrl(externalPart || null),
      shared: true,
      dataPayload: null,
      bookEntryUrl: null,
      bookPartUrl: null,
    };
  }

  if (rawPath === "/shared") {
    return {
      mode: "html",
      externalUrl: null,
      shared: true,
      dataPayload: null,
      bookEntryUrl: null,
      bookPartUrl: null,
    };
  }

  if (rawPath === "/data" || rawPath.startsWith("/data/")) {
    const payloadFromPath = rawPath.startsWith("/data/")
      ? rawPath.slice("/data/".length) || null
      : null;
    const payload = payloadFromPath || hashPayload;
    return {
      mode: "html",
      externalUrl: null,
      shared: true,
      dataPayload: payload,
      bookEntryUrl: null,
      bookPartUrl: null,
    };
  }

  if (rawPath.startsWith("/book/")) {
    const entryPart = rawPath.slice("/book/".length);
    const entryUrl = safeParseUrl(entryPart || null);
    const partUrl = safeParseUrl(query.get("part"));
    return {
      mode: "html",
      externalUrl: partUrl ?? entryUrl,
      shared: false,
      dataPayload: null,
      bookEntryUrl: entryUrl,
      bookPartUrl: partUrl,
    };
  }

  if (rawPath === "/book") {
    return {
      mode: "html",
      externalUrl: null,
      shared: false,
      dataPayload: null,
      bookEntryUrl: null,
      bookPartUrl: null,
    };
  }

  if (rawPath.startsWith("/canvas/")) {
    const externalPart = rawPath.slice("/canvas/".length);
    return {
      mode: "canvas",
      externalUrl: safeParseUrl(externalPart || null),
      shared: false,
      dataPayload: null,
      bookEntryUrl: null,
      bookPartUrl: null,
    };
  }

  if (rawPath === "/canvas") {
    return {
      mode: "canvas",
      externalUrl: null,
      shared: false,
      dataPayload: null,
      bookEntryUrl: null,
      bookPartUrl: null,
    };
  }

  if (rawPath.startsWith("/test_e2e/")) {
    const externalPart = rawPath.slice("/test_e2e/".length);
    return {
      mode: "test_e2e",
      externalUrl: safeParseUrl(externalPart || null) ?? testE2eQueryUrl,
      shared: false,
      dataPayload: null,
      bookEntryUrl: null,
      bookPartUrl: null,
    };
  }

  if (rawPath === "/test_e2e") {
    return {
      mode: "test_e2e",
      externalUrl: testE2eQueryUrl,
      shared: false,
      dataPayload: null,
      bookEntryUrl: null,
      bookPartUrl: null,
    };
  }

  if (rawPath.startsWith("/html/")) {
    const externalPart = rawPath.slice("/html/".length);
    return {
      mode: "html",
      externalUrl: safeParseUrl(externalPart || null),
      shared: false,
      dataPayload: null,
      bookEntryUrl: null,
      bookPartUrl: null,
    };
  }

  if (rawPath === "/html") {
    return {
      mode: "html",
      externalUrl: null,
      shared: false,
      dataPayload: null,
      bookEntryUrl: null,
      bookPartUrl: null,
    };
  }

  if (rawPath === "/" || rawPath === "") {
    return {
      mode: "html",
      externalUrl: null,
      shared: false,
      dataPayload: null,
      bookEntryUrl: null,
      bookPartUrl: null,
    };
  }

  const externalPart = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
  return {
    mode: "html",
    externalUrl: safeParseUrl(externalPart || null),
    shared: false,
    dataPayload: null,
    bookEntryUrl: null,
    bookPartUrl: null,
  };
}
