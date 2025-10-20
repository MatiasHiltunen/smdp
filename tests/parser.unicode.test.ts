import assert from 'node:assert/strict';
import test from 'node:test';

import { MDParser, u8 } from '../src/parser/index.ts';

test('preserves multi-byte characters at paragraph boundaries', async () => {
  const parser = new MDParser();
  const markdown = 'Loppuu ä\n\nEmoji päätteessä 🐶';
  const html = await parser.parse(u8(markdown));

  assert.ok(
    html.includes('Loppuu ä'),
    'two-byte characters should remain intact at the end of a line',
  );
  assert.ok(
    html.includes('Emoji päätteessä 🐶'),
    'four-byte characters should remain intact at the end of a line',
  );
  assert.ok(
    !html.includes('�'),
    'output should not contain UTF-8 replacement characters',
  );
});
