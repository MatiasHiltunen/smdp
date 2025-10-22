export type RenderMode = "html" | "canvas";

export type RouteDetails = {
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

export function parseRoute(): RouteDetails {
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
