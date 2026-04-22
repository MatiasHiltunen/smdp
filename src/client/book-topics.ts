import { createElement, replaceWithIcon } from "./dom";

export type BookContentLink = {
  url: string;
  title: string;
  isCurrent?: boolean;
  children?: readonly BookContentLink[];
};

type BookTopicsMenuUpdateOptions = {
  contents?: readonly BookContentLink[];
  onSelectContent?: (url: string) => void;
};

export type BookTopicsMenuHandle = {
  root: HTMLElement;
  update(viewer: HTMLElement, options?: BookTopicsMenuUpdateOptions): void;
  destroy(): void;
};

export function createBookTopicsMenu(): BookTopicsMenuHandle {
  const root = createElement("div");
  root.className = "book-topics-menu";

  const toggleButton = createElement("button");
  toggleButton.className = "book-topics-toggle";
  toggleButton.type = "button";
  toggleButton.title = "Toggle book contents";
  toggleButton.setAttribute("aria-expanded", "false");
  toggleButton.setAttribute("aria-controls", "book-topics-panel");
  replaceWithIcon(
    toggleButton,
    "M4 6a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm0 6a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm1 5a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H5Z",
  );

  const panel = createElement("aside");
  panel.className = "book-topics-panel";
  panel.id = "book-topics-panel";
  panel.setAttribute("aria-hidden", "true");

  const title = createElement("h3");
  title.className = "book-topics-title";
  title.textContent = "Contents";

  const contentTree = createElement("ul");
  contentTree.className = "book-topics-tree";

  panel.append(title, contentTree);
  root.append(toggleButton, panel);

  let isOpen = false;
  let latestContents: readonly BookContentLink[] = [];
  let latestSelectHandler: ((url: string) => void) | null = null;
  const expandedByUrl = new Set<string>();

  const syncOpenState = (): void => {
    root.classList.toggle("is-open", isOpen);
    toggleButton.setAttribute("aria-expanded", String(isOpen));
    panel.setAttribute("aria-hidden", String(!isOpen));
  };
  syncOpenState();

  const close = (): void => {
    if (!isOpen) return;
    isOpen = false;
    syncOpenState();
  };

  toggleButton.addEventListener("click", (event) => {
    event.stopPropagation();
    isOpen = !isOpen;
    syncOpenState();
  });

  const onDocumentClick = (event: Event): void => {
    if (!isOpen) return;
    const target = event.target as Node | null;
    if (target && !root.contains(target)) {
      close();
    }
  };
  document.addEventListener("click", onDocumentClick);

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      close();
    }
  };
  document.addEventListener("keydown", onEscape);

  const collectTreeUrls = (nodes: readonly BookContentLink[]): Set<string> => {
    const urls = new Set<string>();
    const walk = (items: readonly BookContentLink[]): void => {
      for (const item of items) {
        urls.add(item.url);
        const children = item.children ?? [];
        if (children.length > 0) {
          walk(children);
        }
      }
    };
    walk(nodes);
    return urls;
  };

  const renderTree = (
    list: HTMLElement,
    items: readonly BookContentLink[],
  ): void => {
    list.replaceChildren();
    for (const item of items) {
      const rowItem = createElement("li");
      rowItem.className = "book-topics-tree-item";
      const row = createElement("div");
      row.className = "book-topics-tree-row";
      rowItem.appendChild(row);

      const children = item.children ?? [];
      const hasChildren = children.length > 0;

      if (hasChildren) {
        const isExpanded = expandedByUrl.has(item.url);
        if (isExpanded) {
          rowItem.classList.add("is-expanded");
        }
        const toggle = createElement("button");
        toggle.type = "button";
        toggle.className = "book-topics-tree-toggle";
        toggle.setAttribute("aria-expanded", String(isExpanded));
        toggle.title = isExpanded
          ? "Collapse subchapters"
          : "Expand subchapters";
        replaceWithIcon(
          toggle,
          "M7 4a1 1 0 0 1 .707.293l5 5a1 1 0 0 1 0 1.414l-5 5A1 1 0 0 1 6 15V5a1 1 0 0 1 1-1Z",
          { viewBox: "0 0 20 20" },
        );
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          if (expandedByUrl.has(item.url)) {
            expandedByUrl.delete(item.url);
          } else {
            expandedByUrl.add(item.url);
          }
          renderTree(contentTree, latestContents);
        });
        row.appendChild(toggle);
      } else {
        const spacer = createElement("span");
        spacer.className = "book-topics-tree-spacer";
        spacer.setAttribute("aria-hidden", "true");
        row.appendChild(spacer);
      }

      const link = createElement("a");
      link.href = "#";
      link.className = "book-topics-tree-link";
      link.textContent = item.title.trim() || "Untitled chapter";
      if (item.isCurrent) {
        link.classList.add("is-current");
        link.setAttribute("aria-current", "page");
      }
      link.addEventListener("click", (event) => {
        event.preventDefault();
        close();
        latestSelectHandler?.(item.url);
      });
      row.appendChild(link);

      if (hasChildren) {
        const childList = createElement("ul");
        childList.className = "book-topics-tree book-topics-tree-children";
        renderTree(childList, children);
        rowItem.appendChild(childList);
      }

      list.appendChild(rowItem);
    }
  };

  const update = (
    viewer: HTMLElement,
    options: BookTopicsMenuUpdateOptions = {},
  ): void => {
    void viewer;
    latestContents = options.contents ?? [];
    latestSelectHandler = options.onSelectContent ?? null;
    const validUrls = collectTreeUrls(latestContents);
    for (const expandedUrl of Array.from(expandedByUrl)) {
      if (!validUrls.has(expandedUrl)) {
        expandedByUrl.delete(expandedUrl);
      }
    }

    if (latestContents.length === 0) {
      contentTree.replaceChildren();
      const emptyContents = createElement("li");
      emptyContents.className = "book-topics-empty";
      emptyContents.textContent = "No chapters discovered yet";
      contentTree.appendChild(emptyContents);
      return;
    }

    renderTree(contentTree, latestContents);
  };

  const destroy = (): void => {
    document.removeEventListener("click", onDocumentClick);
    document.removeEventListener("keydown", onEscape);
  };

  return {
    root,
    update,
    destroy,
  };
}
