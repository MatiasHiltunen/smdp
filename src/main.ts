import { MDParser, u8 } from "./parser";
import "./style.css";

function parseMarkdown(md: string, canvas: HTMLCanvasElement) {
  const parser = new MDParser();
  const html = parser.parse(u8(md));
  parser.renderToCanvas(u8(md), canvas);
  return { html, canvas };
}

const md = `# Hello World

This is **bold** text and this is *italic* text.

## Features

- Item 1
- Item 2
- Item 3

### Code Example

\`\`\`
const hello = "world";
console.log(hello);
\`\`\`

> This is a blockquote
> with multiple lines

Visit [example.com](https://example.com) or www.github.com

---

**Strong text** and \`inline code\`.
`;

const app = document.getElementById("app");
const editor = document.getElementById("editor") as HTMLTextAreaElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;

if (!app || !editor || !canvas) {
  throw new Error("Required DOM elements not found");
}

// Initialize
editor.value = md;
app.innerHTML = parseMarkdown(md, canvas).html;

// Update on input
editor.addEventListener("input", () => {
  const newMd = editor.value;
  const { html } = parseMarkdown(newMd, canvas);
  app.innerHTML = html;
});
