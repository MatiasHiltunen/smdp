import { createElement } from "./dom";

type TopicLevel = 1 | 2 | 3;

type BookTopic = {
  id: string;
  text: string;
  level: TopicLevel;
};

export type BookTopicsMenuHandle = {
  root: HTMLElement;
  update(viewer: HTMLElement): void;
  destroy(): void;
};

function slugifyHeading(text: string): string {
  const normalized = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "section";
}

function collectBookTopics(viewer: HTMLElement): BookTopic[] {
  const topics: BookTopic[] = [];
  const usedIds = new Set<string>();

  const preserved = viewer.querySelectorAll<HTMLElement>(
    "[id]:not(h1):not(h2):not(h3)",
  );
  for (const element of preserved) {
    const id = element.id.trim();
    if (id) usedIds.add(id);
  }

  const headings = viewer.querySelectorAll<HTMLElement>("h1, h2, h3");
  for (const heading of headings) {
    const levelRaw = Number.parseInt(heading.tagName.slice(1), 10);
    if (levelRaw < 1 || levelRaw > 3) continue;
    const level = levelRaw as TopicLevel;

    const text = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const desiredBase = heading.id.trim() || slugifyHeading(text);
    let nextId = desiredBase;
    let suffix = 2;
    while (usedIds.has(nextId)) {
      nextId = `${desiredBase}-${suffix}`;
      suffix += 1;
    }
    heading.id = nextId;
    usedIds.add(nextId);

    topics.push({ id: nextId, text, level });
  }

  return topics;
}

export function createBookTopicsMenu(): BookTopicsMenuHandle {
  const root = createElement("div");
  root.className = "book-topics-menu";

  const toggleButton = createElement("button");
  toggleButton.className = "book-topics-toggle";
  toggleButton.type = "button";
  toggleButton.title = "Toggle chapter topics";
  toggleButton.setAttribute("aria-expanded", "false");
  toggleButton.setAttribute("aria-controls", "book-topics-panel");
  toggleButton.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path d="M4 6a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm0 6a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm1 5a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H5Z" fill="currentColor"/>
    </svg>
  `;

  const panel = createElement("aside");
  panel.className = "book-topics-panel";
  panel.id = "book-topics-panel";
  panel.setAttribute("aria-hidden", "true");

  const title = createElement("h3");
  title.className = "book-topics-title";
  title.textContent = "Topics";

  const list = createElement("ul");
  list.className = "book-topics-list";

  panel.append(title, list);
  root.append(toggleButton, panel);

  let isOpen = false;
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

  const update = (viewer: HTMLElement): void => {
    const topics = collectBookTopics(viewer);
    list.replaceChildren();

    if (topics.length === 0) {
      const empty = createElement("li");
      empty.className = "book-topics-empty";
      empty.textContent = "No headings in this chapter";
      list.appendChild(empty);
      return;
    }

    for (const topic of topics) {
      const item = createElement("li");
      item.className = `book-topics-item level-${topic.level}`;
      const link = createElement("a");
      link.href = `#${encodeURIComponent(topic.id)}`;
      link.textContent = topic.text;
      link.addEventListener("click", () => {
        close();
      });
      item.appendChild(link);
      list.appendChild(item);
    }
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
