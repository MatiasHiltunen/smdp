import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import {
  buildIframeEmbedCode,
  buildInlineGzipHtmlDataSrc,
  buildInlineHtmlDataSrc,
  buildSharedBookEmbedSrc,
  buildSharedEmbedSrc,
} from "../src/client/embed";

test("buildInlineHtmlDataSrc encodes HTML as base64 data URI", () => {
  const html = "<!doctype html><meta charset=\"utf-8\"><h1>Hi</h1>";
  const dataSrc = buildInlineHtmlDataSrc(html);
  assert.ok(dataSrc.startsWith("data:text/html;charset=utf-8;base64,"));
  const payload = dataSrc.slice("data:text/html;charset=utf-8;base64,".length);
  const decoded = Buffer.from(payload, "base64").toString("utf8");
  assert.equal(decoded, html);
});

test("buildInlineGzipHtmlDataSrc encodes gzipped HTML with bootstrap decompression", async () => {
  const html = "<!doctype html><meta charset=\"utf-8\"><h1>Hi from gzip</h1>";
  const dataSrc = await buildInlineGzipHtmlDataSrc(html);
  assert.ok(dataSrc.startsWith("data:text/html;charset=utf-8;base64,"));

  const payload = dataSrc.slice("data:text/html;charset=utf-8;base64,".length);
  const bootstrapHtml = Buffer.from(payload, "base64").toString("utf8");
  assert.match(bootstrapHtml, /new DecompressionStream\("gzip"\)/);

  const base64Match = bootstrapHtml.match(/const compressedBase64 = "([^"]+)";/);
  assert.ok(base64Match);
  const compressed = Buffer.from(base64Match[1], "base64");
  const inflated = gunzipSync(compressed).toString("utf8");
  assert.equal(inflated, html);
});

test("buildSharedEmbedSrc keeps only theme query params and strips hash", () => {
  const currentHref =
    "https://md2.at/book/https://github.com/acme/docs/blob/main/README.md?part=https%3A%2F%2Fraw.githubusercontent.com%2Facme%2Fdocs%2Fmain%2Fchapter-1.md&d=dark-theme&l=light-theme&bg=soft&fm=none&x=drop#intro";
  const loadUrl =
    "https://raw.githubusercontent.com/acme/docs/main/chapter-2.md?plain=1";

  const sharedHref = buildSharedEmbedSrc(currentHref, loadUrl);
  const shared = new URL(sharedHref);
  assert.equal(shared.origin, "https://md2.at");
  assert.equal(shared.searchParams.get("d"), "dark-theme");
  assert.equal(shared.searchParams.get("l"), "light-theme");
  assert.equal(shared.searchParams.get("bg"), "soft");
  assert.equal(shared.searchParams.get("fm"), "none");
  assert.equal(shared.searchParams.get("x"), null);
  assert.equal(shared.hash, "");
  assert.equal(
    decodeURIComponent(shared.pathname.slice("/shared/".length)),
    loadUrl,
  );
});

test("buildSharedBookEmbedSrc preserves style params and adds book payload", () => {
  const currentHref =
    "https://md2.at/book/https://github.com/acme/docs/blob/main/README.md?part=https%3A%2F%2Fraw.githubusercontent.com%2Facme%2Fdocs%2Fmain%2Fchapter-1.md&d=dark-theme&l=light-theme&bg=none&fm=minimal#intro";
  const loadUrl =
    "https://raw.githubusercontent.com/acme/docs/main/chapter-3.md";
  const entryUrl =
    "https://raw.githubusercontent.com/acme/docs/main/README.md";
  const prefetchPayload = "prefetched-cache";

  const sharedHref = buildSharedBookEmbedSrc(
    currentHref,
    loadUrl,
    entryUrl,
    prefetchPayload,
  );
  const shared = new URL(sharedHref);
  assert.equal(shared.origin, "https://md2.at");
  assert.equal(shared.searchParams.get("d"), "dark-theme");
  assert.equal(shared.searchParams.get("l"), "light-theme");
  assert.equal(shared.searchParams.get("bg"), "none");
  assert.equal(shared.searchParams.get("fm"), "minimal");
  assert.equal(shared.searchParams.get("part"), loadUrl);
  assert.equal(shared.searchParams.get("be"), null);
  assert.equal(shared.searchParams.get("bp"), prefetchPayload);
  assert.equal(shared.hash, "");
  assert.equal(
    decodeURIComponent(shared.pathname.slice("/book/shared/".length)),
    entryUrl,
  );
});

test("buildIframeEmbedCode escapes src safely", () => {
  const code = buildIframeEmbedCode('https://example.com/x?a=1&b="2"');
  assert.ok(code.includes('src="https://example.com/x?a=1&amp;b=&quot;2&quot;"'));
  assert.ok(code.includes('loading="lazy"'));
  assert.ok(code.includes('referrerpolicy="no-referrer"'));
});
