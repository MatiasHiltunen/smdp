import assert from "node:assert/strict";
import test from "node:test";

import { discoverBookLinks } from "../src/client/book";

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
