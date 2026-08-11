import assert from "node:assert/strict";
import test from "node:test";

import {
  findPreviewSourceAnchor,
  getSourceLineAtTextOffset,
  PreviewCursorSyncState,
  type PreviewSourceAnchor,
} from "../src/client/editor-preview-sync";

test("cursor offsets map to one-based Markdown source lines", () => {
  const markdown = "# One\n\nSecond line\nFourth";
  assert.equal(getSourceLineAtTextOffset(markdown, 0), 1);
  assert.equal(getSourceLineAtTextOffset(markdown, 5), 1);
  assert.equal(getSourceLineAtTextOffset(markdown, 6), 2);
  assert.equal(getSourceLineAtTextOffset(markdown, markdown.indexOf("Fourth")), 4);
  assert.equal(getSourceLineAtTextOffset(markdown, 10_000), 4);
});

test("preview synchronization selects the closest preceding source anchor", () => {
  const first = {} as HTMLElement;
  const fifth = {} as HTMLElement;
  const tenth = {} as HTMLElement;
  const anchors: PreviewSourceAnchor[] = [
    { line: 1, element: first },
    { line: 5, element: fifth },
    { line: 10, element: tenth },
  ];

  assert.equal(findPreviewSourceAnchor(anchors, 1), first);
  assert.equal(findPreviewSourceAnchor(anchors, 8), fifth);
  assert.equal(findPreviewSourceAnchor(anchors, 99), tenth);
});

test("disabling cursor synchronization clears stale pending lines", () => {
  const state = new PreviewCursorSyncState();
  assert.equal(state.request(42), true);
  assert.equal(state.getPendingLine(), 42);

  state.setEnabled(false);
  assert.equal(state.getPendingLine(), null);
  assert.equal(state.request(12), false);

  state.setEnabled(true);
  assert.equal(state.getPendingLine(), null);
  assert.equal(state.request(7), true);
  assert.equal(state.consumePendingLine(), 7);
  assert.equal(state.getPendingLine(), null);
});
