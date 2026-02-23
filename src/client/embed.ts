type Base64Options = {
  alphabet?: "base64" | "base64url";
};

const UINT8ARRAY_WITH_BASE64 = Uint8Array as unknown as {
  prototype: {
    toBase64?: (options?: Base64Options) => string;
  };
};

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function bytesToBase64(bytes: Uint8Array): string {
  const toBase64 = UINT8ARRAY_WITH_BASE64.prototype.toBase64;
  if (typeof toBase64 === "function") {
    return toBase64.call(bytes, { alphabet: "base64" });
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  throw new Error("Unable to encode base64 in this environment");
}

function preserveThemeQueryParams(target: URL, source: URL): void {
  const next = new URLSearchParams();
  const dark = source.searchParams.get("d");
  const light = source.searchParams.get("l");
  if (dark) next.set("d", dark);
  if (light) next.set("l", light);
  target.search = next.toString();
}

export function buildSharedEmbedSrc(
  currentHref: string,
  loadUrl: string,
): string {
  const current = new URL(currentHref);
  const target = new URL(currentHref);
  target.pathname = `/shared/${loadUrl}`;
  preserveThemeQueryParams(target, current);
  target.hash = "";
  return target.toString();
}

export function buildInlineHtmlDataSrc(htmlSource: string): string {
  const bytes = new TextEncoder().encode(htmlSource);
  const base64 = bytesToBase64(bytes);
  return `data:text/html;charset=utf-8;base64,${base64}`;
}

export function buildIframeEmbedCode(src: string): string {
  const safeSrc = escapeHtmlAttribute(src);
  return `<iframe src="${safeSrc}" loading="lazy" style="width:100%;height:600px;border:0;" referrerpolicy="no-referrer"></iframe>`;
}
