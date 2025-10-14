import { MDParser, u8 } from "./parser";

function parseMarkdown(md: string) {
  const parser = new MDParser();
  return parser.parse(u8(md));
}

const md = `
# Hello World

This is **bold** text.
`;

const app = document.getElementById("app");
const editor = document.getElementById("editor") as HTMLTextAreaElement;

editor.value = md;
app!.innerHTML = parseMarkdown(md);

editor.addEventListener("input", (e) => {
  const newMd = editor.value;

  const appNew = document.getElementById("app")!;
  const html = parseMarkdown(newMd);

  appNew!.innerHTML = html;
});
