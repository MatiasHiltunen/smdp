import assert from "node:assert/strict";
import test from "node:test";

import { BookLoader, discoverBookLinks } from "../src/client/book";

test("discovers markdown chapter links in reading order", () => {
  const markdown = `
# Book

[Chapter 1](./chapter-1.md)
[Chapter 2](https://github.com/org/repo/blob/main/docs/chapter-2.md#start)
![Cover](./cover.png)
[Chapter 1 duplicate](./chapter-1.md#again)
`;

  const links = discoverBookLinks(
    markdown,
    "https://raw.githubusercontent.com/org/repo/main/docs/README.md",
  );

  assert.deepEqual(links, [
    "https://raw.githubusercontent.com/org/repo/main/docs/chapter-1.md",
    "https://raw.githubusercontent.com/org/repo/main/docs/chapter-2.md",
  ]);
});

test("book loader keeps SPA navigation scoped to same source", () => {
  const loader = new BookLoader(
    "https://raw.githubusercontent.com/org/repo/main/docs/README.md",
  );

  const sameSource = loader.registerNavigablePart(
    "https://raw.githubusercontent.com/org/repo/main/docs/chapter-1.md",
  );
  const otherSource = loader.registerNavigablePart(
    "https://raw.githubusercontent.com/other/repo/main/docs/chapter-1.md",
  );

  assert.equal(
    sameSource,
    "https://raw.githubusercontent.com/org/repo/main/docs/chapter-1.md",
  );
  assert.equal(otherSource, null);
});

test("book loader prefers highest-tier heading for chapter title", () => {
  const entryUrl = "https://raw.githubusercontent.com/org/repo/main/docs/README.md";
  const loader = new BookLoader(entryUrl);
  loader.seedPrefetchedParts([
    {
      url: entryUrl,
      baseUrl: entryUrl,
      markdown: "## Deep Dive\n\n# Book Overview\n\nContent.",
    },
  ]);

  assert.equal(loader.getPartTitle(entryUrl), "Book Overview");
});
