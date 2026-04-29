import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEditorBookContentLinks,
  createBookEditorDocumentSnapshot,
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

test("editor controller promotes a single document to a local book when adding a page", () => {
  const controller = new EditorStateController(
    createSingleEditorDocumentSnapshot({
      markdown: "# Draft",
      baseUrl: "https://example.com/draft.md",
      sourceUrl: "https://example.com/draft.md",
    }),
  );

  const created = controller.addPage();
  const snapshot = controller.getSnapshot();

  assert.ok(created);
  assert.equal(snapshot.mode, "book");
  assert.equal(snapshot.entryUrl, "https://example.com/draft.md");
  assert.equal(snapshot.pages.length, 2);
  assert.equal(snapshot.currentPageId, created?.id);
  assert.equal(snapshot.pages[0].synthetic, false);
  assert.equal(created?.synthetic, true);
});
