/**
 * Derives a stable base URL for resolving relative links when viewing shared
 * markdown data. Long data payloads live under `/data/<payload>` and can slow
 * down `new URL()` resolution dramatically, so we strip the payload while
 * preserving the host and leading path.
 */
export function sanitizeSharedDataBaseUrl(currentHref: string): string {
  try {
    const url = new URL(currentHref);
    const dataIndex = url.pathname.indexOf("/data/");
    if (dataIndex !== -1) {
      url.pathname = url.pathname.slice(0, dataIndex + "/data/".length);
    } else {
      url.pathname = "/";
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return currentHref;
  }
}
