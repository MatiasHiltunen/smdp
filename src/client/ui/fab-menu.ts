import type { ThemeEditorHandle } from "../../theme/theme-editor";
import { loadThemeFromUrl } from "../../theme/theme-editor";
import { encodeMarkdownToBase64 } from "../../data-link";
import type { CanvasView, HtmlView } from "../views";
import {
  bindAttribute,
  bindClass,
  bindDisabled,
  createElement,
  effect,
  on,
  onClickOutside,
  signal,
  watchAttribute,
} from "../dom";
import type { Signal } from "../dom";
import { applyTheme, getCurrentTheme, getThemeBuilder } from "../theme";
import { exportAsHtml } from "./exporter";
import { displayError } from "./notifications";

type View = HtmlView | CanvasView;

type FabActionElements = {
  button: HTMLButtonElement;
  icon: HTMLElement;
  label: HTMLElement;
  description?: HTMLElement;
};

type FabActionConfig = {
  id: string;
  label: string;
  description?: string;
  icon: string;
  onSelect: () => void | Promise<void>;
  autoClose?: boolean;
  busySignal?: Signal<boolean>;
  setup?: (elements: FabActionElements) => void;
};

const ICONS = {
  menu: `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1Z" fill="currentColor"/>
    </svg>
  `,
  edit: `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M4.5 20a.5.5 0 0 1-.5-.5v-3.086a1 1 0 0 1 .293-.707L14.586 5.414a2 2 0 0 1 2.828 0l1.172 1.172a2 2 0 0 1 0 2.828L8.293 20.293a1 1 0 0 1-.707.293H4.5Zm12.379-13.207a.5.5 0 0 0-.707 0L6 16.964V19h2.036l10.172-10.172a.5.5 0 0 0 0-.707l-1.329-1.328Z" fill="currentColor"/>
    </svg>
  `,
  palette: `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9Zm0 2a7 7 0 0 0-7 7 7 7 0 0 0 7 7V5Z" fill="currentColor"/>
    </svg>
  `,
  sun: `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M12 2a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 17a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm9-8a1 1 0 0 1 0 2h-1a1 1 0 1 1 0-2h1ZM4 11a1 1 0 1 0 0 2H3a1 1 0 1 0 0-2h1Zm14.071-5.071a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0ZM8.05 15.95a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0Zm9.9 0a1 1 0 0 1 1.414 0l.707.707a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 0 1 0-1.414ZM8.05 5.93a1 1 0 0 0-1.414 0l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707a1 1 0 0 0 0-1.414ZM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-7 5a7 7 0 1 1 14 0 7 7 0 0 1-14 0Z" fill="currentColor"/>
    </svg>
  `,
  moon: `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1Z" fill="currentColor"/>
    </svg>
  `,
  export: `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M13 3a1 1 0 1 0-2 0v12.586l-3.293-3.293a1 1 0 0 0-1.414 1.414l5 5a1 1 0 0 0 1.414 0l5-5a1 1 0 0 0-1.414-1.414L13 15.586V3ZM4 17a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H4Z" fill="currentColor"/>
    </svg>
  `,
  share: `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M18 3a3 3 0 1 1-2.668 4.301l-6.01 3.004a3 3 0 0 1 0 2.39l6.01 3.004a3 3 0 1 1-.898 1.79l-6.01-3.004a3 3 0 1 1 0-4.98l6.01-3.004A3 3 0 0 1 18 3Z" fill="currentColor"/>
    </svg>
  `,
};

