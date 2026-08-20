import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDockedEditorRect,
  detectEditorDockPlacement,
  getEditorHostAccessibilityState,
} from "../src/client/editor-window";

const VIEWPORT = { width: 1600, height: 900 };

test("detectEditorDockPlacement prefers the nearest window edge", () => {
  assert.equal(
    detectEditorDockPlacement({ x: 8, y: 220 }, VIEWPORT),
    "left",
  );
  assert.equal(
    detectEditorDockPlacement({ x: 80, y: 260 }, VIEWPORT),
    "left",
  );
  assert.equal(
    detectEditorDockPlacement({ x: 1591, y: 180 }, VIEWPORT),
    "right",
  );
  assert.equal(
    detectEditorDockPlacement({ x: 810, y: 12 }, VIEWPORT),
    "top",
  );
  assert.equal(
    detectEditorDockPlacement({ x: 780, y: 892 }, VIEWPORT),
    "bottom",
  );
  assert.equal(
    detectEditorDockPlacement({ x: 800, y: 450 }, VIEWPORT),
    "floating",
  );
});

test("buildDockedEditorRect stretches editor along the snapped edge", () => {
  assert.deepEqual(
    buildDockedEditorRect("right", VIEWPORT, { width: 520, height: 340 }),
    {
      left: 1080,
      top: 0,
      width: 520,
      height: 900,
    },
  );

  assert.deepEqual(
    buildDockedEditorRect("top", VIEWPORT, { width: 520, height: 300 }),
    {
      left: 0,
      top: 0,
      width: 1600,
      height: 300,
    },
  );
});

test("editor host is hidden and inert only while the editor is closed", () => {
  assert.deepEqual(getEditorHostAccessibilityState(false), {
    inert: true,
    ariaHidden: "true",
  });
  assert.deepEqual(getEditorHostAccessibilityState(true), {
    inert: false,
    ariaHidden: null,
  });
  assert.deepEqual(getEditorHostAccessibilityState(false, true), {
    inert: false,
    ariaHidden: null,
  });
});
