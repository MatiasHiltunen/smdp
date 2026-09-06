import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  drawDiagramSceneToCanvas,
  getDiagramWasmStatus,
  hashDiagramToken,
  MERMAID_COMPATIBILITY_VERSION,
  renderDiagram,
  renderDiagramToSvg,
  scanDiagramSource,
} from '../src/diagram/index.ts';
import { MDParser, u8 } from '../src/parser/index.ts';
import { renderPDFFromBlocks } from '../src/parser/pdf-renderer.ts';
import { SMDP_DIAGRAM_CORE_WASM_BASE64 } from '../src/wasm/smdp-diagram-core-binary.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test('loads a separate no-import SIMD diagram ABI', () => {
  const status = getDiagramWasmStatus();
  assert.equal(status.available, true, status.failure);
  assert.equal(status.abiVersion, 1);
  assert.equal(status.usesSimd, true);

  const module = new WebAssembly.Module(Buffer.from(SMDP_DIAGRAM_CORE_WASM_BASE64, 'base64'));
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.ok(WebAssembly.Module.exports(module).some((item) => item.name === 'diagram_scan_lines'));
});

test('SIMD scanner preserves offsets, indentation, comments, and declaration hashes', () => {
  const source = encoder.encode('---\r\ntitle: Demo\r\n---\nflowchart LR\n  A --> B\n%% comment');
  const lines = scanDiagramSource(source);
  assert.equal(lines.length, 6);
  assert.equal(decoder.decode(source.subarray(lines[3].start, lines[3].end)), 'flowchart LR');
  assert.equal(lines[3].firstTokenHash, hashDiagramToken('flowchart'));
  assert.equal(lines[4].indent, 2);
  assert.equal(lines[4].flags & 4, 4);
  assert.equal(lines[5].flags & 2, 2);
});

test('SIMD scanner drains more than one fixed-size result batch', () => {
  const source = encoder.encode(Array.from({ length: 2_050 }, (_, index) => `node_${index}`).join('\r\n'));
  const lines = scanDiagramSource(source, 2_100);
  assert.equal(lines.length, 2_050);
  assert.equal(decoder.decode(source.subarray(lines[1_024].start, lines[1_024].end)), 'node_1024');
  assert.equal(decoder.decode(source.subarray(lines[2_049].start, lines[2_049].end)), 'node_2049');
});

const dialectFixtures = [
  ['flowchart', 'flowchart LR\nA[Start] --> B{Choose}'],
  ['swimlanes', 'swimlanes-beta\nsection Team\nBuild : active'],
  ['sequence', 'sequenceDiagram\nparticipant A as Alice\nA->>B: Hello'],
  ['class', 'classDiagram\nAnimal <|-- Duck'],
  ['state', 'stateDiagram-v2\n[*] --> Still\nStill --> Moving'],
  ['er', 'erDiagram\nCUSTOMER ||--o{ ORDER : places'],
  ['journey', 'journey\nsection Work\nBuild: 5: Team'],
  ['gantt', 'gantt\nsection Build\nParser :done, 2026-01-01, 3d'],
  ['pie', 'pie title Pets\n"Dogs" : 4\n"Cats" : 3'],
  ['quadrant', 'quadrantChart\nFast: [0.8, 0.7]'],
  ['requirement', 'requirementDiagram\nA --> B'],
  ['gitGraph', 'gitGraph\ncommit id: "one"\nbranch feature'],
  ['c4', 'C4Context\nPerson(user, "User")\nSystem(app, "App")\nRel(user, app, "Uses")'],
  ['mindmap', 'mindmap\n  root((SMDP))\n    Parser\n    Renderer'],
  ['timeline', 'timeline\nsection 2026\nSeptember : Native diagrams'],
  ['zenuml', 'zenuml\nAlice->Bob: Hello'],
  ['sankey', 'sankey-beta\nInput,Parser,10\nParser,HTML,6'],
  ['xychart', 'xychart-beta\nbar [2, 4, 3]\nline [1, 3, 5]'],
  ['block', 'block-beta\nA[Input] --> B[Output]'],
  ['packet', 'packet-beta\n0-15: "Source port"\n16-31: "Destination port"'],
  ['kanban', 'kanban\nTodo[Todo]\n  task[Implement parser]'],
  ['architecture', 'architecture-beta\nservice api(server)[API]\napi:R -- L:db'],
  ['radar', 'radar-beta\naxis [Speed, Quality, Safety]\ncurve app [4, 5, 3]'],
  ['eventModeling', 'eventModeling\nUser command\nDomain event'],
  ['treemap', 'treemap-beta\nParser: 6\nRenderer: 4'],
  ['venn', 'venn-beta\nset A[Parser]\nset B[Renderer]'],
  ['ishikawa', 'ishikawa-beta\n  Quality\n    Tests\n    Review'],
  ['wardley', 'wardley\ncomponent User [0.9, 0.8]\ncomponent Parser [0.5, 0.4]'],
  ['cynefin', 'cynefin-beta\nProbe\nAnalyse\nAct\nSense'],
  ['treeView', 'treeview-beta\n  Root\n    Child'],
  ['railroad', 'railroad\nvalue ::= number | string'],
] as const;

