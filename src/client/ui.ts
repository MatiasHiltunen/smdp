import type { ThemeEditorHandle } from "../theme/theme-editor";
import { applyTheme, getCurrentTheme } from "./theme";
import type { CanvasView, HtmlView } from "./views";
import { createElement } from "./dom";
import { loadThemeFromUrl } from "../theme/theme-editor";
import { getThemeBuilder } from "./theme";
import { encodeMarkdownToBase64 } from "../data-link";
import { deserializeTheme } from "../theme/theme-serializer";

/**
 * Export the rendered HTML as a self-contained HTML5 file
 */
export function exportAsHtml(view: HtmlView | CanvasView): void {
  const viewer = view.shell.querySelector(".markdown-viewer");
  if (!viewer) {
    alert("No rendered content to export");
    return;
  }

  // Get all styles from the document
  const styles = Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n");
      } catch (e) {
        // Can't access cross-origin stylesheets
        return "";
      }
    })
    .join("\n");

  // Get current theme attribute
  const currentTheme =
    document.documentElement.getAttribute("data-theme") || "dark";

  // Parse URL parameters to extract compact theme customizations
  const params = new URLSearchParams(window.location.search);
  const darkCustomProps: string[] = [];
  const lightCustomProps: string[] = [];

  // Helper to convert deserialized theme config to CSS properties
  const convertThemeToCss = (serialized: string | null, mode: 'light' | 'dark', targetArray: string[]) => {
    if (!serialized) return;
    
    const config = deserializeTheme(serialized, mode);
    
    // Add meta properties
    if (config.meta) {
      if (config.meta.fontFamily) targetArray.push(`  font-family: ${config.meta.fontFamily};`);
      if (config.meta.fontSize) targetArray.push(`  font-size: ${config.meta.fontSize};`);
      if (config.meta.fontWeight) targetArray.push(`  font-weight: ${config.meta.fontWeight};`);
      if (config.meta.lineHeight) targetArray.push(`  line-height: ${config.meta.lineHeight};`);
      if (config.meta.monoFontFamily) targetArray.push(`  --font-mono: ${config.meta.monoFontFamily};`);
    }

    // Add token properties (converted to CSS variables)
    if (config.tokens) {
      Object.entries(config.tokens).forEach(([key, value]) => {
        // Convert camelCase token names to kebab-case CSS variable names
        const cssVarName = `--${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
        targetArray.push(`  ${cssVarName}: ${value};`);
      });
    }

    // Add custom properties
    if (config.customProperties) {
      Object.entries(config.customProperties).forEach(([key, value]) => {
        targetArray.push(`  ${key}: ${value};`);
      });
    }
  };

  // Extract dark mode customizations
  convertThemeToCss(params.get('d'), 'dark', darkCustomProps);

  // Extract light mode customizations
  convertThemeToCss(params.get('l'), 'light', lightCustomProps);

  // Build theme override styles
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

  // Create HTML5 document
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

/**
 * Create a FAB menu with all actions
 */
export function createFabMenu(
  view: HtmlView | CanvasView,
  themeEditor: ThemeEditorHandle,
  onToggleEditor?: () => void,
): HTMLElement {
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

  // Export HTML button
  const exportButton = createElement("button");
  exportButton.className = "fab-action";
  exportButton.type = "button";
  exportButton.setAttribute("data-tooltip", "Export as HTML");
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

  // Event handlers
  let isMenuOpen = false;

  mainButton.addEventListener("click", () => {
    isMenuOpen = !isMenuOpen;
    menu.classList.toggle("is-open", isMenuOpen);
    mainButton.setAttribute("aria-expanded", String(isMenuOpen));
  });

  editButton.addEventListener("click", (e) => {
    e.stopPropagation();
    onToggleEditor?.();
    isMenuOpen = false;
    menu.classList.remove("is-open");
    mainButton.setAttribute("aria-expanded", "false");
  });

  themeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    themeEditor.toggle();
    isMenuOpen = false;
    menu.classList.remove("is-open");
    mainButton.setAttribute("aria-expanded", "false");
  });

  themeToggleButton.addEventListener("click", (e) => {
    e.stopPropagation();
    const themeBuilder = getThemeBuilder();
    const current = getCurrentTheme();
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next, themeEditor, false); // Apply new theme defaults
    // Reload customizations from URL if present
    const hasUrlTheme = loadThemeFromUrl(themeBuilder);
    if (hasUrlTheme) {
      themeBuilder.apply();
      themeEditor?.refresh();
    }
    updateThemeIcon(next);
    isMenuOpen = false;
    menu.classList.remove("is-open");
    mainButton.setAttribute("aria-expanded", "false");
  });

  exportButton.addEventListener("click", (e) => {
    e.stopPropagation();
    exportAsHtml(view);
    isMenuOpen = false;
    menu.classList.remove("is-open");
    mainButton.setAttribute("aria-expanded", "false");
  });

  shareButton.addEventListener("click", (e) => {
    e.stopPropagation(); // Prevent click from bubbling to document
    const markdown = view.textarea.value;
    if (!markdown) {
      alert("No content to share. Please add some markdown content first.");
      return;
    }
    console.log("Sharing markdown:", markdown);
    void (async () => {
      shareButton.disabled = true;
      shareButton.setAttribute("aria-busy", "true");
      try {
        const base64 = await encodeMarkdownToBase64(markdown);
        console.log("Encoded base64:", base64);
        const shareUrl = new URL(window.location.href);
        shareUrl.pathname = `/data/${encodeURIComponent(base64)}`;
        shareUrl.hash = "";
        
        // Preserve theme customizations from current URL
        const currentParams = new URLSearchParams(window.location.search);
        const newParams = new URLSearchParams();
        
        // Copy theme params (d and l) to shared URL
        const darkTheme = currentParams.get('d');
        const lightTheme = currentParams.get('l');
        if (darkTheme) newParams.set('d', darkTheme);
        if (lightTheme) newParams.set('l', lightTheme);
        
        shareUrl.search = newParams.toString();
        
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareUrl.toString());
          alert("Shareable link copied to clipboard!");
        } else {
          // Fallback for browsers without clipboard API
          const textArea = createElement("textarea");
          textArea.value = shareUrl.toString();
          textArea.style.position = "fixed";
          textArea.style.left = "-999999px";
          textArea.style.top = "-999999px";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          try {
            document.execCommand("copy");
            alert("Shareable link copied to clipboard!");
          } catch (err) {
            window.prompt("Copy this shareable link:", shareUrl.toString());
          }
          document.body.removeChild(textArea);
        }
      } catch (error) {
        console.error("Failed to create shareable link", error);
        displayError("Unable to generate shareable data link");
      } finally {
        shareButton.disabled = false;
        shareButton.removeAttribute("aria-busy");
        isMenuOpen = false;
        menu.classList.remove("is-open");
        mainButton.setAttribute("aria-expanded", "false");
      }
    })();
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (isMenuOpen && !menu.contains(e.target as Node)) {
      isMenuOpen = false;
      menu.classList.remove("is-open");
      mainButton.setAttribute("aria-expanded", "false");
    }
  });

  actions.append(editButton, themeButton, themeToggleButton, exportButton, shareButton);
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
