import assert from "node:assert/strict";
import test from "node:test";

import {
  createImportedMarkdownSnapshot,
  importMarkdownFiles,
  MAX_MARKDOWN_IMPORT_FILE_BYTES,
  MAX_MARKDOWN_IMPORT_TOTAL_BYTES,
  readMarkdownFiles,
  type MarkdownFileSource,
} from "../src/client/markdown-file-import";

function markdownFile(
  name: string,
  markdown: string,
  declaredSize?: number,
): MarkdownFileSource {
  const bytes = new TextEncoder().encode(markdown);
  return {
    name,
    size: declaredSize ?? bytes.byteLength,
    async arrayBuffer(): Promise<ArrayBuffer> {
      return Uint8Array.from(bytes).buffer;
    },
  };
}

test("a single uploaded .md file becomes the rendered single document", async () => {
  const snapshot = await importMarkdownFiles(
    [markdownFile("notes.md", "\uFEFF# Notes\n\nUploaded locally.")],
    "https://md2.at/html",
  );

  assert.equal(snapshot.mode, "single");
  assert.equal(snapshot.pages.length, 1);
  assert.equal(snapshot.pages[0].title, "Notes");
  assert.equal(snapshot.pages[0].markdown, "# Notes\n\nUploaded locally.");
  assert.equal(snapshot.pages[0].sourceUrl, null);
  assert.equal(snapshot.pages[0].baseUrl, "https://md2.at/__smdp_upload__/notes.md");
});

test("multiple uploaded .md files become an ordered local book", () => {
  const snapshot = createImportedMarkdownSnapshot(
    [
      { name: "README.md", markdown: "# Guide\n\n[Next](chapter.md)" },
      { name: "chapter.md", markdown: "# Chapter\n\nDone." },
    ],
    "https://md2.at/",
  );

  assert.equal(snapshot.mode, "book");
  assert.equal(snapshot.pages.length, 2);
  assert.deepEqual(
    snapshot.pages.map((page) => page.title),
    ["Guide", "Chapter"],
  );
  assert.equal(snapshot.currentPageId, snapshot.pages[0].id);
  assert.equal(snapshot.entryUrl, "https://md2.at/__smdp_upload__/README.md");
  assert.equal(snapshot.pages[1].url, "https://md2.at/__smdp_upload__/chapter.md");
  assert.ok(snapshot.pages.every((page) => page.sourceUrl === null));
});

test("duplicate uploaded filenames receive stable local document URLs", () => {
  const snapshot = createImportedMarkdownSnapshot(
    [
      { name: "notes.md", markdown: "# One" },
      { name: "NOTES.md", markdown: "# Two" },
    ],
    "https://md2.at/",
  );

  assert.equal(snapshot.pages[0].url, "https://md2.at/__smdp_upload__/notes.md");
  assert.equal(snapshot.pages[1].url, "https://md2.at/__smdp_upload__/NOTES-2.md");
});

test("Markdown upload rejects non-.md files before reading them", async () => {
  let didRead = false;
  const file: MarkdownFileSource = {
    name: "notes.txt",
    size: 5,
    async arrayBuffer(): Promise<ArrayBuffer> {
      didRead = true;
      return new ArrayBuffer(5);
    },
  };

  await assert.rejects(() => readMarkdownFiles([file]), /Only \.md files/);
  assert.equal(didRead, false);
});

test("Markdown upload enforces the per-file size limit before reading", async () => {
  let didRead = false;
  const file: MarkdownFileSource = {
    name: "large.md",
    size: MAX_MARKDOWN_IMPORT_FILE_BYTES + 1,
    async arrayBuffer(): Promise<ArrayBuffer> {
      didRead = true;
      return new ArrayBuffer(0);
    },
  };

  await assert.rejects(() => readMarkdownFiles([file]), /file limit/);
  assert.equal(didRead, false);
});

test("Markdown upload enforces the aggregate size limit before reading", async () => {
  let readCount = 0;
  const halfLimit = MAX_MARKDOWN_IMPORT_TOTAL_BYTES / 2;
  const files: MarkdownFileSource[] = ["one.md", "two.md", "three.md"].map(
    (name) => ({
      name,
      size: halfLimit,
      async arrayBuffer(): Promise<ArrayBuffer> {
        readCount += 1;
        return new ArrayBuffer(0);
      },
    }),
  );

  await assert.rejects(() => readMarkdownFiles(files), /total limit/);
  assert.equal(readCount, 0);
});
