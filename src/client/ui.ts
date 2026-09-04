import type { ThemeEditorHandle } from "../theme/theme-editor";
import type {
  PdfCodeColorKey,
  PdfCodeColorOptions,
  PdfDocumentStyleOptions,
  PdfResolvedImage,
  PdfRGB,
} from "../parser";
import {
  applyTheme,
  applyThemeUrlOverrides,
  getCurrentTheme,
} from "./theme";
import type { CanvasView, HtmlView } from "./views";
import { createElement, replaceWithIcon, sanitizeHtmlString } from "./dom";
import { encodeMarkdownToBase64 } from "../data-link";
import { deserializeTheme } from "../theme/theme-serializer";
import { emitThemeChange, onThemeChange } from "./theme-events";
import { exportCanvasAsImageBlob } from "../parser/canvas-renderer";
import {
  buildIframeEmbedCode,
  buildInlineGzipHtmlDataSrc,
  buildInlineHtmlDataSrc,
  buildSharedBookEmbedSrc,
  buildSharedEmbedSrc,
} from "./embed";
import {
  parseBackgroundMode,
  parseFrameMode,
  setBackgroundModeSearchParam,
  setFrameModeSearchParam,
} from "./frame-mode";

const SAFE_CUSTOM_PROPERTY_RE = /^--[a-z0-9-]{1,64}$/i;
const SAFE_CSS_PROPERTY_RE = /^[a-z-]{1,64}$/i;
const PDF_CODE_COLOR_VARS: ReadonlyArray<readonly [PdfCodeColorKey, string]> = [
  ["kw", "--code-kw"],
  ["id", "--code-id"],
  ["num", "--code-num"],
  ["str", "--code-str"],
  ["tpl", "--code-tpl"],
  ["com", "--code-com"],
  ["op", "--code-op"],
  ["punc", "--code-punc"],
  ["rx", "--code-rx"],
];
const PDF_DOCUMENT_COLOR_VARS: ReadonlyArray<
  readonly [keyof PdfDocumentStyleOptions, string]
> = [
  ["pageBackground", "--bg-glass-strong"],
  ["text", "--text-primary"],
  ["textSecondary", "--text-secondary"],
  ["accent", "--accent"],
  ["border", "--border-glass"],
  ["surface", "--bg-panel"],
  ["codeBackground", "--bg-panel"],
  ["codeBorder", "--border-glass"],
  ["inlineCodeBackground", "--bg-panel"],
  ["inlineCodeText", "--accent"],
  ["tableHeaderBackground", "--bg-panel"],
  ["tableStripeBackground", "--bg-glass"],
  ["blockquoteBorder", "--blockquote-border"],
  ["blockquoteText", "--blockquote-text"],
  ["infoBorder", "--info-border"],
  ["infoBackground", "--info-bg"],
  ["warningBorder", "--warning-border"],
  ["warningBackground", "--warning-bg"],
  ["errorBorder", "--error-border"],
  ["errorBackground", "--error-bg"],
  ["successBorder", "--success-border"],
  ["successBackground", "--success-bg"],
];
const MENU_ICON_PATH =
  "M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1Z";
const EDIT_ICON_PATH =
  "M4.5 20a.5.5 0 0 1-.5-.5v-3.086a1 1 0 0 1 .293-.707L14.586 5.414a2 2 0 0 1 2.828 0l1.172 1.172a2 2 0 0 1 0 2.828L8.293 20.293a1 1 0 0 1-.707.293H4.5Zm12.379-13.207a.5.5 0 0 0-.707 0L6 16.964V19h2.036l10.172-10.172a.5.5 0 0 0 0-.707l-1.329-1.328Z";
const THEME_EDITOR_ICON_PATH =
  "M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9Zm0 2a7 7 0 0 0-7 7 7 7 0 0 0 7 7V5Z";
const THEME_DARK_TO_LIGHT_ICON_PATH =
  "M12 2a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 17a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm9-8a1 1 0 0 1 0 2h-1a1 1 0 1 1 0-2h1ZM4 11a1 1 0 1 0 0 2H3a1 1 0 1 0 0-2h1Zm14.071-5.071a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0ZM8.05 15.95a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0Zm9.9 0a1 1 0 0 1 1.414 0l.707.707a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 0 1 0-1.414ZM8.05 5.93a1 1 0 0 0-1.414 0l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707a1 1 0 0 0 0-1.414ZM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-7 5a7 7 0 1 1 14 0 7 7 0 0 1-14 0Z";
const THEME_LIGHT_TO_DARK_ICON_PATH =
  "M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1Z";
const EXPORT_ICON_PATH =
  "M13 3a1 1 0 1 0-2 0v12.586l-3.293-3.293a1 1 0 0 0-1.414 1.414l5 5a1 1 0 0 0 1.414 0l5-5a1 1 0 0 0-1.414-1.414L13 15.586V3ZM4 17a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4Z";
const PDF_ICON_PATH =
  "M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.828a2 2 0 0 0-.586-1.414l-4.828-4.828A2 2 0 0 0 13.172 2H6Zm7 2.414L17.586 9H14a1 1 0 0 1-1-1V4.414ZM7 13a1 1 0 0 1 1-1h1.5a2.5 2.5 0 0 1 0 5H9v1a1 1 0 1 1-2 0v-5Zm2 2h.5a.5.5 0 0 0 0-1H9v1Zm5-2a1 1 0 0 1 1-1h2a1 1 0 1 1 0 2h-1v1h1a1 1 0 1 1 0 2h-1v1a1 1 0 1 1-2 0v-5Zm-3 0a1 1 0 1 1 2 0v5a1 1 0 1 1-2 0v-5Z";
