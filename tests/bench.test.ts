import assert from 'node:assert/strict';
import test, { after, describe, it } from 'node:test';
import { readdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const currentHead = execSync('git rev-parse --short HEAD');
const shouldWriteBenchResults = process.env.SMDP_WRITE_BENCH === '1';

interface BenchmarkResult {
  name: string;
  opsPerSec: number;
  avgTimeMs: number;
  iterations: number;
}

function writeResultsToFile(filename: string, results: BenchmarkResult[]) {
  const lines = results.map(result => {
    return `${result.name.replaceAll(" ", "_").toLocaleLowerCase()},${result.iterations},${result.opsPerSec.toFixed(2)},${result.avgTimeMs.toFixed(4)}`;
  });

  const header = 'name,iter,ops_per_s,avg_ms\n';
  const content = header + lines.join('\n');
  writeFileSync(filename, content, {
    encoding: 'utf-8',
    flag: "a+",
  });

}

let results : BenchmarkResult[] = [];

// Simple benchmark runner
async function runBenchmark(name: string, fn: () => void | Promise<void>, iterations: number = 1000): Promise<BenchmarkResult> {
  const startTime = performance.now();
  let ops = 0;

  for (let i = 0; i < iterations; i++) {
    await fn();
    ops++;
  }

  const endTime = performance.now();
  const totalTime = endTime - startTime;
  const avgTimeMs = totalTime / iterations;
  const opsPerSec = (ops / totalTime) * 1000;

  const result: BenchmarkResult = {
    name,
    opsPerSec,
    avgTimeMs,
    iterations,
  };

  results.push(result);

  return result;
}

async function benchmarkMarkdownParsing() {
  const { MDParser, u8 } = await import('../src/parser/index.ts');

  // Test documents of different sizes
  const smallDoc = '# Hello\n\nThis is a **small** document with `code` and [links](url).';
  const mediumDoc = `
# Medium Document

This is a medium-sized document with multiple paragraphs, lists, and code blocks.

## Section 1

- Item 1
- Item 2
- Item 3

## Section 2

\`\`\`javascript
function example() {
  console.log('Hello, world!');
  return 42;
}
\`\`\`

> This is a blockquote with some **bold** and *italic* text.

| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |

- [x] Completed task
- [ ] Incomplete task

## Conclusion

This concludes our medium document test.
`.trim();

  const largeDoc = `
# Large Document Performance Test

This is a comprehensive test document designed to evaluate parser performance with various Markdown features.

## Headings

${Array.from({ length: 10 }, (_, i) => `### Heading Level ${i + 3}`).join('\n\n')}

## Lists

### Unordered Lists

${Array.from({ length: 50 }, (_, i) => `- List item ${i + 1}`).join('\n')}

### Ordered Lists

${Array.from({ length: 50 }, (_, i) => `${i + 1}. Ordered item ${i + 1}`).join('\n')}

### Task Lists

${Array.from({ length: 30 }, (_, i) => `- [${i % 2 === 0 ? 'x' : ' '}] Task ${i + 1}`).join('\n')}

## Code Blocks

${Array.from({ length: 10 }, (_, i) => `
\`\`\`javascript
// Code block ${i + 1}
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const result = fibonacci(10);
console.log('Fibonacci result:', result);
\`\`\`
`).join('\n')}

## Blockquotes

> This is a blockquote with **bold** and *italic* text.
> It spans multiple lines to test blockquote parsing.

## Links and Images

${Array.from({ length: 20 }, (_, i) => `[Link ${i + 1}](https://example.com/link${i + 1})`).join(' ')}

${Array.from({ length: 20 }, (_, i) => `![Image ${i + 1}](https://example.com/image${i + 1}.png)`).join(' ')}

## Inline Formatting

This paragraph contains **bold**, *italic*, \`code\`, and ~~strikethrough~~ text, as well as [links](url) and ![images](src).

## Tables

${Array.from({ length: 5 }, (_, i) => `
| Col 1 | Col 2 | Col 3 | Col 4 |
|-------|-------|-------|-------|
| Data ${i * 4 + 1} | Data ${i * 4 + 2} | Data ${i * 4 + 3} | Data ${i * 4 + 4} |
| Data ${i * 4 + 5} | Data ${i * 4 + 6} | Data ${i * 4 + 7} | Data ${i * 4 + 8} |
`).join('\n')}

## Conclusion

This large document contains approximately 1000 lines of Markdown content with various features to test parser performance.
`.trim();

  const parser = new MDParser();

  // Benchmark small document
  const smallResult = await runBenchmark('Small document parse', async () => {
    await parser.parse(u8(smallDoc), {});
  }, 1000);

  // Benchmark medium document
  const mediumResult = await runBenchmark('Medium document parse', async () => {
    await parser.parse(u8(mediumDoc), {});
  }, 100);

  // Benchmark large document
  const largeResult = await runBenchmark('Large document parse', async () => {
    await parser.parse(u8(largeDoc), {});
  }, 10);

  return { smallResult, mediumResult, largeResult };
}

async function benchmarkHighlighting() {
  const { highlightCodeBlock } = await import('../src/highlight/index.ts');

  const codeSamples = {
    small: 'const x = 42;',
    medium: `
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const result = fibonacci(10);
console.log(result);
    `.trim(),
    large: `
${Array.from({ length: 100 }, (_, i) => `const variable${i} = ${i};`).join('\n')}

function complexFunction(param1, param2, param3) {
  // Complex logic here
  const result = param1 + param2 * param3;
  for (let i = 0; i < param1; i++) {
    result += i * 2;
  }
  return result;
}

class ExampleClass {
  constructor(value) {
    this.value = value;
  }

  method1() {
    return this.value * 2;
  }

  method2() {
    return this.method1() + 10;
  }
}

const instance = new ExampleClass(42);
console.log(instance.method2());
    `.trim(),
  };

  // Benchmark small code
  const smallResult = await runBenchmark('Small code highlight', async () => {
    await highlightCodeBlock(new TextEncoder().encode(codeSamples.small), 'js');
  }, 1000);

  // Benchmark medium code
  const mediumResult = await runBenchmark('Medium code highlight', async () => {
    await highlightCodeBlock(new TextEncoder().encode(codeSamples.medium), 'javascript');
  }, 100);

  // Benchmark large code
  const largeResult = await runBenchmark('Large code highlight', async () => {
    await highlightCodeBlock(new TextEncoder().encode(codeSamples.large), 'js');
  }, 10);

  return { smallResult, mediumResult, largeResult };
}

async function benchmarkInlineParsing() {
  const { inlineTokens } = await import('../src/parser/inline-parser.ts');
  const { u8 } = await import('../src/parser/index.ts');

  const inlineSamples = {
    simple: 'Simple text without formatting.',
    complex: 'Text with **bold**, *italic*, `code`, ~~strikethrough~~, [links](url), and ![images](src).',
    nested: '**Bold *italic **nested bold*** italic** and more ~~strikethrough **bold strike**~~',
    long: 'Very long text '.repeat(100) + ' with **bold** and *italic* formatting throughout.',
  };

  // Benchmark simple inline
  const simpleResult = await runBenchmark('Simple inline parse', () => {
    Array.from(inlineTokens(u8(inlineSamples.simple), 0, inlineSamples.simple.length));
  }, 10000);

  // Benchmark complex inline
  const complexResult = await runBenchmark('Complex inline parse', () => {
    Array.from(inlineTokens(u8(inlineSamples.complex), 0, inlineSamples.complex.length));
  }, 1000);

  // Benchmark nested inline
  const nestedResult = await runBenchmark('Nested inline parse', () => {
    Array.from(inlineTokens(u8(inlineSamples.nested), 0, inlineSamples.nested.length));
  }, 1000);

  // Benchmark long inline
  const longResult = await runBenchmark('Long inline parse', () => {
    Array.from(inlineTokens(u8(inlineSamples.long), 0, inlineSamples.long.length));
  }, 100);

  return { simpleResult, complexResult, nestedResult, longResult };
}

test('benchmark: parser performance', async () => {
  const results = await benchmarkMarkdownParsing();

  console.log('\n=== Markdown Parser Benchmarks ===');
  console.log(`Small document: ${results.smallResult.opsPerSec.toFixed(0)} ops/sec (${results.smallResult.avgTimeMs.toFixed(3)}ms avg)`);
  console.log(`Medium document: ${results.mediumResult.opsPerSec.toFixed(0)} ops/sec (${results.mediumResult.avgTimeMs.toFixed(3)}ms avg)`);
  console.log(`Large document: ${results.largeResult.opsPerSec.toFixed(0)} ops/sec (${results.largeResult.avgTimeMs.toFixed(3)}ms avg)`);

  // Basic assertions to ensure benchmarks run without errors
  assert.ok(results.smallResult.opsPerSec > 0);
  assert.ok(results.mediumResult.opsPerSec > 0);
  assert.ok(results.largeResult.opsPerSec > 0);
});

test('benchmark: highlighting performance', async () => {
  const results = await benchmarkHighlighting();

  console.log('\n=== Code Highlighting Benchmarks ===');
  console.log(`Small code: ${results.smallResult.opsPerSec.toFixed(0)} ops/sec (${results.smallResult.avgTimeMs.toFixed(3)}ms avg)`);
  console.log(`Medium code: ${results.mediumResult.opsPerSec.toFixed(0)} ops/sec (${results.mediumResult.avgTimeMs.toFixed(3)}ms avg)`);
  console.log(`Large code: ${results.largeResult.opsPerSec.toFixed(0)} ops/sec (${results.largeResult.avgTimeMs.toFixed(3)}ms avg)`);

  // Basic assertions to ensure benchmarks run without errors
  assert.ok(results.smallResult.opsPerSec > 0);
  assert.ok(results.mediumResult.opsPerSec > 0);
  assert.ok(results.largeResult.opsPerSec > 0);
});

test('benchmark: inline parsing performance', async () => {
  const results = await benchmarkInlineParsing();

  console.log('\n=== Inline Parsing Benchmarks ===');
  console.log(`Simple inline: ${results.simpleResult.opsPerSec.toFixed(0)} ops/sec (${results.simpleResult.avgTimeMs.toFixed(3)}ms avg)`);
  console.log(`Complex inline: ${results.complexResult.opsPerSec.toFixed(0)} ops/sec (${results.complexResult.avgTimeMs.toFixed(3)}ms avg)`);
  console.log(`Nested inline: ${results.nestedResult.opsPerSec.toFixed(0)} ops/sec (${results.nestedResult.avgTimeMs.toFixed(3)}ms avg)`);
  console.log(`Long inline: ${results.longResult.opsPerSec.toFixed(0)} ops/sec (${results.longResult.avgTimeMs.toFixed(3)}ms avg)`);

  // Basic assertions to ensure benchmarks run without errors
  assert.ok(results.simpleResult.opsPerSec > 0);
  assert.ok(results.complexResult.opsPerSec > 0);
  assert.ok(results.nestedResult.opsPerSec > 0);
  assert.ok(results.longResult.opsPerSec > 0);
});

// Memory usage benchmark (basic)
test('benchmark: memory usage', async () => {
  const { MDParser, u8 } = await import('../src/parser/index.ts');

  const parser = new MDParser();
  const largeDoc = 'Large document content '.repeat(10000);

  // Force garbage collection if available (Node.js specific)
  if (global.gc) {
    global.gc();
  }

  const initialMemory = process.memoryUsage?.().heapUsed || 0;

  // Parse large document multiple times
  for (let i = 0; i < 100; i++) {
    await parser.parse(u8(largeDoc), {});
  }

  if (global.gc) {
    global.gc();
  }

  const finalMemory = process.memoryUsage?.().heapUsed || 0;
  const memoryUsed = finalMemory - initialMemory;

  console.log('\n=== Memory Usage Benchmark ===');
  console.log(`Memory used for 100 large document parses: ${(memoryUsed / 1024 / 1024).toFixed(2)} MB`);

  // Basic assertion to ensure memory usage is reasonable
  assert.ok(memoryUsed < 100 * 1024 * 1024, 'Memory usage seems excessive'); // Less than 100MB
});


describe('results', async () => {
  after(() => {
    if (!shouldWriteBenchResults) return;

    const benchDir = './bench';
    const files = readdirSync(benchDir)
    const count = files.filter(f => f.endsWith('.csv')).length + 1;

    writeResultsToFile(`bench/${count}_${currentHead.toString().trim()}.csv`, results);

  });
}); 
