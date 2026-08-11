import assert from 'node:assert/strict';
import test from 'node:test';

import { getLanguageSpec, getRegisteredHighlightSpecs } from '../src/highlight/index.ts';
import {
  CompiledLanguageSpec,
  GenericTokenizer,
  type TokenTypeValue,
} from '../src/highlight/language-core.ts';
import { lineSpans } from '../src/parser/line-parser.ts';
import {
  createWasmLineSpanIterator,
  getWasmCoreStatus,
  setWasmCoreEnabled,
  tokenizeWithWasm,
} from '../src/wasm/core.ts';

const encoder = new TextEncoder();

type TokenEvent = [type: TokenTypeValue, start: number, end: number, meta?: number];

function scalarTokens(spec: CompiledLanguageSpec, source: Uint8Array): TokenEvent[] {
  const events: TokenEvent[] = [];
  setWasmCoreEnabled(false);
  try {
    new GenericTokenizer(spec).tokenize(source, (type, start, end, meta) => {
      if (meta === undefined) events.push([type, start, end]);
      else events.push([type, start, end, meta]);
    });
  } finally {
    setWasmCoreEnabled(true);
  }
  return events;
}

function wasmTokens(spec: CompiledLanguageSpec, source: Uint8Array): TokenEvent[] {
  const events: TokenEvent[] = [];
  const used = tokenizeWithWasm(source, spec.getWasmProfile(), (type, start, end, meta) => {
    if (meta === undefined) events.push([type, start, end]);
    else events.push([type, start, end, meta]);
  });
  assert.equal(used, true);
  return events;
}

test('loads the checked-in SIMD WebAssembly ABI', () => {
  const status = getWasmCoreStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.available, true, status.failure);
  assert.equal(status.abiVersion, 1);
  assert.equal(status.usesSimd, true);
});

test('SIMD line scanner matches scalar CR, LF, CRLF, and batched output', () => {
  const chunks: string[] = ['alpha\r\nbeta\rgamma\n', '\n'];
  for (let i = 0; i < 5000; i++) chunks.push(`line-${i}\r\n`);
  chunks.push('tail');
  const source = encoder.encode(chunks.join(''));

  setWasmCoreEnabled(false);
  const expected = Array.from(lineSpans(source));
  setWasmCoreEnabled(true);
  const iterator = createWasmLineSpanIterator(source);
  assert.ok(iterator);
  assert.deepEqual(Array.from(iterator), expected);
});

test('generic WebAssembly tokenizer is differential with scalar language specs', () => {
  const cases: Array<[string, string]> = [
    [
      'rust',
      '#!/usr/bin/env rustx\nfn main() { let n: u64 = 0xff_ff; /* block */ println!("value={}", n); }\n',
    ],
    [
      'python',
      '#!/usr/bin/env python3\ndef add(value: int = 1_000):\n    # comment\n    return value ** 2 + .5\n',
    ],
    [
      'sql',
      "SELECT id, name FROM users WHERE score >= 1.5e+2 AND name LIKE 'A%'; -- tail\n",
    ],
  ];

  for (const [language, text] of cases) {
    const spec = getLanguageSpec(language);
    assert.ok(spec, language);
    const source = encoder.encode(text);
    assert.deepEqual(wasmTokens(spec, source), scalarTokens(spec, source), language);
  }
});

test('WebAssembly tokenizer preserves regex heuristics and every packed operator width', () => {
  const spec = new CompiledLanguageSpec({
    name: 'simd-test',
    keywords: [{ word: 'return', code: 1 }, { word: 'let' }],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: [{ quote: '"', escape: '\\' }],
    numbers: {
      allowHex: true,
      allowBin: true,
      allowOct: true,
      allowUnderscore: true,
      allowBigInt: true,
      allowLeadingDot: true,
    },
    regex: { enabled: true },
  });
  const source = encoder.encode(
    'return /a[b\\/]c+/gi; let q = a / b; 0b10_01 0o7_1 123_456n 1.2e+3_4 .5 ' +
      '=== !== >>> >>= <<= ++ -- == != && || *= /= %= += -= &= |= ^= << >> ?: .. =>\n',
  );
  assert.deepEqual(wasmTokens(spec, source), scalarTokens(spec, source));
});

