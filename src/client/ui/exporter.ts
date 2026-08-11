import type { CanvasView, HtmlView } from "../views";
import { createElement } from "../dom";
import { deserializeTheme } from "../../theme/theme-serializer";

export function exportAsHtml(view: HtmlView | CanvasView): void {
  const viewer = view.shell.querySelector(".markdown-viewer");
  if (!viewer) {
    alert("No rendered content to export");
    return;
  }

  const styles = Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n");
      } catch (error) {
        return "";
      }
    })
    .join("\n");

  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  const params = new URLSearchParams(window.location.search);

  const darkCustomProps: string[] = [];
  const lightCustomProps: string[] = [];

  const collectCustomizations = (
    serialized: string | null,
    mode: "light" | "dark",
    bucket: string[],
  ) => {
    if (!serialized) return;

    const config = deserializeTheme(serialized, mode);

    if (config.meta) {
      if (config.meta.fontFamily) bucket.push(`  font-family: ${config.meta.fontFamily};`);
      if (config.meta.fontSize) bucket.push(`  font-size: ${config.meta.fontSize};`);
      if (config.meta.fontWeight) bucket.push(`  font-weight: ${config.meta.fontWeight};`);
      if (config.meta.lineHeight) bucket.push(`  line-height: ${config.meta.lineHeight};`);
      if (config.meta.monoFontFamily) bucket.push(`  --font-mono: ${config.meta.monoFontFamily};`);
    }

    if (config.tokens) {
      Object.entries(config.tokens).forEach(([key, value]) => {
        const cssVarName = `--${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
        bucket.push(`  ${cssVarName}: ${value};`);
      });
    }

    if (config.customProperties) {
      Object.entries(config.customProperties).forEach(([key, value]) => {
        bucket.push(`  ${key}: ${value};`);
      });
    }
  };

  collectCustomizations(params.get("d"), "dark", darkCustomProps);
  collectCustomizations(params.get("l"), "light", lightCustomProps);

  let themeOverrides = "";
  if (darkCustomProps.length) {
    themeOverrides += `\n:root, :root[data-theme="dark"] {\n${darkCustomProps.join("\n")}\n}`;
  }
  if (lightCustomProps.length) {
    themeOverrides += `\n:root[data-theme="light"] {\n${lightCustomProps.join("\n")}\n}`;
  }

  const html = `<!DOCTYPE html>
<html lang="en" data-theme="${currentTheme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="SMDP - Simple Markdown Parser">
  <title>Exported Markdown</title>
  <style>
${styles}${themeOverrides}
  </style>
</head>
<body>
  <div class="app-shell">
    <div class="viewer-pane">
      <article class="markdown-viewer">
${viewer.innerHTML}
      </article>
    </div>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const anchor = createElement("a", { attrs: { download: `markdown-export-${Date.now()}.html` }, href: url });

  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
