import type { ThemeEditorHandle } from "../../theme/theme-editor";
import { loadThemeFromUrl } from "../../theme/theme-editor";
import { encodeMarkdownToBase64 } from "../../data-link";
import { applyTheme, getCurrentTheme, getThemeBuilder } from "../theme";
import type { CanvasView, HtmlView } from "../views";
import { assignState, createElement, createStore } from "../dom";
import { exportAsHtml } from "./exporter";
import { displayError } from "./feedback";

type MenuState = {
  open: boolean;
  theme: "light" | "dark";
  busyAction: "share" | null;
};

const ICONS = {
  add: `<svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
    <path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1Z" fill="currentColor"/>
  </svg>`,
  edit: `<svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
    <path d="M4.5 20a.5.5 0 0 1-.5-.5v-3.086a1 1 0 0 1 .293-.707L14.586 5.414a2 2 0 0 1 2.828 0l1.172 1.172a2 2 0 0 1 0 2.828L8.293 20.293a1 1 0 0 1-.707.293H4.5Zm12.379-13.207a.5.5 0 0 0-.707 0L6 16.964V19h2.036l10.172-10.172a.5.5 0 0 0 0-.707l-1.329-1.328Z" fill="currentColor"/>
  </svg>`,
  theme: `<svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
    <path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9Zm0 2a7 7 0 0 0-7 7 7 7 0 0 0 7 7V5Z" fill="currentColor"/>
  </svg>`,
  sun: `<svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
    <path d="M12 2a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 17a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm9-8a1 1 0 0 1 0 2h-1a1 1 0 1 1 0-2h1ZM4 11a1 1 0 1 0 0 2H3a1 1 0 1 0 0-2h1Zm14.071-5.071a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0ZM8.05 15.95a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0Zm9.9 0a1 1 0 0 1 1.414 0l.707.707a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 0 1 0-1.414ZM8.05 5.93a1 1 0 0 0-1.414 0l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707a1 1 0 0 0 0-1.414ZM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-7 5a7 7 0 1 1 14 0 7 7 0 0 1-14 0Z" fill="currentColor"/>
  </svg>`,
  moon: `<svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
    <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1Z" fill="currentColor"/>
  </svg>`,
  export: `<svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
    <path d="M13 3a1 1 0 1 0-2 0v12.586l-3.293-3.293a1 1 0 0 0-1.414 1.414l5 5a1 1 0 0 0 1.414 0l5-5a1 1 0 0 0-1.414-1.414L13 15.586V3ZM4 17a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4Z" fill="currentColor"/>
  </svg>`,
  share: `<svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
    <path d="M18 3a3 3 0 1 1-2.668 4.301l-6.01 3.004a3 3 0 0 1 0 2.39l6.01 3.004a3 3 0 1 1-.898 1.79l-6.01-3.004a3 3 0 1 1 0-4.98l6.01-3.004A3 3 0 0 1 18 3Z" fill="currentColor"/>
  </svg>`,
};

const createActionButton = (tooltip: string, icon: string) =>
  createElement("button", {
    className: "fab-action",
    type: "button",
    dataset: { tooltip },
    ariaLabel: tooltip,
    innerHTML: icon,
  });

