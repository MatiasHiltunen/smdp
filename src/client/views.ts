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

export function createHtmlView(): HtmlView {
  const shell = createElement("div");
  shell.className = "app-shell mode-html";

  const viewerPane = createElement("div");
  viewerPane.className = "viewer-pane";

  const viewer = createElement("article");
  viewer.className = "markdown-viewer";
  viewer.id = "markdown-view";

  const editorPane = createElement("section");
  editorPane.className = "editor-pane";
  editorPane.id = "markdown-editor-pane";
  editorPane.setAttribute("aria-hidden", "true");

  const textarea = createElement("textarea");
  textarea.className = "editor";
  textarea.spellcheck = false;
  textarea.id = "markdown-editor-input";
  textarea.autocomplete = "off";
  textarea.setAttribute("aria-label", "Markdown source");

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
  const shell = createElement("div");
  shell.className = "app-shell mode-canvas";

  const canvasPane = createElement("div");
  canvasPane.className = "canvas-pane";

  const canvasScroll = createElement("div");
  canvasScroll.className = "canvas-scroll";

  const canvas = createElement("canvas");
  canvas.className = "md-canvas";

  const canvasSpacer = createElement("div");
  canvasSpacer.id = "canvas-spacer";
  canvasSpacer.setAttribute("aria-hidden", "true");

  const editorPane = createElement("section");
  editorPane.className = "editor-pane";
  editorPane.id = "markdown-editor-pane";
  editorPane.setAttribute("aria-hidden", "true");

  const textarea = createElement("textarea");
  textarea.className = "editor";
  textarea.spellcheck = false;
  textarea.id = "markdown-editor-input";
  textarea.autocomplete = "off";
  textarea.setAttribute("aria-label", "Markdown source");

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
