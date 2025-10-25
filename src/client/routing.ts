export type RenderMode = "html" | "canvas";

export type DataPayloadFormat = "legacy" | "binary";
export type DataPayloadEncoding = "base64" | "base79";

export type RouteDetails = {
  mode: RenderMode;
  externalUrl: URL | null;
  shared: boolean;
  dataPayload: string | null;
  dataFormat: DataPayloadFormat;
  dataEncoding: DataPayloadEncoding | null;
};

type RouteContext = {
  /**
   * Raw pathname as provided by the location source (may contain percent-encoding).
   */
  rawPathname: string;
  /**
   * Normalized and decoded pathname, always starting with "/".
   */
  pathname: string;
  /**
   * Convenience split of the pathname (without leading slash).
   */
  segments: readonly string[];
  search: string;
  hash: string;
};

type RoutePredicate = (context: RouteContext) => boolean;
type RouteHandler = (context: RouteContext) => RouteDetails;

type RouteDefinition = {
  description: string;
  predicate: RoutePredicate;
  handler: RouteHandler;
};

class Router {
  private readonly routes: readonly RouteDefinition[];
  private readonly fallback: RouteHandler;

  constructor(routes: readonly RouteDefinition[], fallback: RouteHandler) {
    this.routes = routes;
    this.fallback = fallback;
  }

  resolve(context: RouteContext): RouteDetails {
    for (const route of this.routes) {
      if (route.predicate(context)) {
        return route.handler(context);
      }
    }
    return this.fallback(context);
  }
}

class RouterBuilder {
  private readonly definitions: RouteDefinition[] = [];
  private fallbackHandler: RouteHandler | null = null;

  when(predicate: RoutePredicate, handler: RouteHandler, description = "custom"): this {
    this.definitions.push({ predicate, handler, description });
    return this;
  }

  whenExact(path: string, handler: RouteHandler): this {
    const normalized = normalizePathname(path);
    return this.when(
      (ctx) => ctx.pathname === normalized,
      handler,
      `exact:${normalized}`,
    );
  }

  whenPrefix(prefix: string, handler: (ctx: RouteContext, suffix: string) => RouteDetails): this {
    const normalizedPrefix = ensureTrailingSlash(normalizePathname(prefix));
    return this.when(
      (ctx) => ctx.pathname.startsWith(normalizedPrefix),
      (ctx) => handler(ctx, ctx.pathname.slice(normalizedPrefix.length)),
      `prefix:${normalizedPrefix}`,
    );
  }

  whenPattern(pattern: RegExp, handler: RouteHandler): this {
    return this.when(
      (ctx) => pattern.test(ctx.pathname),
      handler,
      `pattern:${pattern.toString()}`,
    );
  }

  fallback(handler: RouteHandler): this {
    this.fallbackHandler = handler;
    return this;
  }

  build(): Router {
    if (!this.fallbackHandler) {
      throw new Error("RouterBuilder requires a fallback handler before build()");
    }
    return new Router(this.definitions, this.fallbackHandler);
  }
}

type LocationLike = Pick<Location, "pathname" | "search" | "hash">;

// Router instance is memoized for reuse.
const APP_ROUTER = createAppRouter();

export function parseRoute(locationLike: LocationLike = getLocation()): RouteDetails {
  const context = createRouteContext(locationLike);
  return APP_ROUTER.resolve(context);
}