const SHARE_ICON_PATH =
  "M18 3a3 3 0 1 1-2.668 4.301l-6.01 3.004a3 3 0 0 1 0 2.39l6.01 3.004a3 3 0 1 1-.898 1.79l-6.01-3.004a3 3 0 1 1 0-4.98l6.01-3.004A3 3 0 0 1 18 3Z";
const EMBED_ICON_PATH =
  "M5 4a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1a1 1 0 1 0-2 0v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1a1 1 0 1 0 0-2H5Zm7 0a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3h-7Zm0 2h7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z";
const UPLOAD_ICON_PATH =
  "M12 3a1 1 0 0 1 .707.293l4 4a1 1 0 0 1-1.414 1.414L13 6.414V15a1 1 0 1 1-2 0V6.414L8.707 8.707a1 1 0 0 1-1.414-1.414l4-4A1 1 0 0 1 12 3ZM5 14a1 1 0 0 1 1 1v4h12v-4a1 1 0 1 1 2 0v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4a1 1 0 0 1 1-1Z";

function sanitizeCssDeclarationValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 256) return null;
  if (/[<>{};\n\r\u0000]/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeCssCustomPropertyName(name: string): string | null {
  const trimmed = name.trim();
  if (!SAFE_CUSTOM_PROPERTY_RE.test(trimmed)) return null;
  return trimmed;
}

function sanitizeStyleTagContent(css: string): string {
  // Prevent untrusted values from terminating the enclosing <style> element.
  return css.replace(/<\/style/gi, "<\\/style");
}

function clampPdfColorChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function parseCssNumberChannel(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? clampPdfColorChannel(percent / 100) : null;
  }
  const channel = Number.parseFloat(trimmed);
  return Number.isFinite(channel) ? clampPdfColorChannel(channel / 255) : null;
}

function compositePdfColor(foreground: PdfRGB, alpha: number, background: PdfRGB): PdfRGB {
  const opacity = clampPdfColorChannel(alpha);
  return [
    foreground[0] * opacity + background[0] * (1 - opacity),
    foreground[1] * opacity + background[1] * (1 - opacity),
    foreground[2] * opacity + background[2] * (1 - opacity),
  ];
}

function parseCssAlpha(value: string | undefined): number | null {
  if (value === undefined) return 1;
  const trimmed = value.trim();
  if (!trimmed) return 1;
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? clampPdfColorChannel(percent / 100) : null;
  }
  const alpha = Number.parseFloat(trimmed);
  return Number.isFinite(alpha) ? clampPdfColorChannel(alpha) : null;
}

export function parseCssColorToPdfRGB(
  value: string,
  background: PdfRGB = [1, 1, 1],
): PdfRGB | null {
  const color = value.trim().toLowerCase();
  if (!color || color === "transparent" || color === "currentcolor") {
    return null;
  }

  const shortHex = /^#([0-9a-f]{3})$/i.exec(color);
  if (shortHex) {
    const hex = shortHex[1];
    return [
      Number.parseInt(hex[0] + hex[0], 16) / 255,
      Number.parseInt(hex[1] + hex[1], 16) / 255,
      Number.parseInt(hex[2] + hex[2], 16) / 255,
    ];
  }

  const longHex = /^#([0-9a-f]{6})$/i.exec(color);
  if (longHex) {
    const hex = longHex[1];
    return [
      Number.parseInt(hex.slice(0, 2), 16) / 255,
      Number.parseInt(hex.slice(2, 4), 16) / 255,
      Number.parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }

  const alphaHex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.exec(color);
  if (alphaHex) {
    const hex = alphaHex[1].length === 4
      ? Array.from(alphaHex[1], (digit) => digit + digit).join("")
      : alphaHex[1];
    const foreground: PdfRGB = [
      Number.parseInt(hex.slice(0, 2), 16) / 255,
      Number.parseInt(hex.slice(2, 4), 16) / 255,
      Number.parseInt(hex.slice(4, 6), 16) / 255,
    ];
    return compositePdfColor(foreground, Number.parseInt(hex.slice(6, 8), 16) / 255, background);
  }

  const functional = /^(?:rgb|rgba)\((.*)\)$/i.exec(color);
  if (functional) {
    const channels = functional[1]
      .trim()
      .replace(/\s*\/\s*/g, " ")
      .split(/\s*,\s*|\s+/)
      .filter((part) => part.length > 0);
    if (channels.length < 3) return null;
    const red = parseCssNumberChannel(channels[0]);
    const green = parseCssNumberChannel(channels[1]);
    const blue = parseCssNumberChannel(channels[2]);
    const alpha = parseCssAlpha(channels[3]);
    if (red === null || green === null || blue === null || alpha === null) return null;
    return compositePdfColor([red, green, blue], alpha, background);
  }

  return null;
}

export function resolvePdfDocumentStyleFromStyle(
  style: Pick<CSSStyleDeclaration, "getPropertyValue">,
): PdfDocumentStyleOptions {
  const pageBackground = parseCssColorToPdfRGB(style.getPropertyValue("--bg-glass-strong")) ?? [1, 1, 1];
  const documentStyle: PdfDocumentStyleOptions = { pageBackground };
  for (const [key, varName] of PDF_DOCUMENT_COLOR_VARS) {
    if (key === "pageBackground") continue;
    const parsed = parseCssColorToPdfRGB(style.getPropertyValue(varName), pageBackground);
    if (parsed) documentStyle[key] = parsed;
  }
  return documentStyle;
}

export function resolvePdfCodeColorsFromStyle(style: Pick<CSSStyleDeclaration, "getPropertyValue">): PdfCodeColorOptions {
  const colors: PdfCodeColorOptions = {};
  for (const [key, varName] of PDF_CODE_COLOR_VARS) {
    const parsed = parseCssColorToPdfRGB(style.getPropertyValue(varName));
    if (parsed) {
      colors[key] = parsed;
    }
  }
  return colors;
}

function resolvePdfCodeColors(): PdfCodeColorOptions | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return undefined;
  }
  const colors = resolvePdfCodeColorsFromStyle(
    window.getComputedStyle(document.documentElement),
  );
  return Object.keys(colors).length > 0 ? colors : undefined;
}

