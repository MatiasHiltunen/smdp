import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeBookLink,
  canonicalizeMarkdownDocumentUrl,
  normalizeGitHubUrlToRaw,
} from "../src/client/github-url";

test("normalizes GitHub blob markdown URLs to raw content URLs", () => {
  const input = "https://github.com/org/repo/blob/main/docs/intro.md";
  const normalized = normalizeGitHubUrlToRaw(input);
  assert.equal(
    normalized,
    "https://raw.githubusercontent.com/org/repo/main/docs/intro.md",
  );
});

test("normalizes GitHub blob image URLs to raw content URLs", () => {
  const input =
    "https://github.com/openai/codex/blob/main/.github/codex-cli-splash.png";
  const normalized = normalizeGitHubUrlToRaw(input);
  assert.equal(
    normalized,
    "https://raw.githubusercontent.com/openai/codex/main/.github/codex-cli-splash.png",
  );
});

test("preserves GitHub blob URLs for non-markdown and non-image files", () => {
  const input = "https://github.com/openai/codex/blob/main/package-lock.json";
  const normalized = normalizeGitHubUrlToRaw(input);
  assert.equal(normalized, input);
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
