import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modernCss = readFileSync(
  new URL("../src/style-modern.css", import.meta.url),
  "utf8",
);
const baseCss = readFileSync(
  new URL("../src/style.css", import.meta.url),
  "utf8",
);

function compactEditorRules(): string {
  const start = modernCss.indexOf("@media (max-width: 959px)");
  const end = modernCss.indexOf("@media (max-width: 700px)", start);
  assert.notEqual(start, -1, "compact editor breakpoint is missing");
  assert.notEqual(end, -1, "mobile reader breakpoint is missing");
  return modernCss.slice(start, end);
}

test("compact layouts neutralize persisted desktop dock insets", () => {
  const rules = compactEditorRules();

  for (const placement of ["left", "right", "top", "bottom"]) {
    assert.match(
      rules,
      new RegExp(`body\\.has-docked-editor\\.editor-dock-${placement}`),
      `missing compact reset for ${placement} docking`,
    );
  }
  assert.match(rules, /padding:\s*var\(--workspace-gutter\)/);
  assert.match(rules, /body\.frame-mode-none\.has-docked-editor/);
  assert.match(rules, /body\.mode-canvas\.has-docked-editor/);
  assert.match(rules, /body\.mode-editor\.has-docked-editor/);
});

test("closed compact overlays cannot widen the document viewport", () => {
  const rules = compactEditorRules();

  assert.match(modernCss, /html\s*\{[^}]*overflow-x:\s*clip/s);
  assert.match(
    modernCss,
    /\.theme-editor-wrapper\s*\{[^}]*overflow:\s*hidden/s,
  );
  assert.match(rules, /\.editor-pane-host\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(rules, /\.editor-window\s*\{[^}]*min-width:\s*0/s);
});

test("mobile action sheet is viewport-bounded and safe-area-aware", () => {
  const start = modernCss.indexOf("@media (max-width: 700px)");
  const end = modernCss.indexOf("@media (max-width: 560px)", start);
  assert.notEqual(start, -1, "mobile reader breakpoint is missing");
  assert.notEqual(end, -1, "narrow editor breakpoint is missing");
  const rules = modernCss.slice(start, end);

  assert.match(rules, /\.fab-actions\s*\{[^}]*100dvh/s);
  assert.match(rules, /env\(safe-area-inset-bottom,\s*0px\)/);
  assert.match(rules, /overscroll-behavior:\s*contain/);
  assert.match(rules, /touch-action:\s*pan-y/);
});

test("narrow diagrams scroll locally without widening the document", () => {
  assert.match(
    baseCss,
    /\.mermaid-diagram\s*\{[^}]*overflow-x:\s*auto/s,
  );
  assert.match(
    baseCss,
    /@media\s*\(max-width:\s*640px\)[\s\S]*?\.mermaid-diagram__svg\s*\{[^}]*min-width:\s*38rem/s,
  );
  assert.match(
    modernCss,
    /\.mermaid-diagram__svg\s*\{[^}]*min-width:\s*38rem/s,
  );
});
