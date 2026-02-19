# md2

Experimental byte-oriented client-side Markdown parser and renderer. This page is part of the [smdb](https://github.com/matiashiltunen/smdp) toolset and doubles as a living showcase of what the parser/renderer currently supports.

> We treat this demo as a lab notebook. Expect working examples, rough edges, and the occasional TODO. Shipping early means we also see where the parser still bends.

> **Status**: the tooling is under active development. The public API and deployment model will change before an initial npm release targeted for later this year. The goal is not to compete with established Markdown libraries but to make Markdown visualisation approachable while maintaining a practical balance between performance and supported features.

## Attribution & Project Links
- Maintained in the open at [github.com/MatiasHiltunen/smdp](https://github.com/MatiasHiltunen/smdp)
- Inspired by years of Markdown parsing research and a desire to do less regex, more bytes
- Contributions welcome—file issues, send PRs, or fork and experiment

## What This Utility Does Well (Today)
1. Parses Markdown in a single forward pass, no backtracking.
2. Outputs clean HTML _and_ can render to Canvas for pixel-perfect previews.
3. Bundles a pragmatic syntax highlighter with precompiled grammars.
4. Ships with a live theme builder/editor so you can tweak presentation instantly.

## Try It Yourself on md2.at
- Paste any public Markdown URL after the host: `https://md2.at/https://example.org/some_md_file.md`
  - We stream the remote document, parse it on the fly, and reflect updates as you edit.
  - HTTPS URLs work best; some hosts block CORS, in which case the fetch will fail and we fall back to the bundled sample.
- Switch to Canvas rendering with `https://md2.at/canvas` (or `https://md2.at/canvas/https://example.org/some_md_file.md`).
  - Canvas mode is great for slide decks or visual QA, but remember it trades semantic HTML for pixels.
- Developing locally? Run `npm run dev` and open `http://localhost:5173/html` or `/canvas` for the same experience.
- We promise to keep the runtime bundle free from third-party scripts, respecting privacy by staying open and self-contained under the MIT License.
- Relative links and images are rewritten against the source document, so `/assets/logo.png` still points to the remote origin that hosted the Markdown.
- Toggle between dark and light UI with the moon/sun button in the lower corner; the choice is stored locally for later visits.

### Book Mode (GitHub Chapters)
- Use `/book/<entry-url>` when your entry markdown links to other markdown chapters.
- GitHub links like `https://github.com/<owner>/<repo>/blob/<ref>/docs/chapter-1.md` are normalized to `raw.githubusercontent.com` automatically.
- Relative chapter links continue to work because each chapter is resolved against its own source URL.
- Chapters are discovered from links and prefetched in the background; clicking chapter links keeps navigation inside the app.
- Deep links keep the selected chapter in `?part=<chapter-url>`, so shared links reopen the same chapter.

## Where We're Still Improving
- Canvas output needs more accessibility affordances (narration and focus states).
- Table alignment is solid, yet edge cases with deeply nested tables still fail occasionally.
- The highlight engine prefers well-formed code; recovery from malformed snippets is ongoing work.
- Streaming input is experimental; large documents may still spike memory.

## Quick Tour

### Inline Formatting Examples
- **Bold emphasis** keeps headings punchy.
- _Italic text_ softens asides.
- ~~Strikethrough~~ captures edits.
- `inline-code` demonstrates monospace styling.
- Automatic links work for bare domains like https://md2.at.

### Task Lists
- [x] Render HTML
- [x] Render Canvas
- [x] Provide syntax highlighting
- [ ] Finalize streaming mode

### Info Blocks
::: info
This info callout uses the block extension support. It is great for neutral tips and inline HTML-free content.
:::

::: warning
Warnings render in amber. We use this to flag memory hotspots or unsafe Markdown constructs.
:::

::: error
Errors show up in red. For example, when Canvas rendering fails we pipe the message here.
:::

::: success
Success banners celebrate passing property-based tests. ✅
:::

### Tables With Alignment

| Capability          | Status | Notes |
|:--------------------|:------:|:------|
| Single pass parsing | ✅     | Byte spans and arenas keep allocations low.
| HTML rendering      | ✅     | Emits escaped markup, honoring security defaults.
| Canvas renderer     | ✅     | Uses virtual scrolling when content is tall.
| Theme editor        | 🧪    | Editable in real time—try the palette button below.
| Streaming input     | ⚙️     | Prototype branch in progress.

### Code Highlighting (TypeScript)
```ts
import { MDParser, u8 } from "smdp";

const parser = new MDParser({ allowRawHtml: false });
const markdown = `# Hello Canvas\n\nRendered at ${new Date().toISOString()}`;

const html = await parser.parse(u8(markdown));
console.log(html);
```

```javascript
// regex + template literal demo
const re = /foo+/g;
const msg = `match count: ${String(data.length)}`;
if (re.test(msg)) {
  console.info("Looks highlighted to us");
}
```

### Theming
The floating palette button opens the live theme editor. Every input drives a `ThemeBuilder` instance, which rewrites CSS variables before your eyes. The defaults are dark, but you can set `color-scheme: light` and tweak every token. Because the variables power both HTML and Canvas styling, theme changes stay consistent.

### Canvas Mode
Switch to `/canvas` to see the same Markdown buffered into an offscreen canvas and blitted with a virtual scroll. It is fast, but we know Canvas cannot currently expose semantic HTML. We plan to make hybrid output easier so screen readers do not miss content.

### Lists, Quotes & Definitions
> “A Markdown parser is never done; it just ships fewer TODOs.”
>
> — The smdp team, every week

- Rich bullet lists
  - With nested items
    - And resilient spacing

Term: Definition lists render using standard Markdown extensions.

### Embedded Image
![Processing pipeline diagram from placeholder service](https://picsum.photos/960/480?blur=2)

### Footnotes & References
We keep notes.[^1] They remind us that even handmade parsers benefit from fuzzing.

[^1]: Property-based tests run under `npm test`. When they fail you get a crimson banner in the UI.

### Raw HTML (Disabled By Default)
If you notice HTML tags not rendering, that's intentional. `allowRawHtml` defaults to `false` to keep output safe. You can enable it via `new MDParser({ allowRawHtml: true })`, but you assume responsibility for sanitizing content.

## Roadmap Snapshot
- 🔭 **Better streaming**: prototype currently in branch `streaming-iterators`.
- 🪟 **Windows font fallback**: investigating `CanvasRenderingContext2D.fontKerning` inconsistencies.
- 🧪 **More grammars**: Rust, Python, SQL are in; Ruby heredocs still need polish.

## Contributing Tips
1. Clone the repo from GitHub.
2. Run `npm install` then `npm run dev`.
3. Use `npm test` for golden + property-based checks.
4. Open a PR describing what you verified. Screenshots help.

> There is always more to harden: streaming, math notation, and better diffing between HTML and Canvas outputs. We appreciate curious testers who file detailed issues.

Thanks for exploring smdp! Hit the GitHub repository if you have ideas—or open the theme editor and make the UI yours.
