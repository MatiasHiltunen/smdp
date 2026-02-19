import assert from "node:assert/strict";
import test from "node:test";

import { fetchMarkdown } from "../src/client/fetch";

const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;

test("fetchMarkdown loads markdown bytes and base URL", async () => {
  const originalWindow = (globalThis as any).window;
  const originalFetch = globalThis.fetch;

  (globalThis as any).window = {
    location: {
      href: "https://app.example/viewer",
    },
  };

  globalThis.fetch = (async () =>
    new Response("# Title\n", {
      status: 200,
      headers: {
        "content-type": "text/markdown",
      },
    })) as typeof fetch;

  try {
    const result = await fetchMarkdown(new URL("https://example.com/docs/readme.md"));
    assert.equal(new TextDecoder().decode(result.bytes), "# Title\n");
    assert.equal(result.baseUrl, "https://example.com/docs/readme.md");
  } finally {
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
    globalThis.fetch = originalFetch;
  }
});

test("fetchMarkdown rejects responses that exceed the markdown size limit", async () => {
  const originalWindow = (globalThis as any).window;
  const originalFetch = globalThis.fetch;

  (globalThis as any).window = {
    location: {
      href: "https://app.example/viewer",
    },
  };

  globalThis.fetch = (async () =>
    new Response("x", {
      status: 200,
      headers: {
        "content-length": String(MAX_MARKDOWN_BYTES + 1),
      },
    })) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchMarkdown(new URL("https://example.com/docs/readme.md")),
      /Markdown exceeds size limit/,
    );
  } finally {
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
    globalThis.fetch = originalFetch;
  }
});
