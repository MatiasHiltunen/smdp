import { createElement } from "./dom";

export type BaseView = {
  shell: HTMLElement;
  textarea: HTMLTextAreaElement;
  editorPane: HTMLElement;
};

export type HtmlView = BaseView & {
  viewer: HTMLElement;
};

export type CanvasView = BaseView & {
  canvas: HTMLCanvasElement;
};

function createEditorPane(): HTMLElement {
  return createElement("section", {
    classes: ["editor-pane", "surface-pane"],
    attrs: {
      id: "markdown-editor-pane",
      "aria-hidden": "true",
    },
  });
}

function createEditorInput(): HTMLTextAreaElement {
  const textarea = createElement("textarea", {
    classes: ["editor"],
    attrs: {
      id: "markdown-editor-input",
      "aria-label": "Markdown source",
      autocomplete: "off",
    },
  }) as HTMLTextAreaElement;
  textarea.spellcheck = false;
  return textarea;
}

export function createHtmlView(): HtmlView {
  const shell = createElement("div", {
    classes: ["app-shell", "mode-html"],
  });

  const viewerPane = createElement("div", {
    classes: ["viewer-pane", "surface-pane"],
  });

  const viewer = createElement("article", {
    className: "markdown-viewer",
    attrs: { id: "markdown-view" },
  });

  const editorPane = createEditorPane();
  const textarea = createEditorInput();

  editorPane.appendChild(textarea);
  viewerPane.appendChild(viewer);
  shell.append(viewerPane, editorPane);

  return {
    shell,
    textarea,
    editorPane,
    viewer,
  };
}

export function createCanvasView(): CanvasView {
  const shell = createElement("div", {
    classes: ["app-shell", "mode-canvas"],
  });

  const canvasPane = createElement("div", {
    classes: ["canvas-pane", "surface-pane"],
  });

  const canvasScroll = createElement("div", {
    className: "canvas-scroll",
  });

  const canvas = createElement("canvas", {
    className: "md-canvas",
  });

  const canvasSpacer = createElement("div", {
    attrs: {
      id: "canvas-spacer",
      "aria-hidden": "true",
    },
  });

  const editorPane = createEditorPane();
  const textarea = createEditorInput();

  editorPane.appendChild(textarea);
  canvasScroll.append(canvas, canvasSpacer);
  canvasPane.appendChild(canvasScroll);
  shell.append(canvasPane, editorPane);

  return {
    shell,
    textarea,
    editorPane,
    canvas,
  };
}