function createAppRouter(): Router {
  return new RouterBuilder()
    // Shared/embed routes drop the editor UI and use HTML rendering.
    .whenPrefix("/shared", (_ctx, suffix) => ({
      mode: "html",
      externalUrl: safeParseUrl(suffix || null),
      shared: true,
      dataPayload: null,
      dataFormat: "legacy",
      dataEncoding: null,
    }))
    .whenExact("/shared", () => ({
      mode: "html",
      externalUrl: null,
      shared: true,
      dataPayload: null,
      dataFormat: "legacy",
      dataEncoding: null,
    }))
    .whenExact("/edit/data", (ctx) => {
      const hashPayload = extractHashPayload(ctx.hash);
      return {
        mode: "html",
        externalUrl: null,
        shared: false,
        dataPayload: hashPayload,
        dataFormat: hashPayload ? "binary" : "legacy",
        dataEncoding: hashPayload ? "base64" : null,
      };
    })
    // Editable binary payload route.
    .whenPrefix("/edit/data79", (_ctx, suffix) => ({
      mode: "html",
      externalUrl: null,
      shared: false,
      dataPayload: suffix || null,
      dataFormat: "binary",
      dataEncoding: "base79",
    }))
    // Editable legacy payload route.
    .whenPrefix("/edit/data", (_ctx, suffix) => ({
      mode: "html",
      externalUrl: null,
      shared: false,
      dataPayload: suffix || null,
      dataFormat: "legacy",
      dataEncoding: "base64",
    }))
    .whenExact("/data", (ctx) => {
      const hashPayload = extractHashPayload(ctx.hash);
      return {
        mode: "html",
        externalUrl: null,
        shared: true,
        dataPayload: hashPayload,
        dataFormat: hashPayload ? "binary" : "legacy",
        dataEncoding: hashPayload ? "base64" : null,
      };
    })
    // Binary data payload route using Base79 compressed representation.
    .whenPrefix("/data79", (_ctx, suffix) => ({
      mode: "html",
      externalUrl: null,
      shared: true,
      dataPayload: suffix || null,
      dataFormat: "binary",
      dataEncoding: "base79",
    }))
    // Data payload route (base64-encoded markdown in the URL path).
    .whenPrefix("/data", (_ctx, suffix) => ({
      mode: "html",
      externalUrl: null,
      shared: true,
      dataPayload: suffix || null,
      dataFormat: "legacy",
      dataEncoding: "base64",
    }))
    // Canvas routes explicitly request the canvas renderer.
    .whenPrefix("/canvas", (_ctx, suffix) => ({
      mode: "canvas",
      externalUrl: safeParseUrl(suffix || null),
      shared: false,
      dataPayload: null,
      dataFormat: "legacy",
      dataEncoding: null,
    }))
    .whenExact("/canvas", () => ({
      mode: "canvas",
      externalUrl: null,
      shared: false,
      dataPayload: null,
      dataFormat: "legacy",
      dataEncoding: null,
    }))
    // HTML routes explicitly request the HTML renderer.
    .whenPrefix("/html", (_ctx, suffix) => ({
      mode: "html",
      externalUrl: safeParseUrl(suffix || null),
      shared: false,
      dataPayload: null,
      dataFormat: "legacy",
      dataEncoding: null,
    }))
    .whenExact("/html", () => ({
      mode: "html",
      externalUrl: null,
      shared: false,
      dataPayload: null,
      dataFormat: "legacy",
      dataEncoding: null,
    }))
    // Root landing page.
    .whenExact("/", () => ({
      mode: "html",
      externalUrl: null,
      shared: false,
      dataPayload: null,
      dataFormat: "legacy",
      dataEncoding: null,
    }))
    // Fallback: treat remaining path as an external URL reference.
    .fallback((ctx) => {
      const externalPart = ctx.pathname.startsWith("/")
        ? ctx.pathname.slice(1)
        : ctx.pathname;
      return {
        mode: "html",
        externalUrl: safeParseUrl(externalPart || null),
        shared: false,
        dataPayload: null,
        dataFormat: "legacy",
        dataEncoding: null,
      };
    })
    .build();
}

function createRouteContext(source: LocationLike): RouteContext {
  const rawPathname = source.pathname ?? "/";
  const pathname = normalizePathname(rawPathname);
  const segments = pathname === "/"
    ? []
    : pathname.slice(1).split("/").filter(Boolean);

  return {
    rawPathname,
    pathname,
    segments,
    search: source.search ?? "",
    hash: source.hash ?? "",
  };
}

function normalizePathname(pathname: string): string {
  if (!pathname) {
    return "/";
  }

  let normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  try {
    normalized = decodeURIComponent(normalized);
  } catch (error) {
    console.warn("Failed to decode pathname; continuing with raw value", error);
  }

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  return normalized === "" ? "/" : normalized;
}

function ensureTrailingSlash(path: string): string {
  if (path === "/") return path;
  return path.endsWith("/") ? path : `${path}/`;
}

function getLocation(): LocationLike {
  if (typeof window === "undefined" || !window.location) {
    return { pathname: "/", search: "", hash: "" };
  }
  return window.location;
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

function extractHashPayload(hash: string): string | null {
  if (!hash) {
    return null;
  }
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  return normalized.length > 0 ? normalized : null;
}
