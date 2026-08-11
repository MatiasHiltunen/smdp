import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEditorBookContentLinks,
  createBookEditorDocumentSnapshot,
  createEmptyBookEditorDocumentSnapshot,
  createSingleEditorDocumentSnapshot,
  EditorStateController,
  getCurrentEditorPage,
  getEditorPagePathValue,
} from "../src/client/editor-model";

const ENTRY_URL =
  "https://raw.githubusercontent.com/acme/docs/main/README.md";

test("book editor links preserve nested chapters and unresolved linked pages", () => {
  const snapshot = createBookEditorDocumentSnapshot({
    entryUrl: ENTRY_URL,
    currentPartUrl: ENTRY_URL,
    parts: [
      {
        url: ENTRY_URL,
        baseUrl: ENTRY_URL,
        markdown: "# Book\n\n[Intro](chapters/intro.md)\n[Missing](chapters/missing.md)",
      },
      {
        url: "https://raw.githubusercontent.com/acme/docs/main/chapters/intro.md",
        baseUrl: "https://raw.githubusercontent.com/acme/docs/main/chapters/intro.md",
        markdown: "# Intro\n\n[Deep Dive](deep-dive.md)",
      },
      {
        url: "https://raw.githubusercontent.com/acme/docs/main/chapters/deep-dive.md",
        baseUrl: "https://raw.githubusercontent.com/acme/docs/main/chapters/deep-dive.md",
        markdown: "# Deep Dive",
      },
    ],
  });

  const contents = buildEditorBookContentLinks(snapshot);
  assert.equal(contents.length, 1);
  assert.equal(contents[0].url, ENTRY_URL);
  assert.equal(contents[0].children?.length, 2);
  assert.equal(
    contents[0].children?.[0].url,
    "https://raw.githubusercontent.com/acme/docs/main/chapters/intro.md",
  );
  assert.equal(
    contents[0].children?.[0].children?.[0].url,
    "https://raw.githubusercontent.com/acme/docs/main/chapters/deep-dive.md",
  );
  assert.equal(
    contents[0].children?.[1].url,
    "https://raw.githubusercontent.com/acme/docs/main/chapters/missing.md",
  );
  assert.equal(contents[0].children?.[1].title, "missing");
});

test("book editor controller supports nested synthetic page paths", () => {
  const controller = new EditorStateController(
    createBookEditorDocumentSnapshot({
      entryUrl: ENTRY_URL,
      currentPartUrl: ENTRY_URL,
      parts: [
        {
          url: ENTRY_URL,
          baseUrl: ENTRY_URL,
          markdown: "# Book",
        },
      ],
    }),
  );

  controller.addBookPage();
  controller.updateCurrentSyntheticPagePath("drafts/Intro Page");

  const snapshot = controller.getSnapshot();
  const currentPage = getCurrentEditorPage(snapshot);
  assert.ok(currentPage);
  assert.equal(
    getEditorPagePathValue(snapshot, currentPage!),
    "drafts/intro-page.md",
  );
  assert.equal(
    currentPage?.url,
    "https://raw.githubusercontent.com/acme/docs/main/drafts/intro-page.md",
  );
});

test("adding a page promotes a single document into a book without losing it", () => {
  const controller = new EditorStateController(
    createSingleEditorDocumentSnapshot({
      markdown: "# Existing\n\nKeep this text.",
      baseUrl: "https://example.com/docs/README.md",
    }),
  );

  const created = controller.addBookPage();
  const snapshot = controller.getSnapshot();

  assert.ok(created);
  assert.equal(snapshot.mode, "book");
  assert.equal(snapshot.entryUrl, "https://example.com/docs/README.md");
  assert.equal(snapshot.pages.length, 2);
  assert.equal(snapshot.pages[0].markdown, "# Existing\n\nKeep this text.");
  assert.equal(snapshot.currentPageId, created?.id);
});

test("empty book snapshots expose an editable synthetic entry page", () => {
  const snapshot = createEmptyBookEditorDocumentSnapshot({
    title: "Product Notes",
    fallbackOrigin: "https://example.com/workspace/",
  });

  assert.equal(snapshot.mode, "book");
  assert.equal(snapshot.pages.length, 1);
  assert.equal(snapshot.pages[0].title, "Product Notes");
  assert.equal(snapshot.pages[0].synthetic, true);
  assert.equal(snapshot.pages[0].sourceUrl, null);
  assert.equal(
    snapshot.entryUrl,
    "https://example.com/workspace/books/product-notes/README.md",
  );
});
