import { MDParser, u8 } from "./parser";
import "./style.css";
import mdData from "../public/test.md?raw";

//let md: string = mdData;

/*function parseMarkdown(md: string, canvas: HTMLCanvasElement) {
  const parser = new MDParser();
  const html = parser.parse(u8(md));
  parser.renderToCanvas(u8(md), canvas);
  return { html, canvas };
}*/

function parseMarkdownToHtml(md: Uint8Array, parser: MDParser) {
  return parser.parse(md);
}

function parseMarkdownToCanvas(md: Uint8Array, canvas: HTMLCanvasElement, parser: MDParser) {
  parser.renderToCanvas(md, canvas);
  //return canvas;
}

const el = <T extends keyof HTMLElementTagNameMap>(tag: T) => document.createElement(tag) as HTMLElementTagNameMap[T];


async function fetchMarkdown(url: URL) {
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch markdown: ${response.statusText}`);
  }


  const text = await response.text();


  console.log(text);

  if (text.length === 0) {
    throw new Error("No markdown found in the response");
  }

  return text;
}


function createCanvasContainer() {


  const canvasPane = el("div");
  canvasPane.className = "canvas-pane";

  const canvasScroll = el("div");
  canvasScroll.id = "canvas-scroll";
  canvasScroll.className = "canvas-scroll";

  const canvasSpacer = el("div");
  canvasSpacer.id = "canvas-spacer";


  const canvas = el("canvas");
  canvas.id = "canvas";


  canvasPane.appendChild(canvasScroll);
  canvasScroll.append(canvas, canvasSpacer);

  return { canvasPane, canvas };
}

function createEditor() {
  const editor = el("textarea");
  editor.id = "editor";
  editor.className = "editor";
  return editor;
}

function createApp() {
  const app = el("div");
  app.id = "app";
  app.className = "app";
  return app;
}

function getRoute() {

  const url = new URL(window.location.href);


  if (url.pathname.startsWith("/canvas/")) {
    return "canvas";
  }

  if (url.pathname.startsWith("/html/")) {
    return "html";
  }

  return "editor";
}

function getUrlFromSearchParams() {
  const url = new URL(window.location.href);


  console.log("url", url);
  
  const externalUrl = url.searchParams.get("url")

  if(!externalUrl) return null

  const urlParam = URL.parse(externalUrl)

  

  if (!urlParam?.pathname?.endsWith(".md")) {
    return null;
  }



  return urlParam;
}

async function init() {



  const parser = new MDParser();

  const route = getRoute();

  const url = getUrlFromSearchParams();

  let md = mdData

  if (!!url && url?.protocol === "https:") {
    md = await fetchMarkdown(url);
  
    console.log("downloadedMarkdown", md);
  }

  const u8Md = u8(md)

  const container = el("div");
  container.className = "container";
  container.id = "canvas-container";

  if (route === "editor") {
    const editor = createEditor();
    document.body.appendChild(editor);
    const { canvasPane, canvas } = createCanvasContainer();
    const app = createApp();

    container.append(canvasPane, app);
    // Initialize
    editor.value = md;
    app.innerHTML = parseMarkdownToHtml(u8Md, parser);

    parseMarkdownToCanvas(u8Md, canvas, parser);

    // Update on input
    editor.addEventListener("input", (e) => {
      const newMd = (e.target as HTMLTextAreaElement).value;
      const u8MdNew = u8(newMd)

      app.innerHTML = parseMarkdownToHtml(u8MdNew, parser);
      parseMarkdownToCanvas(u8MdNew, canvas, parser)

    });
  } else if (route === "canvas") {
    const { canvasPane, canvas } = createCanvasContainer();
    container.append(canvasPane);
    parser.parse(u8Md)
    parseMarkdownToCanvas(u8Md, canvas, parser);
  } else if (route === "html") {
    const app = createApp();
    
    app.innerHTML = parseMarkdownToHtml(u8Md, parser);
    container.append(app);
  }

  document.body.append(container);


}

init();
