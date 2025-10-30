import type { CanvasView, HtmlView } from "../views";
import { createElement } from "../dom";
import { deserializeTheme } from "../../theme/theme-serializer";

function collectDocumentStyles(): string {
  return Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n");
      } catch (error) {
        // Ignore cross-origin stylesheets
        return "";
      }
    })
    .join("\n");
}

function buildThemeOverrideBlock(paramValue: string | null, mode: "light" | "dark"): string {
  if (!paramValue) {
    return "";
  }

  const config = deserializeTheme(paramValue, mode);
  const declarations: string[] = [];

  if (config.meta) {
    if (config.meta.fontFamily) declarations.push(`  font-family: ${config.meta.fontFamily};`);
    if (config.meta.fontSize) declarations.push(`  font-size: ${config.meta.fontSize};`);
    if (config.meta.fontWeight) declarations.push(`  font-weight: ${config.meta.fontWeight};`);
    if (config.meta.lineHeight) declarations.push(`  line-height: ${config.meta.lineHeight};`);
    if (config.meta.monoFontFamily) declarations.push(`  --font-mono: ${config.meta.monoFontFamily};`);
  }

  if (config.tokens) {
    Object.entries(config.tokens).forEach(([key, value]) => {
      const cssVarName = `--${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
      declarations.push(`  ${cssVarName}: ${value};`);
    });
  }

  if (config.customProperties) {
    Object.entries(config.customProperties).forEach(([name, value]) => {
      declarations.push(`  ${name}: ${value};`);
    });
  }

  if (declarations.length === 0) {
    return "";
  }

  const selector = mode === "dark" ? ":root, :root[data-theme=\"dark\"]" : ":root[data-theme=\"light\"]";
  return `\n${selector} {\n${declarations.join("\n")}\n}`;
}

function buildThemeOverrides(): string {
  const params = new URLSearchParams(window.location.search);
  const darkBlock = buildThemeOverrideBlock(params.get("d"), "dark");
  const lightBlock = buildThemeOverrideBlock(params.get("l"), "light");
  return `${darkBlock}${lightBlock}`;
}

function buildHtmlDocument(shellHtml: string, styles: string, theme: string, currentTheme: "light" | "dark"): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="${currentTheme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="SMDP - Simple Markdown Parser">
  <title>Exported Markdown</title>
  <style>
${styles}${theme}
  </style>
</head>
<body>
  <div class="app-shell">
    <div class="viewer-pane">
      <article class="markdown-viewer">
${shellHtml}
      </article>
    </div>
  </div>
</body>
</html>`;
}

export function exportAsHtml(view: HtmlView | CanvasView): void {
  const viewer = view.shell.querySelector<HTMLElement>(".markdown-viewer");
  if (!viewer) {
    alert("No rendered content to export");
    return;
  }

  const styles = collectDocumentStyles();
  const themeOverrides = buildThemeOverrides();
  const currentTheme = (document.documentElement.getAttribute("data-theme") || "dark") as "light" | "dark";
  const html = buildHtmlDocument(viewer.innerHTML, styles, themeOverrides, currentTheme);

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = createElement("a", {
    attrs: {
      href: url,
      download: `markdown-export-${Date.now()}.html`,
    },
  });

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