function resolvePdfDocumentStyle(): PdfDocumentStyleOptions | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return undefined;
  }
  return resolvePdfDocumentStyleFromStyle(
    window.getComputedStyle(document.documentElement),
  );
}

function resolvePdfTypography(): { fontSize?: number; lineHeight?: number } {
  if (typeof window === "undefined" || typeof document === "undefined") return {};
  const target = typeof document.querySelector === "function"
    ? document.querySelector<HTMLElement>(".markdown-viewer") ?? document.documentElement
    : document.documentElement;
  const style = window.getComputedStyle(target);
  const fontSizePx = Number.parseFloat(style.fontSize);
  const lineHeightPx = Number.parseFloat(style.lineHeight);
  const fontSize = Number.isFinite(fontSizePx)
    ? Math.max(8, Math.min(14, fontSizePx * 0.75))
    : undefined;
  const lineHeight = Number.isFinite(lineHeightPx) && Number.isFinite(fontSizePx) && fontSizePx > 0
    ? Math.max(1.2, Math.min(2.1, lineHeightPx / fontSizePx))
    : undefined;
  return {
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(lineHeight !== undefined ? { lineHeight } : {}),
  };
}

function readInlineRootDeclarations(): string[] {
  const style = document.documentElement.style;
  const declarations: string[] = [];

  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);
    if (!name) continue;

    const rawValue = style.getPropertyValue(name);
    const safeValue = sanitizeCssDeclarationValue(rawValue);
    if (!safeValue) continue;

    if (name.startsWith("--")) {
      const safeName = sanitizeCssCustomPropertyName(name);
      if (!safeName) continue;
      declarations.push(`  ${safeName}: ${safeValue};`);
      continue;
    }

    if (!SAFE_CSS_PROPERTY_RE.test(name)) continue;
    declarations.push(`  ${name}: ${safeValue};`);
  }

  return declarations;
}

function preserveThemeQueryParams(
  target: URL,
  sourceParams: URLSearchParams,
): void {
  const next = new URLSearchParams();
  const dark = sourceParams.get("d");
  const light = sourceParams.get("l");
  if (dark) next.set("d", dark);
  if (light) next.set("l", light);
  const backgroundMode = parseBackgroundMode(sourceParams.get("bg"));
  setBackgroundModeSearchParam(next, backgroundMode);
  const frameMode = parseFrameMode(sourceParams.get("fm"));
  setFrameModeSearchParam(next, frameMode);
  target.search = next.toString();
}

async function copyTextToClipboard(
  value: string,
  promptLabel: string,
): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (error) {
    console.warn("Clipboard API write failed, falling back to textarea copy", error);
  }

  const textArea = createElement("textarea");
  textArea.value = value;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    const copied = document.execCommand("copy");
    return copied;
  } catch (error) {
    console.warn("execCommand copy failed, falling back to prompt", error);
    window.prompt(promptLabel, value);
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

type ExportDocumentSnapshot = {
  currentTheme: string;
  bodyClassAttr: string;
  styleContent: string;
};

function readDocumentStylesheets(): string {
  return Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n");
      } catch {
        // Can't access cross-origin stylesheets
        return "";
      }
    })
    .join("\n");
}

