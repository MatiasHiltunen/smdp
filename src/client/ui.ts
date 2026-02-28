import type { ThemeEditorHandle } from "../theme/theme-editor";
import {
  applyTheme,
  applyThemeUrlOverrides,
  getCurrentTheme,
} from "./theme";
import type { CanvasView, HtmlView } from "./views";
import { createElement } from "./dom";
import { encodeMarkdownToBase64 } from "../data-link";
import { deserializeTheme } from "../theme/theme-serializer";
import { emitThemeChange } from "./theme-events";
import { exportCanvasAsImageBlob } from "../parser/canvas-renderer";
import {
  buildIframeEmbedCode,
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
${viewerHtml}
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

  // Create blob and download
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = createElement("a");
  a.href = url;
  a.download = `markdown-export-${Date.now()}.html`;
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
    const url = URL.createObjectURL(blob);
    const a = createElement("a");
    a.href = url;
    a.download = `markdown-export-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Failed to export canvas image", error);
    alert("Failed to export canvas image");
  }
}

export type FabMenuOptions = {
  onToggleEditor?: () => void;
  buildHtmlExportSource?: (
    view: HtmlView,
  ) => string | Promise<string | null> | null;
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

  const menu = createElement("div");
  menu.className = "fab-menu";

  // Main FAB button (plus icon)
  const mainButton = createElement("button");
  mainButton.className = "fab-main";
  mainButton.type = "button";
  mainButton.title = "Menu";
  mainButton.ariaLabel = "Toggle menu";
  mainButton.setAttribute("aria-expanded", "false");
  mainButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1Z" fill="currentColor"/>
    </svg>
  `;

  // Actions container
  const actions = createElement("div");
  actions.className = "fab-actions";

  // Edit button
  const editButton = createElement("button");
  editButton.className = "fab-action";
  editButton.type = "button";
  editButton.setAttribute("data-tooltip", "Edit Markdown");
  editButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M4.5 20a.5.5 0 0 1-.5-.5v-3.086a1 1 0 0 1 .293-.707L14.586 5.414a2 2 0 0 1 2.828 0l1.172 1.172a2 2 0 0 1 0 2.828L8.293 20.293a1 1 0 0 1-.707.293H4.5Zm12.379-13.207a.5.5 0 0 0-.707 0L6 16.964V19h2.036l10.172-10.172a.5.5 0 0 0 0-.707l-1.329-1.328Z" fill="currentColor"/>
    </svg>
  `;

  // Theme editor button
  const themeButton = createElement("button");
  themeButton.className = "fab-action";
  themeButton.type = "button";
  themeButton.setAttribute("data-tooltip", "Theme Editor");
  themeButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9Zm0 2a7 7 0 0 0-7 7 7 7 0 0 0 7 7V5Z" fill="currentColor"/>
    </svg>
  `;

  // Light/Dark theme toggle button
  const themeToggleButton = createElement("button");
  themeToggleButton.className = "fab-action";
  themeToggleButton.type = "button";

  // Function to update theme toggle icon
  const updateThemeIcon = (theme: "light" | "dark") => {
    themeToggleButton.setAttribute("data-theme", theme);
    if (theme === "dark") {
      // Show sun icon (click to go light)
      themeToggleButton.setAttribute("data-tooltip", "Switch to Light Mode");
      themeToggleButton.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
          <path d="M12 2a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 17a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm9-8a1 1 0 0 1 0 2h-1a1 1 0 1 1 0-2h1ZM4 11a1 1 0 1 0 0 2H3a1 1 0 1 0 0-2h1Zm14.071-5.071a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0ZM8.05 15.95a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0Zm9.9 0a1 1 0 0 1 1.414 0l.707.707a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 0 1 0-1.414ZM8.05 5.93a1 1 0 0 0-1.414 0l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707a1 1 0 0 0 0-1.414ZM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-7 5a7 7 0 1 1 14 0 7 7 0 0 1-14 0Z" fill="currentColor"/>
        </svg>
      `;
    } else {
      // Show moon icon (click to go dark)
      themeToggleButton.setAttribute("data-tooltip", "Switch to Dark Mode");
      themeToggleButton.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
          <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1Z" fill="currentColor"/>
        </svg>
      `;
    }
  };

  // Initialize with current theme
  updateThemeIcon(getCurrentTheme());

  // Export button
  const exportButton = createElement("button");
  exportButton.className = "fab-action";
  exportButton.type = "button";
  exportButton.setAttribute(
    "data-tooltip",
    isCanvasView ? "Export as Image" : "Export as HTML",
  );
  exportButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M13 3a1 1 0 1 0-2 0v12.586l-3.293-3.293a1 1 0 0 0-1.414 1.414l5 5a1 1 0 0 0 1.414 0l5-5a1 1 0 0 0-1.414-1.414L13 15.586V3ZM4 17a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4Z" fill="currentColor"/>
    </svg>
  `;

  // Share button
  const shareButton = createElement("button");
  shareButton.className = "fab-action";
  shareButton.type = "button";
  shareButton.setAttribute("data-tooltip", "Share as Data Link");
  shareButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M18 3a3 3 0 1 1-2.668 4.301l-6.01 3.004a3 3 0 0 1 0 2.39l6.01 3.004a3 3 0 1 1-.898 1.79l-6.01-3.004a3 3 0 1 1 0-4.98l6.01-3.004A3 3 0 0 1 18 3Z" fill="currentColor"/>
    </svg>
  `;

  const copyEmbeddedGroup = isHtmlView ? createElement("div") : null;
  const copyEmbeddedButton = isHtmlView ? createElement("button") : null;
  const copyEmbeddedInlineButton = isHtmlView ? createElement("button") : null;
  const copyEmbeddedLoadUrlButton = isHtmlView ? createElement("button") : null;
  const copyEmbeddedSubmenu = isHtmlView ? createElement("div") : null;
  if (
    copyEmbeddedGroup &&
    copyEmbeddedButton &&
    copyEmbeddedInlineButton &&
    copyEmbeddedLoadUrlButton &&
    copyEmbeddedSubmenu
  ) {
    copyEmbeddedGroup.className = "fab-action-group";

    copyEmbeddedButton.className = "fab-action";
    copyEmbeddedButton.type = "button";
    copyEmbeddedButton.setAttribute("data-tooltip", "Copy Embedded Iframe");
    copyEmbeddedButton.setAttribute("aria-haspopup", "true");
    copyEmbeddedButton.setAttribute("aria-expanded", "false");
    copyEmbeddedButton.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
        <path d="M5 4a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1a1 1 0 1 0-2 0v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1a1 1 0 1 0 0-2H5Zm7 0a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3h-7Zm0 2h7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" fill="currentColor"/>
      </svg>
    `;

    copyEmbeddedSubmenu.className = "fab-submenu";
    copyEmbeddedSubmenu.setAttribute("aria-hidden", "true");

    copyEmbeddedInlineButton.className = "fab-subaction";
    copyEmbeddedInlineButton.type = "button";
    copyEmbeddedInlineButton.textContent = "Inline HTML Source";

    copyEmbeddedLoadUrlButton.className = "fab-subaction";
    copyEmbeddedLoadUrlButton.type = "button";
    copyEmbeddedLoadUrlButton.textContent = "Current URL Source";
    if (!options.enableLoadUrlEmbed) {
      copyEmbeddedLoadUrlButton.disabled = true;
    }

    copyEmbeddedSubmenu.append(copyEmbeddedInlineButton, copyEmbeddedLoadUrlButton);
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
  };

  const closeEmbedSubmenu = (): void => {
    if (!isEmbedSubmenuOpen) return;
    isEmbedSubmenuOpen = false;
    syncEmbedSubmenuState();
  };

  const closeMenu = (): void => {
    isMenuOpen = false;
    menu.classList.remove("is-open");
    mainButton.setAttribute("aria-expanded", "false");
    closeEmbedSubmenu();
  };

  mainButton.addEventListener("click", () => {
    isMenuOpen = !isMenuOpen;
    menu.classList.toggle("is-open", isMenuOpen);
    mainButton.setAttribute("aria-expanded", String(isMenuOpen));
    if (!isMenuOpen) {
      closeEmbedSubmenu();
    }
  });

  editButton.addEventListener("click", (e) => {
    e.stopPropagation();
    options.onToggleEditor?.();
    closeMenu();
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
    mode: "inline" | "loadUrl",
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

  const copyEmbeddedIframe = (mode: "inline" | "loadUrl"): void => {
    void (async () => {
      copyEmbeddedButton?.setAttribute("aria-busy", "true");
      if (copyEmbeddedButton) copyEmbeddedButton.disabled = true;
      if (copyEmbeddedInlineButton) copyEmbeddedInlineButton.disabled = true;
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
  document.addEventListener("click", onDocumentClick);
  window.addEventListener(
    "pagehide",
    () => document.removeEventListener("click", onDocumentClick),
    { once: true },
  );

  if (copyEmbeddedGroup) {
    actions.append(
      editButton,
      themeButton,
      themeToggleButton,
      exportButton,
      shareButton,
      copyEmbeddedGroup,
    );
  } else {
    actions.append(editButton, themeButton, themeToggleButton, exportButton, shareButton);
  }
  menu.append(mainButton, actions);

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
