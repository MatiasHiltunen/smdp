import assert from "node:assert/strict";
import test from "node:test";

import {
  renderCanvasToContext,
  setCanvasThemeColorsOverride,
  type CanvasThemeColors,
} from "../src/parser/canvas-renderer.ts";

const encoder = new TextEncoder();

test("canvas preserves multiline syntax state with whole-block token spans", () => {
  const draws: Array<{ text: string; color: string }> = [];
  const target: Record<PropertyKey, unknown> = {
    canvas: { width: 720, height: 520 },
    font: "",
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    measureText(text: string) {
      return { width: text.length * 7 };
    },
    fillText(text: string) {
      draws.push({ text, color: String(target.fillStyle) });
    },
  };
  const context = new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      return () => undefined;
    },
    set(object, property, value) {
      object[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const theme: CanvasThemeColors = {
    text: "#text",
    textSecondary: "#secondary",
    bg: "#background",
    bgSecondary: "#surface",
    codeBg: "#code-background",
    border: "#border",
    accent: "#accent",
    link: "#link",
    inlineCodeBg: "#inline-background",
    inlineCodeText: "#inline-text",
    blockquoteBorder: "#quote",
    hr: "#rule",
    listMarker: "#marker",
    codeKw: "#keyword",
    codeId: "#identifier",
    codeNum: "#number",
    codeStr: "#string",
    codeTpl: "#template",
    codeCom: "#comment",
    codeOp: "#operator",
    codePunc: "#punctuation",
    codeRx: "#regex",
  };

  setCanvasThemeColorsOverride(theme);
  try {
    renderCanvasToContext(
      encoder.encode(`\`\`\`eon
message: """
middle line
closing line
"""
\`\`\``),
      context,
      false,
    );
  } finally {
    setCanvasThemeColorsOverride(null);
  }

  assert.equal(draws.find((draw) => draw.text === "middle line")?.color, "#string");
  assert.equal(draws.find((draw) => draw.text === "closing line")?.color, "#string");
});