function uniqueId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createFabMenu(
  view: View,
  themeEditor: ThemeEditorHandle,
  onToggleEditor?: () => void,
): HTMLElement {
  const isOpen = signal(false);
  const themeMode = signal<"light" | "dark">(getCurrentTheme());
  const shareBusy = signal(false);

  const menu = createElement("div", {
    className: "fab-menu",
    attrs: {
      "data-open": "false",
    },
  });

  const actionsId = uniqueId("fab-actions");

  const mainButton = createElement("button", {
    className: "fab-main",
    attrs: {
      type: "button",
      "aria-haspopup": "true",
      "aria-expanded": "false",
      "aria-controls": actionsId,
      "aria-label": "Open quick actions",
    },
    html: ICONS.menu,
    children: [
      createElement("span", { className: "fab-main__text", text: "Quick actions" }),
    ],
  }) as HTMLButtonElement;

  const actions = createElement("div", {
    className: "fab-actions",
    attrs: {
      id: actionsId,
      role: "menu",
    },
  });

  menu.append(mainButton, actions);

  const closeMenu = () => isOpen.set(false);
  const openMenu = () => isOpen.set(true);
  const toggleMenu = () => isOpen.set((open) => !open);

  const focusFirstAction = () => {
    const first = actions.querySelector<HTMLButtonElement>(".fab-action");
    first?.focus({ preventScroll: true });
  };

  const createAction = (config: FabActionConfig): FabActionElements => {
    const labelId = uniqueId(`fab-action-${config.id}`);
    const descriptionId = `${labelId}-desc`;

    const icon = createElement("span", {
      className: "fab-action__icon",
      html: config.icon,
    });

    const label = createElement("span", {
      className: "fab-action__label",
      attrs: { id: labelId },
      text: config.label,
    });

    const description = config.description
      ? createElement("span", {
          className: "fab-action__description",
          attrs: { id: descriptionId },
          text: config.description,
        })
      : null;

    const button = createElement("button", {
      className: "fab-action",
      attrs: {
        type: "button",
        role: "menuitem",
        "data-action": config.id,
        "aria-labelledby": description ? `${labelId} ${descriptionId}` : labelId,
      },
      children: [
        icon,
        createElement("span", {
          className: "fab-action__body",
          children: description ? [label, description] : [label],
        }),
      ],
    }) as HTMLButtonElement;

    if (!description) {
      button.setAttribute("aria-label", config.label);
    }

    const elements: FabActionElements = { button, icon, label };
    if (description) {
      elements.description = description;
    }

    on(button, "click", () => {
      const result = config.onSelect();
      if (result && typeof (result as Promise<unknown>).then === "function") {
        if (config.autoClose !== false) {
          (result as Promise<unknown>).finally(() => closeMenu());
        }
      } else if (config.autoClose !== false) {
        closeMenu();
      }
    });

    if (config.busySignal) {
      bindDisabled(button, config.busySignal);
      bindClass(button, "is-busy", () => config.busySignal!.get());
      bindAttribute(button, "aria-busy", () => (config.busySignal!.get() ? "true" : null));
    }

    config.setup?.(elements);

    return elements;
  };

  const builder = getThemeBuilder();

  const actionsConfig: FabActionConfig[] = [
    {
      id: "edit",
      label: "Edit markdown",
      description: "Toggle the in-app editor",
      icon: ICONS.edit,
      onSelect: () => {
        onToggleEditor?.();
      },
    },
    {
      id: "theme-editor",
      label: "Theme designer",
      description: "Fine-tune colors and typography",
      icon: ICONS.palette,
      onSelect: () => {
        themeEditor.toggle(true);
      },
    },
    {
      id: "theme-mode",
      label: "Switch theme",
      description: "Toggle light or dark mode",
      icon: ICONS.sun,
      onSelect: () => {
        const current = themeMode.get();
        const next = current === "dark" ? "light" : "dark";
        applyTheme(next, themeEditor, false);
        const hasCustomizations = loadThemeFromUrl(builder);
        if (hasCustomizations) {
          builder.apply();
          themeEditor.refresh();
        }
        themeMode.set(next);
      },
      setup: ({ button, icon, label }) => {
        effect(() => {
          const mode = themeMode.get();
          const nextLabel = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
          label.textContent = nextLabel;
          icon.innerHTML = mode === "dark" ? ICONS.sun : ICONS.moon;
          button.setAttribute("aria-label", nextLabel);
          button.dataset.theme = mode;
        });
      },
    },
    {
      id: "export",
      label: "Export HTML",
      description: "Download a standalone file",
      icon: ICONS.export,
      onSelect: () => {
        exportAsHtml(view);
      },
    },
    {
      id: "share",
      label: "Share preview",
      description: "Copy a link with embedded markdown",
      icon: ICONS.share,
      busySignal: shareBusy,
      autoClose: false,
      onSelect: async () => {
        const markdown = view.textarea.value;
        if (!markdown.trim()) {
          displayError("No content to share. Please add some markdown first.");
          return;
        }

        shareBusy.set(true);
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

          const value = shareUrl.toString();
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            alert("Shareable link copied to clipboard!");
          } else {
            const fallback = createElement("textarea", {
              attrs: { "aria-hidden": "true" },
              style: {
                position: "fixed",
                left: "-9999px",
                top: "-9999px",
              },
            }) as HTMLTextAreaElement;
            fallback.value = value;
            document.body.appendChild(fallback);
            fallback.select();
            try {
              document.execCommand("copy");
              alert("Shareable link copied to clipboard!");
            } catch {
              window.prompt("Copy this shareable link:", value);
            }
            document.body.removeChild(fallback);
          }

          closeMenu();
        } catch (error) {
          console.error("Failed to create shareable link", error);
          displayError("Unable to generate shareable data link");
        } finally {
          shareBusy.set(false);
        }
      },
    },
  ];

  actionsConfig.forEach((config) => {
    const { button } = createAction(config);
    actions.appendChild(button);
  });

  on(mainButton, "click", () => {
    toggleMenu();
    if (isOpen.get()) {
      focusFirstAction();
    }
  });

  on(mainButton, "keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === "ArrowDown" || keyboard.key === "Enter" || keyboard.key === " ") {
      keyboard.preventDefault();
      if (!isOpen.get()) {
        openMenu();
      }
      focusFirstAction();
    }
  });

  on(actions, "keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    const buttons = Array.from(actions.querySelectorAll<HTMLButtonElement>(".fab-action"));
    if (buttons.length === 0) {
      return;
    }

    if (keyboard.key === "Escape") {
      keyboard.preventDefault();
      closeMenu();
      mainButton.focus({ preventScroll: true });
      return;
    }

    if (keyboard.key === "ArrowDown" || keyboard.key === "ArrowUp") {
      keyboard.preventDefault();
      const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const delta = keyboard.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus({ preventScroll: true });
    }
  });

  on(document, "keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === "Escape" && isOpen.get()) {
      closeMenu();
      mainButton.focus({ preventScroll: true });
    }
  });

  onClickOutside(menu, () => {
    if (isOpen.get()) {
      closeMenu();
    }
  });

  bindAttribute(mainButton, "aria-expanded", () => (isOpen.get() ? "true" : "false"));
  bindAttribute(menu, "data-open", () => (isOpen.get() ? "true" : "false"));
  bindClass(menu, "is-open", () => isOpen.get());
  bindClass(document.body, "fab-menu-open", () => isOpen.get());

  watchAttribute(document.documentElement, "data-theme", (value) => {
    const normalized = value === "light" ? "light" : "dark";
    themeMode.set(normalized);
  });

  return menu;
}
