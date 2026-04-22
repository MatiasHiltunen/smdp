import {
  createElement,
  createSvgIcon,
} from "./dom";
import {
  EditorStateController,
  getEditorPagePathValue,
  getCurrentEditorPage,
  type EditorDocumentSnapshot,
} from "./editor-model";

type EditorWindowOptions = {
  host: HTMLElement;
  textarea: HTMLTextAreaElement;
  controller: EditorStateController;
  externalWindow?: boolean;
  onRequestClose?: () => void;
  onRequestOpenExternal?: () => void;
  onRequestInstall?: () => void | Promise<void>;
  subscribeInstallAvailability?: (
    listener: (available: boolean) => void,
  ) => () => void;
};

export type EditorWindowHandle = {
  root: HTMLElement;
  setOpen(open: boolean): void;
  focusEditor(): void;
  destroy(): void;
};

type WindowRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const WINDOW_STORAGE_KEY = "smdp-editor-window-rect";
const MOBILE_QUERY = "(max-width: 959px)";
const MIN_WIDTH = 340;
const MIN_HEIGHT = 260;
const DEFAULT_WIDTH = 560;
const DEFAULT_HEIGHT = 520;
const WINDOW_MARGIN = 16;

const DRAG_ICON_PATH =
  "M7 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm0 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm0 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm10-11a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm0 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm0 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z";
const CLOSE_ICON_PATH =
  "M17.53 6.47a.75.75 0 0 0-1.06 0L12 10.94 7.53 6.47a.75.75 0 0 0-1.06 1.06L10.94 12l-4.47 4.47a.75.75 0 0 0 1.06 1.06L12 13.06l4.47 4.47a.75.75 0 0 0 1.06-1.06L13.06 12l4.47-4.47a.75.75 0 0 0 0-1.06Z";
const EXTERNAL_ICON_PATH =
  "M14 4a1 1 0 1 0 0 2h2.586L11.293 11.293a1 1 0 1 0 1.414 1.414L18 7.414V10a1 1 0 1 0 2 0V4h-6ZM6 6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4a1 1 0 1 0-2 0v4H6V8h4a1 1 0 1 0 0-2H6Z";
const INSTALL_ICON_PATH =
  "M12 3a1 1 0 0 1 1 1v8.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L11 12.586V4a1 1 0 0 1 1-1ZM5 19a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H5Z";
const ADD_ICON_PATH =
  "M12 5a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H6a1 1 0 1 1 0-2h5V6a1 1 0 0 1 1-1Z";
const DELETE_ICON_PATH =
  "M9 3a1 1 0 0 0-1 1v1H5a1 1 0 1 0 0 2h.583l.81 10.53A2 2 0 0 0 8.386 20h7.228a2 2 0 0 0 1.993-1.47L18.417 7H19a1 1 0 1 0 0-2h-3V4a1 1 0 0 0-1-1H9Zm5 2h-4V5h4V5Zm-5.61 2h7.22l-.77 10H9.16l-.77-10Z";
const PAGES_ICON_PATH =
  "M5 5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5Zm9 0a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2V5Z";

