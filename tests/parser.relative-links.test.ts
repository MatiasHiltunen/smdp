import assert from 'node:assert/strict';
import test from 'node:test';

import { MDParser, u8 } from '../src/parser/index.ts';

test('resolves relative links and images with baseUrl', async () => {
  const parser = new MDParser();
  const markdown = '![logo](./img/logo.png)\n\n[Guide](../guide.md)';
  const html = await parser.parse(u8(markdown), { baseUrl: 'https://example.com/docs/readme.md' });

  assert.ok(
    html.includes('<img alt="logo" src="https://example.com/docs/img/logo.png">'),
    'image source should resolve against base URL',
  );
  assert.ok(
    html.includes('<a href="https://example.com/guide.md">Guide</a>'),
    'link href should resolve against base URL',
  );
});

test('preserves relative links when baseUrl is undefined', async () => {
  const parser = new MDParser();
  const markdown = '![logo](./img/logo.png)\n\n[Guide](../guide.md)';
  const html = await parser.parse(u8(markdown));

  assert.ok(
    html.includes('<img alt="logo" src="./img/logo.png">'),
    'image source should stay relative without base URL',
  );
  assert.ok(
    html.includes('<a href="../guide.md">Guide</a>'),
    'link href should stay relative without base URL',
  );
});

test('rewrites GitHub blob links only for markdown and image targets', async () => {
  const parser = new MDParser();
  const markdown = [
    '![rel](./.github/codex-cli-splash.png)',
    '![abs](https://github.com/openai/codex/blob/main/.github/codex-cli-splash.png)',
    '[Doc](./README.md)',
    '[Lock](./package-lock.json)',
  ].join('\n\n');
  const html = await parser.parse(u8(markdown), {
    baseUrl: 'https://github.com/openai/codex/blob/main/README.md',
  });

  assert.ok(
    html.includes('src="https://raw.githubusercontent.com/openai/codex/main/.github/codex-cli-splash.png"'),
    'image blob URLs should normalize to raw content',
  );
  assert.ok(
    html.includes('href="https://raw.githubusercontent.com/openai/codex/main/README.md"'),
    'markdown blob URLs should normalize to raw content',
  );
  assert.ok(
    html.includes('href="https://github.com/openai/codex/blob/main/package-lock.json"'),
    'non-markdown/non-image links should keep github.com blob URLs',
  );
});