function appendSerializedThemeCss(
  serialized: string | null,
  mode: "light" | "dark",
  targetArray: string[],
): void {
  if (!serialized) return;
  const config = deserializeTheme(serialized, mode);

  if (config.meta) {
    const fontFamily = sanitizeCssDeclarationValue(config.meta.fontFamily);
    if (fontFamily) targetArray.push(`  font-family: ${fontFamily};`);
    const fontSize = sanitizeCssDeclarationValue(config.meta.fontSize);
    if (fontSize) targetArray.push(`  font-size: ${fontSize};`);
    const fontWeight = sanitizeCssDeclarationValue(config.meta.fontWeight);
    if (fontWeight) targetArray.push(`  font-weight: ${fontWeight};`);
    const lineHeight = sanitizeCssDeclarationValue(config.meta.lineHeight);
    if (lineHeight) targetArray.push(`  line-height: ${lineHeight};`);
    const monoFontFamily = sanitizeCssDeclarationValue(config.meta.monoFontFamily);
    if (monoFontFamily) targetArray.push(`  --font-mono: ${monoFontFamily};`);
  }

  if (config.tokens) {
    for (const [key, value] of Object.entries(config.tokens)) {
      const cssVarName = `--${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
      const safeValue = sanitizeCssDeclarationValue(value);
      if (!safeValue) continue;
      targetArray.push(`  ${cssVarName}: ${safeValue};`);
    }
  }

  if (config.customProperties) {
    for (const [key, value] of Object.entries(config.customProperties)) {
      const safeKey = sanitizeCssCustomPropertyName(key);
      const safeValue = sanitizeCssDeclarationValue(value);
      if (!safeKey || !safeValue) continue;
      targetArray.push(`  ${safeKey}: ${safeValue};`);
    }
  }
}

function buildThemeOverrideStyles(): string {
  const params = new URLSearchParams(window.location.search);
  const darkCustomProps: string[] = [];
  const lightCustomProps: string[] = [];
  appendSerializedThemeCss(params.get("d"), "dark", darkCustomProps);
  appendSerializedThemeCss(params.get("l"), "light", lightCustomProps);

  let themeOverrides = "";
  if (darkCustomProps.length > 0) {
    themeOverrides += `\n:root, :root[data-theme="dark"] {\n${darkCustomProps.join(
      "\n",
    )}\n}`;
  }
  if (lightCustomProps.length > 0) {
    themeOverrides += `\n:root[data-theme="light"] {\n${lightCustomProps.join(
      "\n",
    )}\n}`;
  }

  const inlineRootDeclarations = readInlineRootDeclarations();
  if (inlineRootDeclarations.length > 0) {
    // Preserve exact runtime-applied root styles for exports and inline embeds.
    themeOverrides += `\n:root {\n${inlineRootDeclarations.join("\n")}\n}`;
  }
  return themeOverrides;
}

function captureExportDocumentSnapshot(
  extraStyles: string = "",
): ExportDocumentSnapshot {
  const styles = readDocumentStylesheets();
  const currentTheme =
    document.documentElement.getAttribute("data-theme") || "dark";
  const visualModeClasses = [
    "background-mode-full",
    "background-mode-soft",
    "background-mode-none",
    "frame-mode-full",
    "frame-mode-minimal",
    "frame-mode-none",
  ].filter((className) => document.body.classList.contains(className));
  const bodyClassAttr =
    visualModeClasses.length > 0 ? ` class="${visualModeClasses.join(" ")}"` : "";
  const safeStyleContent = sanitizeStyleTagContent(
    `${styles}${buildThemeOverrideStyles()}${extraStyles}`,
  );
  return {
    currentTheme,
    bodyClassAttr,
    styleContent: safeStyleContent,
  };
}

export function buildExportHtmlDocumentFromViewerHtml(
  viewerHtml: string,
  options: { extraStyles?: string } = {},
): string {
  const snapshot = captureExportDocumentSnapshot(options.extraStyles ?? "");
  const safeViewerHtml = sanitizeHtmlString(viewerHtml);
  return `<!DOCTYPE html>
<html lang="en" data-theme="${snapshot.currentTheme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="SMDP - Simple Markdown Parser">
  <title>Exported Markdown</title>
  <style>
${snapshot.styleContent}
  </style>
</head>
<body${snapshot.bodyClassAttr}>
  <div class="app-shell mode-html">
    <div class="viewer-pane">
      <article class="markdown-viewer">
${safeViewerHtml}
      </article>
    </div>
  </div>
</body>
</html>`;
}

export function buildExportHtmlDocument(view: HtmlView): string | null {
  const viewer = view.shell.querySelector(".markdown-viewer");
  if (!viewer) {
    return null;
  }
  return buildExportHtmlDocumentFromViewerHtml(viewer.innerHTML);
}

/**
 * Export the rendered HTML as a self-contained HTML5 file
 */
export function exportAsHtml(
  view: HtmlView,
  htmlOverride: string | null = null,
): void {
  const html = htmlOverride ?? buildExportHtmlDocument(view);
  if (!html) {
    alert("No rendered content to export");
    return;
  }

  const blob = new Blob([html], { type: "text/html" });
  downloadBlob(blob, `markdown-export-${Date.now()}.html`);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function exportAsCanvasImage(view: CanvasView): Promise<void> {
  try {
    const blob = await exportCanvasAsImageBlob(view.canvas);
    if (!blob || blob.size === 0) {
      alert("No rendered canvas content to export");
      return;
    }
    downloadBlob(blob, `markdown-export-${Date.now()}.png`);
  } catch (error) {
    console.error("Failed to export canvas image", error);
    alert("Failed to export canvas image");
  }
}

export type PdfExportSource = {
  markdown: string | Uint8Array;
  baseUrl?: string;
  allowRawHtml?: boolean;
};

function isEmptyPdfExportSource(source: PdfExportSource): boolean {
  return typeof source.markdown === "string"
    ? source.markdown.trim().length === 0
    : source.markdown.byteLength === 0;
}

async function fetchPdfImage(resolvedSrc: string): Promise<PdfResolvedImage | null> {
  let url: URL;
  try {
    url = new URL(resolvedSrc, window.location.href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    return null;
  }
  const buffer = await response.arrayBuffer();
  const mediaType = response.headers.get("content-type") ?? undefined;
  return {
    bytes: new Uint8Array(buffer),
    cacheKey: url.toString(),
    ...(mediaType !== undefined ? { mediaType } : {}),
  };
}

let pdfEmojiFontPromise: Promise<Uint8Array | undefined> | undefined;

function loadPdfEmojiFont(): Promise<Uint8Array | undefined> {
  if (!pdfEmojiFontPromise) {
    pdfEmojiFontPromise = (async () => {
      if (typeof window === "undefined" || typeof document === "undefined") {
        return undefined;
      }
      try {
        const response = await fetch("/fonts/NotoEmoji-Regular.ttf", {
          credentials: "same-origin",
        });
        if (!response.ok) return undefined;
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        return undefined;
      }
    })();
  }
  return pdfEmojiFontPromise;
}

export async function buildPdfExportBlob(source: PdfExportSource): Promise<Blob> {
  const { MDParser, u8 } = await import("../parser");
  const markdown =
    typeof source.markdown === "string" ? u8(source.markdown) : source.markdown;
  const parser = new MDParser();
  const codeColors = resolvePdfCodeColors();
  const documentStyle = resolvePdfDocumentStyle();
  const typography = resolvePdfTypography();
  const emojiFont = await loadPdfEmojiFont();
  const pdf = await parser.renderToPDF(markdown, {
    ...(source.baseUrl !== undefined ? { baseUrl: source.baseUrl } : {}),
    ...(source.allowRawHtml ? { allowRawHtml: true } : {}),
    ...(codeColors ? { codeColors } : {}),
    ...(documentStyle ? { documentStyle } : {}),
    ...typography,
    maxContentWidth: 468,
    ...(emojiFont ? { emojiFont } : {}),
    imageResolver: fetchPdfImage,
  });
  const pdfBuffer = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(pdfBuffer).set(pdf);
  return new Blob([pdfBuffer], { type: "application/pdf" });
}

export async function exportAsPdf(source: PdfExportSource): Promise<void> {
  if (isEmptyPdfExportSource(source)) {
    alert("No markdown content to export");
    return;
  }

  const blob = await buildPdfExportBlob(source);
  if (!blob || blob.size === 0) {
    alert("No PDF content to export");
    return;
  }
  downloadBlob(blob, `markdown-export-${Date.now()}.pdf`);
}

export type FabMenuOptions = {
  onToggleEditor?: () => void;
  onUploadMarkdownFiles?: (files: readonly File[]) => void | Promise<void>;
  buildHtmlExportSource?: (
    view: HtmlView,
  ) => string | Promise<string | null> | null;
  buildPdfExportSource?: (
    view: HtmlView | CanvasView,
  ) => PdfExportSource | Promise<PdfExportSource | null> | null;
  enableLoadUrlEmbed?: boolean;
  getCurrentLoadUrl?: () => string | null;
  buildInlineEmbedHtmlSource?: (
    view: HtmlView,
  ) => string | Promise<string | null> | null;
  getBookEmbedContext?: () =>
    | BookEmbedContext
    | Promise<BookEmbedContext | null>
    | null;
};

export type BookEmbedContext = {
  entryUrl: string;
  prefetchPayload: string | null;
};

/**
 * Create a FAB menu with all actions
 */
export function createFabMenu(
  view: HtmlView | CanvasView,
  themeEditor: ThemeEditorHandle,
  options: FabMenuOptions = {},
): HTMLElement {
  const isCanvasView = "canvas" in view;
  const isHtmlView = !isCanvasView;

  const setActionContent = (
    button: HTMLButtonElement,
    label: string,
    iconPath: string,
  ): void => {
    button.setAttribute("aria-label", label);
    button.setAttribute("data-tooltip", label);
    replaceWithIcon(button, iconPath);
    const text = createElement("span");
    text.className = "fab-action__label";
    text.textContent = label;
    button.appendChild(text);
  };

  const menu = createElement("div");
  menu.className = "fab-menu";

  // Main FAB button (plus icon)
  const mainButton = createElement("button");
  mainButton.className = "fab-main";
  mainButton.type = "button";
  mainButton.title = "Menu";
  mainButton.setAttribute("aria-expanded", "false");
  mainButton.setAttribute("aria-controls", "smdp-document-actions");
  setActionContent(mainButton, "Actions", MENU_ICON_PATH);
  mainButton.ariaLabel = "Open document actions";
  const mainButtonLabel = mainButton.querySelector<HTMLElement>(
    ".fab-action__label",
  );

  // Actions container
  const actions = createElement("div");
  actions.className = "fab-actions";
  actions.id = "smdp-document-actions";
  actions.setAttribute("aria-label", "Document actions");
  actions.setAttribute("aria-hidden", "true");
  actions.inert = true;

  // Edit button
  const editButton = createElement("button");
  editButton.className = "fab-action";
  editButton.type = "button";
  setActionContent(editButton, "Edit Markdown", EDIT_ICON_PATH);

  const uploadButton = createElement("button");
  uploadButton.className = "fab-action";
  uploadButton.type = "button";
  uploadButton.disabled = !options.onUploadMarkdownFiles;
  setActionContent(uploadButton, "Upload Markdown", UPLOAD_ICON_PATH);

  const uploadInput = createElement("input");
  uploadInput.type = "file";
  uploadInput.accept = ".md";
  uploadInput.multiple = true;
  uploadInput.hidden = true;
  uploadInput.tabIndex = -1;
  uploadInput.setAttribute("aria-hidden", "true");

  // Theme editor button
  const themeButton = createElement("button");
  themeButton.className = "fab-action";
  themeButton.type = "button";
  setActionContent(themeButton, "Theme Editor", THEME_EDITOR_ICON_PATH);

  // Light/Dark theme toggle button
  const themeToggleButton = createElement("button");
  themeToggleButton.className = "fab-action";
  themeToggleButton.type = "button";

  // Function to update theme toggle icon
  const updateThemeIcon = (theme: "light" | "dark") => {
    themeToggleButton.setAttribute("data-theme", theme);
    if (theme === "dark") {
      // Show sun icon (click to go light)
      setActionContent(
        themeToggleButton,
        "Switch to Light Mode",
        THEME_DARK_TO_LIGHT_ICON_PATH,
      );
    } else {
      // Show moon icon (click to go dark)
      setActionContent(
        themeToggleButton,
        "Switch to Dark Mode",
        THEME_LIGHT_TO_DARK_ICON_PATH,
      );
    }
  };

  // Initialize with current theme
  updateThemeIcon(getCurrentTheme());
  const stopThemeChangeSubscription = onThemeChange(({ theme }) => {
    updateThemeIcon(theme);
  });

  // Export button
  const exportButton = createElement("button");
  exportButton.className = "fab-action";
  exportButton.type = "button";
  setActionContent(
    exportButton,
    isCanvasView ? "Export as Image" : "Export as HTML",
    EXPORT_ICON_PATH,
  );

  // PDF export button
  const pdfExportButton = createElement("button");
  pdfExportButton.className = "fab-action";
  pdfExportButton.type = "button";
  setActionContent(pdfExportButton, "Export as PDF", PDF_ICON_PATH);

  // Share button
  const shareButton = createElement("button");
  shareButton.className = "fab-action";
  shareButton.type = "button";
  setActionContent(shareButton, "Share as Data Link", SHARE_ICON_PATH);

  const copyEmbeddedGroup = isHtmlView ? createElement("div") : null;
  const copyEmbeddedButton = isHtmlView ? createElement("button") : null;
  const copyEmbeddedInlineButton = isHtmlView ? createElement("button") : null;
  const copyEmbeddedInlineGzipButton = isHtmlView ? createElement("button") : null;
  const copyEmbeddedLoadUrlButton = isHtmlView ? createElement("button") : null;
  const copyEmbeddedSubmenu = isHtmlView ? createElement("div") : null;
  if (
    copyEmbeddedGroup &&
    copyEmbeddedButton &&
    copyEmbeddedInlineButton &&
    copyEmbeddedInlineGzipButton &&
    copyEmbeddedLoadUrlButton &&
    copyEmbeddedSubmenu
  ) {
    copyEmbeddedGroup.className = "fab-action-group";

    copyEmbeddedButton.className = "fab-action";
    copyEmbeddedButton.type = "button";
    copyEmbeddedButton.setAttribute("aria-haspopup", "true");
    copyEmbeddedButton.setAttribute("aria-expanded", "false");
    copyEmbeddedButton.setAttribute("aria-controls", "smdp-embed-actions");
    setActionContent(
      copyEmbeddedButton,
      "Copy Embedded Iframe",
      EMBED_ICON_PATH,
    );

    copyEmbeddedSubmenu.className = "fab-submenu";
    copyEmbeddedSubmenu.id = "smdp-embed-actions";
    copyEmbeddedSubmenu.setAttribute("aria-hidden", "true");
    copyEmbeddedSubmenu.inert = true;

    copyEmbeddedInlineButton.className = "fab-subaction";
    copyEmbeddedInlineButton.type = "button";
    copyEmbeddedInlineButton.textContent = "Inline HTML Source";

    copyEmbeddedInlineGzipButton.className = "fab-subaction";
    copyEmbeddedInlineGzipButton.type = "button";
    copyEmbeddedInlineGzipButton.textContent = "Inline Gzip Source";

    copyEmbeddedLoadUrlButton.className = "fab-subaction";
    copyEmbeddedLoadUrlButton.type = "button";
    copyEmbeddedLoadUrlButton.textContent = "Current URL Source";
    if (!options.enableLoadUrlEmbed) {
      copyEmbeddedLoadUrlButton.disabled = true;
    }

    copyEmbeddedSubmenu.append(
      copyEmbeddedInlineButton,
      copyEmbeddedInlineGzipButton,
      copyEmbeddedLoadUrlButton,
    );
    copyEmbeddedGroup.append(copyEmbeddedButton, copyEmbeddedSubmenu);
  }

  // Event handlers
  let isMenuOpen = false;
  let isEmbedSubmenuOpen = false;

  const syncEmbedSubmenuState = (): void => {
    if (!copyEmbeddedGroup || !copyEmbeddedButton || !copyEmbeddedSubmenu) return;
    copyEmbeddedGroup.classList.toggle("is-open", isEmbedSubmenuOpen);
    copyEmbeddedButton.setAttribute("aria-expanded", String(isEmbedSubmenuOpen));
    copyEmbeddedSubmenu.setAttribute("aria-hidden", String(!isEmbedSubmenuOpen));
    copyEmbeddedSubmenu.inert = !isEmbedSubmenuOpen;
  };

  const closeEmbedSubmenu = (): void => {
    if (!isEmbedSubmenuOpen) return;
    isEmbedSubmenuOpen = false;
    syncEmbedSubmenuState();
  };

  const syncMenuState = (): void => {
    menu.classList.toggle("is-open", isMenuOpen);
    mainButton.setAttribute("aria-expanded", String(isMenuOpen));
    if (mainButtonLabel) {
      mainButtonLabel.textContent = isMenuOpen ? "Close" : "Actions";
    }
    mainButton.setAttribute(
      "aria-label",
      isMenuOpen ? "Close document actions" : "Open document actions",
    );
    actions.setAttribute("aria-hidden", String(!isMenuOpen));
    actions.inert = !isMenuOpen;
  };

  const closeMenu = (): void => {
    isMenuOpen = false;
    closeEmbedSubmenu();
    syncMenuState();
  };

  mainButton.addEventListener("click", (event) => {
    isMenuOpen = !isMenuOpen;
    if (!isMenuOpen) {
      closeEmbedSubmenu();
    }
    syncMenuState();
    if (isMenuOpen && event.detail === 0) {
      queueMicrotask(() => editButton.focus());
    }
  });

  editButton.addEventListener("click", (e) => {
    e.stopPropagation();
    options.onToggleEditor?.();
    closeMenu();
  });

  uploadButton.addEventListener("click", (e) => {
    e.stopPropagation();
    uploadInput.click();
    closeMenu();
  });

  uploadInput.addEventListener("change", () => {
    const files = Array.from(uploadInput.files ?? []);
    if (files.length === 0 || !options.onUploadMarkdownFiles) {
      uploadInput.value = "";
      return;
    }

    void (async () => {
      uploadButton.disabled = true;
      uploadButton.setAttribute("aria-busy", "true");
      try {
        await options.onUploadMarkdownFiles?.(files);
      } catch (error) {
        console.error("Failed to upload Markdown files", error);
        displayError(
          error instanceof Error
            ? error.message
            : "Unable to upload Markdown files",
        );
      } finally {
        uploadInput.value = "";
        uploadButton.disabled = !options.onUploadMarkdownFiles;
        uploadButton.removeAttribute("aria-busy");
      }
    })();
  });

  themeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    themeEditor.toggle();
    closeMenu();
  });

  themeToggleButton.addEventListener("click", (e) => {
    e.stopPropagation();
    const current = getCurrentTheme();
    const next = current === "dark" ? "light" : "dark";
    // Apply preset first, then merge URL overrides for the selected mode.
    applyTheme(next, themeEditor, false, false, "toggle");
    const hasUrlTheme = applyThemeUrlOverrides(themeEditor);
    if (!hasUrlTheme) {
      emitThemeChange("toggle", next);
    }
    updateThemeIcon(next);
    closeMenu();
  });

  exportButton.addEventListener("click", (e) => {
    e.stopPropagation();
    void (async () => {
      if (isCanvasView) {
        await exportAsCanvasImage(view as CanvasView);
      } else {
        const htmlView = view as HtmlView;
        const htmlOverride =
          (await options.buildHtmlExportSource?.(htmlView)) ?? null;
        exportAsHtml(htmlView, htmlOverride);
      }
      closeMenu();
    })();
  });

  pdfExportButton.addEventListener("click", (e) => {
    e.stopPropagation();
    void (async () => {
      pdfExportButton.disabled = true;
      pdfExportButton.setAttribute("aria-busy", "true");
      try {
        const source =
          (await options.buildPdfExportSource?.(view)) ?? {
            markdown: view.textarea.value,
          };
        if (!source) {
          alert("No markdown content to export");
          return;
        }
        await exportAsPdf(source);
      } catch (error) {
        console.error("Failed to export PDF", error);
        displayError("Unable to export PDF");
      } finally {
        pdfExportButton.disabled = false;
        pdfExportButton.removeAttribute("aria-busy");
        closeMenu();
      }
    })();
  });

  shareButton.addEventListener("click", (e) => {
    e.stopPropagation(); // Prevent click from bubbling to document
    const markdown = view.textarea.value;
    if (!markdown) {
      alert("No content to share. Please add some markdown content first.");
      return;
    }
    void (async () => {
      shareButton.disabled = true;
      shareButton.setAttribute("aria-busy", "true");
      try {
        const base64 = await encodeMarkdownToBase64(markdown);
        const shareUrl = new URL(window.location.href);
        shareUrl.pathname = "/data";
        shareUrl.hash = base64;
        preserveThemeQueryParams(shareUrl, new URLSearchParams(window.location.search));

        const copied = await copyTextToClipboard(
          shareUrl.toString(),
          "Copy this shareable link:",
        );
        if (copied) {
          alert("Shareable link copied to clipboard!");
        }
      } catch (error) {
        console.error("Failed to create shareable link", error);
        displayError("Unable to generate shareable data link");
      } finally {
        shareButton.disabled = false;
        shareButton.removeAttribute("aria-busy");
        closeMenu();
      }
    })();
  });

  const buildEmbeddedIframeSrc = async (
    mode: "inline" | "inlineGzip" | "loadUrl",
  ): Promise<string | null> => {
    const htmlView = view as HtmlView;
    if (mode === "inline") {
      const inlineHtmlSource =
        (await options.buildInlineEmbedHtmlSource?.(htmlView)) ??
        buildExportHtmlDocument(htmlView);
      const html = inlineHtmlSource ?? null;
      if (!html) {
        alert("No rendered content to embed.");
        return null;
      }
      return buildInlineHtmlDataSrc(html);
    }

    if (mode === "inlineGzip") {
      const inlineHtmlSource =
        (await options.buildInlineEmbedHtmlSource?.(htmlView)) ??
        buildExportHtmlDocument(htmlView);
      const html = inlineHtmlSource ?? null;
      if (!html) {
        alert("No rendered content to embed.");
        return null;
      }
      return await buildInlineGzipHtmlDataSrc(html);
    }

    if (!options.enableLoadUrlEmbed) {
      alert("Current load URL embedding is available only in HTML/book modes.");
      return null;
    }
    const loadUrl = options.getCurrentLoadUrl?.();
    if (!loadUrl) {
      alert("Unable to resolve current load URL.");
      return null;
    }
    const bookContext = (await options.getBookEmbedContext?.()) ?? null;
    if (bookContext?.entryUrl) {
      return buildSharedBookEmbedSrc(
        window.location.href,
        loadUrl,
        bookContext.entryUrl,
        bookContext.prefetchPayload,
      );
    }
    return buildSharedEmbedSrc(window.location.href, loadUrl);
  };

  const copyEmbeddedIframe = (mode: "inline" | "inlineGzip" | "loadUrl"): void => {
    void (async () => {
      copyEmbeddedButton?.setAttribute("aria-busy", "true");
      if (copyEmbeddedButton) copyEmbeddedButton.disabled = true;
      if (copyEmbeddedInlineButton) copyEmbeddedInlineButton.disabled = true;
      if (copyEmbeddedInlineGzipButton) copyEmbeddedInlineGzipButton.disabled = true;
      if (copyEmbeddedLoadUrlButton) copyEmbeddedLoadUrlButton.disabled = true;
      try {
        const src = await buildEmbeddedIframeSrc(mode);
        if (!src) return;

        const iframeCode = buildIframeEmbedCode(src);
        const copied = await copyTextToClipboard(
          iframeCode,
          "Copy this embedded iframe code:",
        );
        if (copied) {
          alert("Embedded iframe code copied to clipboard!");
        }
      } catch (error) {
        console.error("Failed to build embedded iframe code", error);
        displayError("Unable to generate embedded iframe code");
      } finally {
        if (copyEmbeddedButton) {
          copyEmbeddedButton.disabled = false;
          copyEmbeddedButton.removeAttribute("aria-busy");
        }
        if (copyEmbeddedInlineButton) {
          copyEmbeddedInlineButton.disabled = false;
        }
        if (copyEmbeddedInlineGzipButton) {
          copyEmbeddedInlineGzipButton.disabled = false;
        }
        if (copyEmbeddedLoadUrlButton) {
          copyEmbeddedLoadUrlButton.disabled = !options.enableLoadUrlEmbed;
        }
        closeMenu();
      }
    })();
  };

  copyEmbeddedButton?.addEventListener("click", (e) => {
    e.stopPropagation();
    isEmbedSubmenuOpen = !isEmbedSubmenuOpen;
    syncEmbedSubmenuState();
  });
  copyEmbeddedInlineButton?.addEventListener("click", (e) => {
    e.stopPropagation();
    copyEmbeddedIframe("inline");
  });
  copyEmbeddedInlineGzipButton?.addEventListener("click", (e) => {
    e.stopPropagation();
    copyEmbeddedIframe("inlineGzip");
  });
  copyEmbeddedLoadUrlButton?.addEventListener("click", (e) => {
    e.stopPropagation();
    copyEmbeddedIframe("loadUrl");
  });

  // Close menu when clicking outside
  const onDocumentClick = (e: Event) => {
    if (isMenuOpen && !menu.contains(e.target as Node)) {
      closeMenu();
    }
  };
  const onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !isMenuOpen) return;
    event.preventDefault();
    closeMenu();
    mainButton.focus();
  };
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);
  window.addEventListener(
    "pagehide",
    () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKeydown);
      stopThemeChangeSubscription();
    },
    { once: true },
  );

  if (copyEmbeddedGroup) {
    actions.append(
      editButton,
      uploadButton,
      themeButton,
      themeToggleButton,
      exportButton,
      pdfExportButton,
      shareButton,
      copyEmbeddedGroup,
    );
  } else {
    actions.append(
      editButton,
      uploadButton,
      themeButton,
      themeToggleButton,
      exportButton,
      pdfExportButton,
      shareButton,
    );
  }
  menu.append(uploadInput, mainButton, actions);

  return menu;
}

export function displayError(message: string): void {
  const alert = createElement("div");
  alert.className = "error-banner";
  alert.role = "alert";
  alert.setAttribute("aria-live", "polite");
  alert.textContent = message;
  document.body.appendChild(alert);
}
