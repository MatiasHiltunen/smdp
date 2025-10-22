import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeSharedDataBaseUrl } from "../src/client/shared-data";

test("strips shared data payload from base url", () => {
  const href = "https://example.com/data/abc123?d=1#fragment";
  const sanitized = sanitizeSharedDataBaseUrl(href);
  assert.equal(sanitized, "https://example.com/data/");
});

test("falls back to origin root when data segment is missing", () => {
  const href = "https://example.com/notes/document";
  const sanitized = sanitizeSharedDataBaseUrl(href);
  assert.equal(sanitized, "https://example.com/");
});
