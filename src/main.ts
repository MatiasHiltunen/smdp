import { MDParser, u8 } from "./parser";
import "./style.css";

const parser = new MDParser();

const createElement = <T extends keyof HTMLElementTagNameMap>(tag: T) =>
  document.createElement(tag) as HTMLElementTagNameMap[T];

type RenderMode = "html" | "canvas";

type RouteDetails = {
  mode: RenderMode;
  externalUrl: URL | null;
};

function safeParseUrl(value: string | null): URL | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch (error) {
    console.error("Unable to parse external markdown URL", error);
    return null;
  }
}

function parseRoute(): RouteDetails {
  const rawPath = decodeURIComponent(window.location.pathname);

  if (rawPath.startsWith("/canvas/")) {
    const externalPart = rawPath.slice("/canvas/".length);
    return {
      mode: "canvas",
      externalUrl: safeParseUrl(externalPart || null),
    };
  }

  if (rawPath === "/canvas") {
    return {
      mode: "canvas",
      externalUrl: null,
    };
  }

  if (rawPath.startsWith("/html/")) {
    const externalPart = rawPath.slice("/html/".length);
    return {
      mode: "html",
      externalUrl: safeParseUrl(externalPart || null),
    };
  }

  if (rawPath === "/html") {
    return {
      mode: "html",
      externalUrl: null,
    };
  }

  if (rawPath === "/" || rawPath === "") {
    return {
      mode: "html",
      externalUrl: null,
    };
  }

  const externalPart = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
  return {
    mode: "html",
    externalUrl: safeParseUrl(externalPart || null),
  };
}

async function fetchMarkdownBytes(externalUrl: URL | null): Promise<Uint8Array> {
  const target = externalUrl?.toString() ?? "/test.md";
  const response = await fetch(target);

  if (!response.ok) {
    throw new Error(`Failed to fetch markdown: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

type BaseView = {
  shell: HTMLElement;
  fab: HTMLButtonElement;
  textarea: HTMLTextAreaElement;
};

type HtmlView = BaseView & {
  viewer: HTMLElement;
};

type CanvasView = BaseView & {
  canvas: HTMLCanvasElement;
};

function createFloatingButton(): HTMLButtonElement {
  const button = createElement("button");
  button.className = "floating-toggle";
  button.type = "button";
  button.title = "Edit markdown";
  button.ariaLabel = "Toggle editor";
  button.setAttribute("aria-pressed", "false");
  button.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" class="icon">
      <path
        d="M4.5 20a.5.5 0 0 1-.5-.5v-3.086a1 1 0 0 1 .293-.707L14.586 5.414a2 2 0 0 1 2.828 0l1.172 1.172a2 2 0 0 1 0 2.828L8.293 20.293a1 1 0 0 1-.707.293H4.5Zm12.379-13.207a.5.5 0 0 0-.707 0L6 16.964V19h2.036l10.172-10.172a.5.5 0 0 0 0-.707l-1.329-1.328ZM19 21H5a1 1 0 1 1 0-2h14a1 1 0 1 1 0 2Z"
        fill="currentColor"
      ></path>
    </svg>
  `;
  return button;
}

function createHtmlView(): HtmlView {
  const shell = createElement("div");
  shell.className = "app-shell mode-html";

  const viewerPane = createElement("div");
  viewerPane.className = "viewer-pane";

  const viewer = createElement("article");
  viewer.className = "markdown-viewer";

  const editorPane = createElement("section");
  editorPane.className = "editor-pane";

  const textarea = createElement("textarea");
  textarea.className = "editor";
  textarea.spellcheck = false;

  editorPane.appendChild(textarea);
  viewerPane.appendChild(viewer);

  const fab = createFloatingButton();

  shell.append(viewerPane, editorPane);

  return {
    shell,
    fab,
    textarea,
    viewer,
  };
}

function createCanvasView(): CanvasView {
  const shell = createElement("div");
  shell.className = "app-shell mode-canvas";

  const canvasPane = createElement("div");
  canvasPane.className = "canvas-pane";

  const canvas = createElement("canvas");
  canvas.className = "md-canvas";

  const editorPane = createElement("section");
  editorPane.className = "editor-pane";

  const textarea = createElement("textarea");
  textarea.className = "editor";
  textarea.spellcheck = false;

  editorPane.appendChild(textarea);
  canvasPane.appendChild(canvas);

  const fab = createFloatingButton();

  shell.append(canvasPane, editorPane);

  return {
    shell,
    fab,
    textarea,
    canvas,
  };
}

function applyMarkdownToHtml(view: HtmlView, bytes: Uint8Array) {
  view.viewer.innerHTML = parser.parse(bytes);
}

function applyMarkdownToCanvas(view: CanvasView, bytes: Uint8Array) {
  parser.renderToCanvas(bytes, view.canvas);
}

function attachFabToggle(view: BaseView) {
  const { fab, shell } = view;

  shell.classList.remove("show-editor");

  fab.addEventListener("click", () => {
    const isEditing = document.body.classList.toggle("is-editing");
    shell.classList.toggle("show-editor", isEditing);
    fab.setAttribute("aria-pressed", String(isEditing));
    if (isEditing) {
      view.textarea.focus();
    }
  });

  document.body.appendChild(fab);
}

function enableRealtimeUpdates(
  view: HtmlView | CanvasView,
  apply: (bytes: Uint8Array) => void
) {
  view.textarea.addEventListener("input", (event) => {
    const value = (event.target as HTMLTextAreaElement).value;
    const bytes = u8(value);
    apply(bytes);
  });
}

function displayError(message: string) {
  const alert = createElement("div");
  alert.className = "error-banner";
  alert.textContent = message;
  document.body.appendChild(alert);
}

async function init() {
  document.body.classList.add("hydrating");

  const route = parseRoute();

  let view: HtmlView | CanvasView;
  let apply: (bytes: Uint8Array) => void;

  if (route.mode === "canvas") {
    const canvasView = createCanvasView();
    view = canvasView;
    apply = (bytes) => applyMarkdownToCanvas(canvasView, bytes);
  } else {
    const htmlView = createHtmlView();
    view = htmlView;
    apply = (bytes) => applyMarkdownToHtml(htmlView, bytes);
  }

  document.body.classList.remove("is-editing");
  document.body.replaceChildren(view.shell);
  attachFabToggle(view);

  let resolvedBytes: Uint8Array | null = null;
  let resolvedText: string | null = null;

  try {
    resolvedBytes = await fetchMarkdownBytes(route.externalUrl);
    resolvedText = new TextDecoder().decode(resolvedBytes);
  } catch (error) {
    console.error(error);
    displayError(error instanceof Error ? error.message : "Unable to load markdown");
    if (route.externalUrl) {
      try {
        resolvedBytes = await fetchMarkdownBytes(null);
        resolvedText = new TextDecoder().decode(resolvedBytes);
      } catch (fallbackError) {
        console.error("Unable to load fallback markdown", fallbackError);
      }
    }
  } finally {
    document.body.classList.remove("hydrating");
  }

  if (resolvedText !== null) {
    view.textarea.value = resolvedText;
  } else {
    view.textarea.value = "";
  }

  if (resolvedBytes) {
    apply(resolvedBytes);
  }

  enableRealtimeUpdates(view, apply);
}

init();
