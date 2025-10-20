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