test('all compatible built-in profiles stay differential on mixed syntax', () => {
  const source = encoder.encode(
    '#!/usr/bin/env tool\n' +
      'alpha = 0xff_ff + 1.25e-3; // line\n' +
      '# hash\n/* block */ "escaped\\\" text" \'single\'\n' +
      'SELECT value FROM table WHERE enabled = true;\n',
  );
  let checked = 0;
  for (const { name } of getRegisteredHighlightSpecs()) {
    const spec = getLanguageSpec(name);
    assert.ok(spec, name);
    if (spec.getWasmProfile().templateEnabled) continue;
    assert.deepEqual(wasmTokens(spec, source), scalarTokens(spec, source), name);
    checked++;
  }
  assert.ok(checked >= 8);
});

test('WebAssembly tokenizer resumes across a full event buffer', () => {
  const spec = new CompiledLanguageSpec({
    name: 'batch-test',
    keywords: [{ word: 'let' }],
    lineComments: ['//'],
  });
  const source = encoder.encode('let value = 123; '.repeat(2500));
  const actual = wasmTokens(spec, source);
  assert.ok(actual.length > 4096);
  assert.deepEqual(actual, scalarTokens(spec, source));
});

test('template languages retain the scalar tokenizer path', () => {
  const spec = getLanguageSpec('javascript');
  assert.ok(spec);
  const used = tokenizeWithWasm(encoder.encode('const value = `x${1}`;'), spec.getWasmProfile(), () => {});
  assert.equal(used, false);
});

test('disabled WebAssembly core cleanly falls back to scalar APIs', () => {
  const spec = new CompiledLanguageSpec({ name: 'fallback', keywords: [{ word: 'let' }] });
  const source = encoder.encode('let value = 1;'.repeat(100));
  setWasmCoreEnabled(false);
  try {
    assert.equal(createWasmLineSpanIterator(source), null);
    assert.equal(tokenizeWithWasm(source, spec.getWasmProfile(), () => {}), false);
    const events: TokenEvent[] = [];
    new GenericTokenizer(spec).tokenize(source, (type, start, end) => events.push([type, start, end]));
    assert.ok(events.length > 0);
  } finally {
    setWasmCoreEnabled(true);
  }
});

test('consumer callback errors do not disable the WebAssembly module', () => {
  const spec = new CompiledLanguageSpec({ name: 'callback', keywords: [{ word: 'let' }] });
  const source = encoder.encode('let value = 1;');
  assert.throws(
    () => tokenizeWithWasm(source, spec.getWasmProfile(), () => {
      throw new Error('consumer failure');
    }),
    /consumer failure/,
  );
  assert.equal(getWasmCoreStatus().available, true);
});

test('large Markdown render is identical across scalar and SIMD dispatch', async () => {
  const { MDParser } = await import('../src/parser/index.ts');
  const markdown = [
    '# SIMD integration',
    '',
    ...Array.from({ length: 1800 }, (_, i) => `Paragraph ${i} with **bold** and [link](https://example.com/${i}).`),
    '',
    '| Name | Value |',
    '|:-----|------:|',
    '| alpha | 1 |',
    '',
    '```rust',
    ...Array.from({ length: 120 }, (_, i) => `let value_${i}: u64 = 0xff_ff + ${i}; // row`),
    '```',
  ].join('\n');
  const source = encoder.encode(markdown);
  assert.ok(source.length > 64 * 1024);

  const parser = new MDParser();
  let scalar: string;
  setWasmCoreEnabled(false);
  try {
    scalar = await parser.parse(source, {});
  } finally {
    setWasmCoreEnabled(true);
  }
  const simd = await parser.parse(source, {});
  assert.equal(simd, scalar);
});
