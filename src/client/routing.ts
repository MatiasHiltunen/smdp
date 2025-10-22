export type RenderMode = "html" | "canvas";

export type RouteDetails = {
  mode: RenderMode;
  externalUrl: URL | null;
  shared: boolean;
  dataPayload: string | null;
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

export function parseRoute(): RouteDetails {
  const rawPath = decodeURIComponent(window.location.pathname);

  // Shared (embed) mode: no FABs, no editor/theme UI, HTML render
  if (rawPath.startsWith("/shared/")) {
    const externalPart = rawPath.slice("/shared/".length);
    return {
      mode: "html",
      externalUrl: safeParseUrl(externalPart || null),
      shared: true,
      dataPayload: null,
    };
  }

  if (rawPath === "/shared") {
    return {
      mode: "html",
      externalUrl: null,
      shared: true,
      dataPayload: null,
    };
  }

  if (rawPath.startsWith("/data/")) {
    const payload = rawPath.slice("/data/".length) || null;
    return {
      mode: "html",
      externalUrl: null,
      shared: true,
      dataPayload: payload,
    };
  }

  if (rawPath.startsWith("/canvas/")) {
    const externalPart = rawPath.slice("/canvas/".length);
    return {
      mode: "canvas",
      externalUrl: safeParseUrl(externalPart || null),
      shared: false,
      dataPayload: null,
    };
  }

  if (rawPath === "/canvas") {
    return {
      mode: "canvas",
      externalUrl: null,
      shared: false,
      dataPayload: null,
    };
  }

  if (rawPath.startsWith("/html/")) {
    const externalPart = rawPath.slice("/html/".length);
    return {
      mode: "html",
      externalUrl: safeParseUrl(externalPart || null),
      shared: false,
      dataPayload: null,
    };
  }

  if (rawPath === "/html") {
    return {
      mode: "html",
      externalUrl: null,
      shared: false,
      dataPayload: null,
    };
  }

  if (rawPath === "/" || rawPath === "") {
    return {
      mode: "html",
      externalUrl: null,
      shared: false,
      dataPayload: null,
    };
  }

  const externalPart = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
  return {
    mode: "html",
    externalUrl: safeParseUrl(externalPart || null),
    shared: false,
    dataPayload: null,
  };
}
