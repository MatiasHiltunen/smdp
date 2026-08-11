import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditorArchive,
  importEditorArchive,
} from "../src/client/editor-archive";
import {
  createBookEditorDocumentSnapshot,
  EditorStateController,
  getCurrentEditorPage,
} from "../src/client/editor-model";

const ENTRY_URL = "https://example.com/guide/README.md";

test("editor ZIP archives round-trip book pages, paths, titles, and selection", async () => {
  const controller = new EditorStateController(
    createBookEditorDocumentSnapshot({
      entryUrl: ENTRY_URL,
      currentPartUrl: ENTRY_URL,
      parts: [
        {
          url: ENTRY_URL,
          baseUrl: ENTRY_URL,
          markdown: "# Guide\n\n[Emoji](chapters/emoji.md)",
        },
        {
          url: "https://example.com/guide/chapters/emoji%20and%23.md",
          baseUrl: "https://example.com/guide/chapters/emoji%20and%23.md",
          markdown: "# Emoji support\n\nText: 😀 漢字",
        },
      ],
    }),
  );
  const secondPage = controller.getSnapshot().pages[1];
  controller.setCurrentPage(secondPage.id);
  controller.updateCurrentPageTitle("Unicode and emoji");

  const archive = createEditorArchive(controller.getSnapshot());
  const imported = await importEditorArchive(archive.bytes, archive.filename);
  const current = getCurrentEditorPage(imported);

  assert.equal(archive.filename, "guide.zip");
  assert.equal(imported.mode, "book");
  assert.equal(imported.pages.length, 2);
  assert.equal(imported.pages[0].markdown, "# Guide\n\n[Emoji](chapters/emoji.md)");
  assert.equal(imported.pages[1].title, "Unicode and emoji");
  assert.equal(imported.pages[1].markdown, "# Emoji support\n\nText: 😀 漢字");
  assert.equal(current?.title, "Unicode and emoji");
  assert.match(imported.pages[1].url, /\/chapters\/emoji%20and%23\.md$/);
});

test("editor ZIP import rejects a corrupted archive", async () => {
  const archive = createEditorArchive(
    createBookEditorDocumentSnapshot({
      entryUrl: ENTRY_URL,
      currentPartUrl: ENTRY_URL,
      parts: [{ url: ENTRY_URL, baseUrl: ENTRY_URL, markdown: "# Guide" }],
    }),
  );
  const corrupted = Uint8Array.from(archive.bytes);
  corrupted[corrupted.length >>> 2] ^= 0xff;

  await assert.rejects(
    () => importEditorArchive(corrupted, archive.filename),
    /checksum|invalid|missing/i,
  );
});