export function createFabMenu(
  view: HtmlView | CanvasView,
  themeEditor: ThemeEditorHandle,
  onToggleEditor?: () => void,
): HTMLElement {
  const state = createStore<MenuState>({
    open: false,
    theme: getCurrentTheme(),
    busyAction: null,
  });

  const menu = createElement("div", { className: "fab-menu" });
  const mainButton = createElement("button", {
    className: "fab-main",
    type: "button",
    title: "Menu",
    ariaLabel: "Toggle menu",
  });
  mainButton.innerHTML = ICONS.add;

  const actions = createElement("div", { className: "fab-actions" });

  const editButton = createActionButton("Edit Markdown", ICONS.edit);

  const themeButton = createActionButton("Theme Editor", ICONS.theme);
  
  const themeToggleButton = createActionButton("Switch Theme", ICONS.sun);

  const exportButton = createActionButton("Export as HTML", ICONS.export);

  const shareButton = createActionButton("Share as Data Link", ICONS.share);

  const closeMenu = () => {
    if (!state.state.open) return;
    assignState(state, { open: false });
  };

  const openMenu = () => assignState(state, { open: true });

  state.effect(() => {
    const isOpen = state.state.open;
    menu.classList.toggle("is-open", isOpen);
    mainButton.setAttribute("aria-expanded", String(isOpen));
  });

  state.effect(() => {
    const { theme } = state.state;
    themeToggleButton.dataset.theme = theme;
    const label = theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode";
    themeToggleButton.dataset.tooltip = label;
    themeToggleButton.ariaLabel = label;
    themeToggleButton.innerHTML = theme === "dark" ? ICONS.sun : ICONS.moon;
  });

  state.effect(() => {
    const busy = state.state.busyAction;
    const isSharing = busy === "share";
    shareButton.disabled = isSharing;
    if (isSharing) {
      shareButton.setAttribute("aria-busy", "true");
    } else {
      shareButton.removeAttribute("aria-busy");
    }
  });

  mainButton.addEventListener("click", () => {
    state.state.open ? closeMenu() : openMenu();
  });

  editButton.addEventListener("click", (event) => {
    event.stopPropagation();
    onToggleEditor?.();
    closeMenu();
  });

  themeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    themeEditor.toggle();
    closeMenu();
  });

  themeToggleButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const nextTheme: "light" | "dark" = state.state.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme, themeEditor, false);
    const builder = getThemeBuilder();
    if (loadThemeFromUrl(builder)) {
      builder.apply();
      themeEditor.refresh();
    }
    assignState(state, { theme: nextTheme, open: false });
  });

  exportButton.addEventListener("click", (event) => {
    event.stopPropagation();
    exportAsHtml(view);
    closeMenu();
  });

  shareButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const markdown = view.textarea.value;
    if (!markdown) {
      alert("No content to share. Please add some markdown content first.");
      return;
    }

    assignState(state, { busyAction: "share" });

    void (async () => {
      try {
        const base64 = await encodeMarkdownToBase64(markdown);
        const shareUrl = new URL(window.location.href);
        shareUrl.pathname = "/data";
        shareUrl.hash = base64;

        const currentParams = new URLSearchParams(window.location.search);
        const newParams = new URLSearchParams();
        const darkTheme = currentParams.get("d");
        const lightTheme = currentParams.get("l");
        if (darkTheme) newParams.set("d", darkTheme);
        if (lightTheme) newParams.set("l", lightTheme);
        shareUrl.search = newParams.toString();

        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareUrl.toString());
          alert("Shareable link copied to clipboard!");
        } else {
          const textArea = createElement("textarea", {
            style: {
              position: "fixed",
              left: "-999999px",
              top: "-999999px",
            },
          });
          textArea.value = shareUrl.toString();
          document.body.append(textArea);
          textArea.focus();
          textArea.select();
          try {
            document.execCommand("copy");
            alert("Shareable link copied to clipboard!");
          } catch (error) {
            window.prompt("Copy this shareable link:", shareUrl.toString());
          }
          textArea.remove();
        }
      } catch (error) {
        console.error("Failed to create shareable link", error);
        displayError("Unable to generate shareable data link");
      } finally {
        assignState(state, { busyAction: null, open: false });
      }
    })();
  });

  const handleDocumentClick = (event: MouseEvent) => {
    if (!state.state.open) return;
    if (!menu.contains(event.target as Node)) {
      closeMenu();
    }
  };

  document.addEventListener("click", handleDocumentClick);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.state.open) {
      closeMenu();
      mainButton.focus();
    }
  });

  actions.append(editButton, themeButton, themeToggleButton, exportButton, shareButton);
  menu.append(mainButton, actions);

  return menu;
}