test('recognizes every pinned Mermaid 11.17.2 family and emits a bounded baseline scene', () => {
  for (const [expectedKind, fixture] of dialectFixtures) {
    const result = renderDiagram(encoder.encode(fixture), { width: 720 });
    assert.ok(result.scene, `${expectedKind}: ${result.diagnostics.map((item) => item.message).join(', ')}`);
    assert.equal(result.scene.kind, expectedKind);
    assert.equal(result.scene.compatibilityVersion, MERMAID_COMPATIBILITY_VERSION);
    assert.equal(result.scene.usesSimd, true);
    assert.ok(result.scene.width >= 280);
    assert.ok(result.scene.height >= 120);
    assert.ok(result.scene.commands.length > 0, expectedKind);
  }
});

test('preserves common class, state-boundary, and ER graph semantics', () => {
  const fixtures = [
    {
      source: 'classDiagram\nclass Animal {\n+String name\n}\nAnimal <|-- Duck',
      labels: ['Animal', 'Duck'],
    },
    {
      source: 'stateDiagram-v2\n[*] --> Still\nStill --> Moving\nMoving --> [*]',
      labels: ['Start', 'Still', 'Moving', 'End'],
    },
    {
      source: 'erDiagram\nCUSTOMER ||--o{ ORDER : places',
      labels: ['CUSTOMER', 'ORDER', 'places'],
    },
  ] as const;

  for (const fixture of fixtures) {
    const result = renderDiagram(encoder.encode(fixture.source), { width: 720 });
    assert.ok(result.scene, result.diagnostics.map((item) => item.message).join(', '));
    const text = result.scene.commands
      .filter((command) => command.type === 'text')
      .map((command) => command.text);
    for (const label of fixture.labels) assert.ok(text.includes(label), `${label}: ${text.join(', ')}`);
    assert.ok(result.scene.commands.some((command) => command.type === 'line' && command.markerEnd));
  }
});

test('serializes accessible safe SVG without arbitrary HTML or script surfaces', () => {
  const svg = renderDiagramToSvg(
    encoder.encode('flowchart LR\naccTitle: Safe graph\naccDescr: Input to output\nA[Input] --> B[Output]'),
    { width: 640 },
  );
  assert.match(svg, /<figure class="mermaid-diagram"/);
  assert.match(svg, /<svg[^>]+role="img"/);
  assert.match(svg, /<title[^>]*>Safe graph<\/title>/);
  assert.match(svg, /<desc[^>]*>Input to output<\/desc>/);
  assert.match(svg, />Input<\/text>/);
  assert.match(svg, />Output<\/text>/);
  assert.doesNotMatch(svg, /<script|<foreignObject|\son[a-z]+=/i);
});

test('rejects unsafe callbacks and preserves the Mermaid source and following Markdown', async () => {
  const parser = new MDParser();
  const html = await parser.parse(u8(`Before

\`\`\`mermaid
flowchart LR
A --> B
click A call dangerous()
\`\`\`

After`));
  assert.match(html, /Before/);
  assert.match(html, /mermaid-diagram--error/);
  assert.match(html, /callbacks are not permitted/);
  assert.match(html, /click A call dangerous\(\)/);
  assert.match(html, /After/);
  assert.doesNotMatch(html, /<svg class="mermaid-diagram__svg"/);
});

test('renders a Mermaid fence inline and never consumes the following block', async () => {
  const html = await new MDParser().parse(u8(`## Diagram

\`\`\`mermaid
flowchart LR
A[Parse] --> B[Render]
\`\`\`

## Following heading`));
  assert.match(html, /data-diagram-kind="flowchart"/);
  assert.match(html, />Parse<\/text>/);
  assert.match(html, />Render<\/text>/);
  assert.match(html, /<h2>Following heading<\/h2>/);
});

test('canvas adapter executes the renderer-neutral scene', () => {
  const result = renderDiagram(encoder.encode('flowchart LR\nA[Parse] --> B[Render]'), { width: 640 });
  assert.ok(result.scene);
  const text: string[] = [];
  const target: Record<PropertyKey, unknown> = {
    globalAlpha: 1,
    lineWidth: 1,
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillText(value: string) { text.push(value); },
  };
  const context = new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      return () => undefined;
    },
    set(object, property, value) {
      object[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const height = drawDiagramSceneToCanvas(result.scene, context, { maxWidth: 320 });
  assert.ok(height > 0 && height <= result.scene.height);
  assert.ok(text.includes('Parse'));
  assert.ok(text.includes('Render'));
});

test('PDF renderer emits Mermaid diagrams as native vectors with searchable text', () => {
  const pdf = renderPDFFromBlocks(u8(`Before

\`\`\`mermaid
flowchart LR
A[Start] --> B[Finish]
\`\`\`

After`));
  const source = decoder.decode(pdf);
  assert.ok(source.startsWith('%PDF-1.7\n'));
  assert.match(source, /5374617274/); // Start
  assert.match(source, /46696E697368/); // Finish
  assert.match(source, /4166746572/); // After
  assert.match(source, /\sm\n|\sm\s/);
  assert.doesNotMatch(source, /\/Subtype \/Image/);
});

test('diagram runtime keeps the package dependency graph empty', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  assert.deepEqual(pkg.dependencies ?? {}, {});
});
