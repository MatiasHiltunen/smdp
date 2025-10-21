import test from 'node:test';
import assert from 'node:assert/strict';

import { ByteStream } from '../src/common/byte-stream.ts';

test('byte-stream: basic navigation', () => {
  const bytes = new TextEncoder().encode('abc');
  const stream = new ByteStream(bytes);

  assert.equal(stream.peek(), 0x61);
  assert.equal(stream.read(), 0x61);
  assert.equal(stream.pos, 1);
  stream.advance(1);
  assert.equal(stream.peek(), 0x63);
  stream.advance();
  assert.equal(stream.eof, true);
});

test('byte-stream: indent consumption and CRLF handling', () => {
  const bytes = new TextEncoder().encode(' \tfoo\r\nbar');
  const stream = new ByteStream(bytes);

  const indent = stream.consumeIndent();
  assert.equal(indent, 1 + 4); // space + tab (tabWidth default 4)
  assert.equal(stream.peek(), 0x66); // 'f'

  stream.advance(3); // consume "foo"
  assert.equal(stream.line, 0);
  assert.equal(stream.column > 0, true);

  const ch = stream.read();
  assert.equal(ch, 0x0d);
  assert.equal(stream.line, 1); // CRLF counted once
  assert.equal(stream.column, 0);
  assert.equal(stream.peek(), 0x62); // 'b'
});
