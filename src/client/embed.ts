import {
  parseBackgroundMode,
  parseFrameMode,
  setBackgroundModeSearchParam,
  setFrameModeSearchParam,
} from "./frame-mode";
import { compressBytes } from "../data-link";

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

function buildInlineGzipBootstrapHtml(compressedBase64: string): string {
  const encoded = JSON.stringify(compressedBase64);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Embedded Markdown</title>
  <style>
    body {
      margin: 0;
      padding: 1rem;
      font-family: system-ui, -apple-system, sans-serif;
      color: #111827;
      background: #ffffff;
    }
  </style>
</head>
<body>
  <p>Loading embedded content...</p>
  <script>
    const compressedBase64 = ${encoded};

    function base64ToBytes(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    async function inflateAndRender() {
      if (typeof DecompressionStream === "undefined") {
        throw new Error("This browser does not support gzip iframe embeds.");
      }

      const compressed = base64ToBytes(compressedBase64);
      const stream = new DecompressionStream("gzip");
      const writer = stream.writable.getWriter();
      const readPromise = new Response(stream.readable).text();
      await writer.write(compressed);
      await writer.close();
      const html = await readPromise;

      document.open();
      document.write(html);
      document.close();
    }

    inflateAndRender().catch((error) => {
      console.error("Failed to inflate embedded HTML", error);
      const message = document.createElement("p");
      message.textContent = "Unable to load compressed embedded content.";
      document.body.replaceChildren(message);
    });
  </script>
</body>
</html>`;
}

function preserveThemeQueryParams(target: URL, source: URL): void {
  const next = new URLSearchParams();
  const dark = source.searchParams.get("d");
  const light = source.searchParams.get("l");
  if (dark) next.set("d", dark);
  if (light) next.set("l", light);
  const backgroundMode = parseBackgroundMode(source.searchParams.get("bg"));
  setBackgroundModeSearchParam(next, backgroundMode);
  const frameMode = parseFrameMode(source.searchParams.get("fm"));
  setFrameModeSearchParam(next, frameMode);
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

export function buildSharedBookEmbedSrc(
  currentHref: string,
  loadUrl: string,
  entryUrl: string,
  prefetchPayload: string | null = null,
): string {
  const current = new URL(currentHref);
  const target = new URL(currentHref);
  target.pathname = `/book/shared/${entryUrl}`;
  preserveThemeQueryParams(target, current);
  target.searchParams.set("part", loadUrl);
  if (prefetchPayload) {
    target.searchParams.set("bp", prefetchPayload);
  } else {
    target.searchParams.delete("bp");
  }
  target.searchParams.delete("be");
  target.hash = "";
  return target.toString();
}

export function buildInlineHtmlDataSrc(htmlSource: string): string {
  const bytes = new TextEncoder().encode(htmlSource);
  const base64 = bytesToBase64(bytes);
  return `data:text/html;charset=utf-8;base64,${base64}`;
}

export async function buildInlineGzipHtmlDataSrc(
  htmlSource: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(htmlSource);
  const compressed = await compressBytes(bytes, "gzip");
  const compressedBase64 = bytesToBase64(compressed);
  const bootstrapHtml = buildInlineGzipBootstrapHtml(compressedBase64);
  return buildInlineHtmlDataSrc(bootstrapHtml);
}

export function buildIframeEmbedCode(src: string): string {
  const safeSrc = escapeHtmlAttribute(src);
  return `<iframe src="${safeSrc}" loading="lazy" style="width:100%;height:600px;border:0;" referrerpolicy="no-referrer"></iframe>`;
}