function readPersistedRect(): WindowRect | null {
  try {
    const raw = window.localStorage.getItem(WINDOW_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as WindowRect;
    if (
      typeof parsed.left !== "number" ||
      typeof parsed.top !== "number" ||
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistRect(rect: WindowRect): void {
  try {
    window.localStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify(rect));
  } catch {
    // Ignore persistence failures.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function constrainRect(rect: WindowRect): WindowRect {
  const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - WINDOW_MARGIN * 2);
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - WINDOW_MARGIN * 2);
  const width = clamp(rect.width, MIN_WIDTH, maxWidth);
  const height = clamp(rect.height, MIN_HEIGHT, maxHeight);
  const left = clamp(rect.left, WINDOW_MARGIN, window.innerWidth - width - WINDOW_MARGIN);
  const top = clamp(rect.top, WINDOW_MARGIN, window.innerHeight - height - WINDOW_MARGIN);
  return { left, top, width, height };
}

function buildDefaultRect(): WindowRect {
  return constrainRect({
    left: window.innerWidth - DEFAULT_WIDTH - 28,
    top: 88,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });
}

function updateTextareaPreservingSelection(
  textarea: HTMLTextAreaElement,
  nextValue: string,
): void {
  if (textarea.value === nextValue) {
    return;
  }
  const { selectionStart, selectionEnd } = textarea;
  textarea.value = nextValue;
  const nextStart = Math.min(selectionStart, nextValue.length);
  const nextEnd = Math.min(selectionEnd, nextValue.length);
  textarea.setSelectionRange(nextStart, nextEnd);
}

function formatCurrentStats(markdown: string): string {
  const lines = markdown.length === 0 ? 1 : markdown.split(/\r?\n/).length;
  const words = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
  return `${lines} lines | ${words} words | ${markdown.length} chars`;
}

function createHeaderAction(
  label: string,
  pathData: string,
  options: { tooltip?: string; compact?: boolean } = {},
): HTMLButtonElement {
  const button = createElement("button");
  button.className = `editor-window__action${options.compact ? " is-compact" : ""}`;
  button.type = "button";
  button.title = options.tooltip ?? label;
  button.setAttribute("aria-label", label);
  button.appendChild(createSvgIcon(pathData, { className: "icon" }));
  return button;
}

export function createEditorWindow(
  options: EditorWindowOptions,
): EditorWindowHandle {
  const compactQuery = window.matchMedia(MOBILE_QUERY);
  let isCompact = compactQuery.matches;
  let isOpen = !!options.externalWindow;
  let pagesOpen = !isCompact;
  let suppressInput = false;
  let rect = readPersistedRect() ?? buildDefaultRect();

  options.host.replaceChildren();
  options.host.classList.add("editor-pane-host");

  const root = createElement("div");
  root.className = "editor-window";
  if (options.externalWindow) {
    root.classList.add("is-external");
  }

  const header = createElement("header");
  header.className = "editor-window__header";

  const dragHandle = createElement("div");
  dragHandle.className = "editor-window__drag";
  dragHandle.setAttribute("role", "toolbar");
  dragHandle.appendChild(createSvgIcon(DRAG_ICON_PATH, { className: "icon" }));

  const heading = createElement("div");
  heading.className = "editor-window__heading";

  const title = createElement("strong");
  title.className = "editor-window__title";
  title.textContent = options.externalWindow ? "External Editor" : "Editor";

  const subtitle = createElement("span");
  subtitle.className = "editor-window__subtitle";

  heading.append(title, subtitle);
  dragHandle.appendChild(heading);

  const actionGroup = createElement("div");
  actionGroup.className = "editor-window__actions";

  const pagesButton = createHeaderAction("Toggle pages", PAGES_ICON_PATH, {
    tooltip: "Toggle page list",
    compact: true,
  });

  const installButton = createHeaderAction("Install app", INSTALL_ICON_PATH, {
    tooltip: "Install app",
  });
  installButton.hidden = true;

  const externalButton = createHeaderAction(
    "Open in external window",
    EXTERNAL_ICON_PATH,
    { tooltip: "Open in external window" },
  );
  if (options.externalWindow) {
    externalButton.hidden = true;
  }

  const closeButton = createHeaderAction("Close editor", CLOSE_ICON_PATH, {
    tooltip: options.externalWindow ? "Close window" : "Close editor",
  });

  actionGroup.append(pagesButton, installButton, externalButton, closeButton);
  header.append(dragHandle, actionGroup);

  const body = createElement("div");
  body.className = "editor-window__body";

  const sidebar = createElement("aside");
  sidebar.className = "editor-window__sidebar";

  const sidebarHeader = createElement("div");
  sidebarHeader.className = "editor-window__sidebar-header";

  const sidebarTitle = createElement("strong");
  sidebarTitle.textContent = "Pages";

  const addPageButton = createHeaderAction("Add page", ADD_ICON_PATH, {
    tooltip: "Add page",
  });
  addPageButton.classList.add("is-primary");

  sidebarHeader.append(sidebarTitle, addPageButton);

  const pageList = createElement("div");
  pageList.className = "editor-window__page-list";

  sidebar.append(sidebarHeader, pageList);

  const main = createElement("section");
  main.className = "editor-window__main";

  const metaRow = createElement("div");
  metaRow.className = "editor-window__meta";

  const titleField = createElement("label");
  titleField.className = "editor-window__field";
  const titleLabel = createElement("span");
  titleLabel.className = "editor-window__label";
  titleLabel.textContent = "Page title";
  const titleInput = createElement("input");
  titleInput.className = "editor-window__input";
  titleInput.type = "text";
  titleField.append(titleLabel, titleInput);

  const pathField = createElement("label");
  pathField.className = "editor-window__field";
  const pathLabel = createElement("span");
  pathLabel.className = "editor-window__label";
  pathLabel.textContent = "Page path";
  const pathInput = createElement("input");
  pathInput.className = "editor-window__input";
  pathInput.type = "text";
  pathField.append(pathLabel, pathInput);

  const pageActions = createElement("div");
  pageActions.className = "editor-window__page-actions";

  const deletePageButton = createHeaderAction("Delete page", DELETE_ICON_PATH, {
    tooltip: "Delete current page",
  });
  pageActions.appendChild(deletePageButton);

  metaRow.append(titleField, pathField, pageActions);

  const editorFrame = createElement("div");
  editorFrame.className = "editor-window__editor-frame";
  options.textarea.className = "editor editor-window__textarea";
  options.textarea.spellcheck = false;
  editorFrame.appendChild(options.textarea);

  const footer = createElement("footer");
  footer.className = "editor-window__footer";

  const status = createElement("span");
  status.className = "editor-window__status";

  const modeBadge = createElement("span");
  modeBadge.className = "editor-window__badge";

  footer.append(modeBadge, status);
  main.append(metaRow, editorFrame, footer);

  body.append(sidebar, main);

  const resizeHandle = createElement("button");
  resizeHandle.className = "editor-window__resize";
  resizeHandle.type = "button";
  resizeHandle.setAttribute("aria-label", "Resize editor window");

  root.append(header, body, resizeHandle);
  options.host.appendChild(root);

  const applyRect = (): void => {
    root.classList.toggle("is-open", isOpen || !!options.externalWindow);
    root.classList.toggle("is-mobile", isCompact);
    root.classList.toggle("show-pages", pagesOpen);
    if (isCompact || options.externalWindow) {
      root.style.removeProperty("left");
      root.style.removeProperty("top");
      root.style.removeProperty("width");
      root.style.removeProperty("height");
      return;
    }
    rect = constrainRect(rect);
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.width = `${rect.width}px`;
    root.style.height = `${rect.height}px`;
  };

  const refresh = (snapshot: EditorDocumentSnapshot): void => {
    const currentPage = getCurrentEditorPage(snapshot);
    const isBook = snapshot.mode === "book";
    const canDelete = isBook && snapshot.pages.length > 1;

    pagesButton.hidden = !isBook;
    addPageButton.hidden = !isBook;
    deletePageButton.disabled = !canDelete;
    sidebar.hidden = !isBook && !options.externalWindow;
    sidebar.classList.toggle("is-book", isBook);
    modeBadge.textContent = isBook
      ? `Book | ${snapshot.pages.length} pages`
      : "Single document";
    subtitle.textContent = options.externalWindow
      ? "Live edits sync to the rendered window"
      : "Drag, resize, and edit live";

    if (currentPage) {
      titleInput.value = currentPage.title;
      pathInput.value = getEditorPagePathValue(snapshot, currentPage);
      pathInput.disabled = !currentPage.synthetic;
      pathLabel.textContent = currentPage.synthetic ? "Page path" : "Source URL";
      status.textContent = formatCurrentStats(currentPage.markdown);
      if (!suppressInput) {
        updateTextareaPreservingSelection(options.textarea, currentPage.markdown);
      }
    } else {
      titleInput.value = "";
      pathInput.value = "";
      pathInput.disabled = true;
      status.textContent = "No page selected";
      if (!suppressInput) {
        updateTextareaPreservingSelection(options.textarea, "");
      }
    }

    pageList.replaceChildren();
    if (!isBook) {
      const helper = createElement("div");
      helper.className = "editor-window__empty";
      helper.textContent = "Single-document mode keeps one live markdown page.";
      pageList.appendChild(helper);
    } else {
      for (const page of snapshot.pages) {
        const item = createElement("button");
        item.type = "button";
        item.className = "editor-window__page";
        if (page.id === snapshot.currentPageId) {
          item.classList.add("is-current");
          item.setAttribute("aria-current", "true");
        }

        const itemTitle = createElement("strong");
        itemTitle.className = "editor-window__page-title";
        itemTitle.textContent = page.title;

        const itemMeta = createElement("span");
        itemMeta.className = "editor-window__page-meta";
        itemMeta.textContent = page.url.split("/").pop() ?? page.url;

        item.append(itemTitle, itemMeta);
        item.addEventListener("click", () => {
          options.controller.setCurrentPage(page.id);
          if (isCompact) {
            pagesOpen = false;
            applyRect();
          }
        });
        pageList.appendChild(item);
      }
    }
  };

  const stopSnapshotSubscription = options.controller.subscribe((snapshot) => {
    refresh(snapshot);
  });

  const applyCompactState = (): void => {
    isCompact = compactQuery.matches;
    if (!isCompact) {
      pagesOpen = true;
    }
    applyRect();
  };

  const onCompactChange = (): void => {
    applyCompactState();
  };
  compactQuery.addEventListener("change", onCompactChange);

  const onResizeViewport = (): void => {
    applyRect();
  };
  window.addEventListener("resize", onResizeViewport);

  titleInput.addEventListener("input", () => {
    options.controller.updateCurrentPageTitle(titleInput.value);
  });

  pathInput.addEventListener("change", () => {
    options.controller.updateCurrentSyntheticPagePath(pathInput.value);
  });

  options.textarea.addEventListener("input", () => {
    suppressInput = true;
    options.controller.updateCurrentMarkdown(options.textarea.value);
    suppressInput = false;
  });

  addPageButton.addEventListener("click", () => {
    const created = options.controller.addBookPage();
    if (created) {
      options.textarea.focus();
    }
  });

  deletePageButton.addEventListener("click", () => {
    options.controller.removeCurrentBookPage();
  });

  pagesButton.addEventListener("click", () => {
    pagesOpen = !pagesOpen;
    applyRect();
  });

  externalButton.addEventListener("click", () => {
    options.onRequestOpenExternal?.();
  });

  closeButton.addEventListener("click", () => {
    options.onRequestClose?.();
  });

  installButton.addEventListener("click", () => {
    void options.onRequestInstall?.();
  });

  let stopInstallSubscription: (() => void) | null = null;
  if (options.subscribeInstallAvailability) {
    stopInstallSubscription = options.subscribeInstallAvailability((available) => {
      installButton.hidden = !available;
    });
  }

  if (!options.externalWindow) {
    dragHandle.addEventListener("pointerdown", (event) => {
      if (isCompact) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;

      const onMove = (moveEvent: PointerEvent): void => {
        rect = constrainRect({
          ...rect,
          left: startLeft + (moveEvent.clientX - startX),
          top: startTop + (moveEvent.clientY - startY),
        });
        applyRect();
      };

      const stop = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        persistRect(rect);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop, { once: true });
    });

    resizeHandle.addEventListener("pointerdown", (event) => {
      if (isCompact) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = rect.width;
      const startHeight = rect.height;

      const onMove = (moveEvent: PointerEvent): void => {
        rect = constrainRect({
          ...rect,
          width: startWidth + (moveEvent.clientX - startX),
          height: startHeight + (moveEvent.clientY - startY),
        });
        applyRect();
      };

      const stop = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
        persistRect(rect);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop, { once: true });
    });
  } else {
    resizeHandle.hidden = true;
    root.classList.add("is-open");
  }

  applyCompactState();

  return {
    root,
    setOpen(open: boolean): void {
      isOpen = open;
      applyRect();
    },
    focusEditor(): void {
      options.textarea.focus();
    },
    destroy(): void {
      stopSnapshotSubscription();
      stopInstallSubscription?.();
      window.removeEventListener("resize", onResizeViewport);
      compactQuery.removeEventListener("change", onCompactChange);
      options.host.replaceChildren();
    },
  };
}
