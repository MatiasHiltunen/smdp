import { MDParser, u8 } from "./parser";
import "./style.css";

function parseMarkdown(md: string, canvas: HTMLCanvasElement) {
  const parser = new MDParser();
  const html = parser.parse(u8(md));
  parser.renderToCanvas(u8(md), canvas);
  return { html, canvas };
}

const md = `# Hello World

Tämä teksti on suomeksi.

Ä Ö å etc. do not work and thus the emojis are not working either.

This is **bold** text and this is *italic* text.

## Features

Some text content for an example paragraph.

Some text content for an example paragraph.

Some text content for an example paragraph.

Some text content for an example paragraph.

Some text content for an example paragraph.

- Item 1
- Item 2
- Item 3

### Ordered List

1. Item 1
2. Item 2
3. Item 3

### Code Example

\`\`\`
const hello = "world";
console.log(hello);
\`\`\`

> This is a blockquote
> with multiple lines

Visit [example.com](https://example.com) or www.github.com

### Images

![Example Image 1](https://picsum.photos/600/400)

![Example Image 2](https://picsum.photos/500/350)

### Tables

| Feature | Description | Status |
|---------|:-----------:|-------:|
| Tables  | Markdown tables with alignment | ✅ |
| Info Blocks | Colored notification blocks | ✅ |
| Virtual Scroll | Canvas performance optimization | ✅ |

### Info Blocks

::: info
This is an informational message. It can contain **bold text**, *italic text*, and \`inline code\`.
:::

::: warning
This is a warning message. Pay attention to this important notice!
:::

::: error
This is an error message. Something went wrong and needs your attention.
:::

::: success
This is a success message. Everything completed successfully!
:::

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
