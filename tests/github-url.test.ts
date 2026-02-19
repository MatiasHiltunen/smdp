import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeBookLink,
  canonicalizeMarkdownDocumentUrl,
  normalizeGitHubUrlToRaw,
} from "../src/client/github-url";

test("normalizes GitHub blob URLs to raw content URLs", () => {
  const input = "https://github.com/org/repo/blob/main/docs/intro.md";
  const normalized = normalizeGitHubUrlToRaw(input);
  assert.equal(
    normalized,
    "https://raw.githubusercontent.com/org/repo/main/docs/intro.md",
  );
});

test("canonicalizes markdown document URLs and strips query/hash", () => {
  const canonical = canonicalizeMarkdownDocumentUrl(
    "../chapter-1.md?view=1#intro",
    "https://raw.githubusercontent.com/org/repo/main/docs/README.md",
  );
  assert.equal(
    canonical,
    "https://raw.githubusercontent.com/org/repo/main/chapter-1.md",
  );
});

test("canonicalizeBookLink ignores non-markdown targets", () => {
  const image = canonicalizeBookLink(
    "./assets/cover.png",
    "https://raw.githubusercontent.com/org/repo/main/docs/README.md",
  );
  assert.equal(image, null);

  const chapter = canonicalizeBookLink(
    "./chapter-2.md#part-a",
    "https://raw.githubusercontent.com/org/repo/main/docs/README.md",
  );
  assert.equal(
    chapter?.canonicalUrl,
    "https://raw.githubusercontent.com/org/repo/main/docs/chapter-2.md",
  );
  assert.equal(chapter?.anchor, "part-a");
});
