import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBitset,
  bitsetHas,
  bytesMatch,
  isAsciiAlpha,
  isAsciiAlphaNumeric,
  isAsciiDigit,
  isAsciiHexDigit,
  isAsciiLineBreak,
  isAsciiSpace,
  isAsciiWhitespace,
  toLowerAscii,
} from '../src/common/char-class.ts';

test('char-class: basic predicates', () => {
  assert.equal(isAsciiSpace(0x20), true);
  assert.equal(isAsciiSpace(0x09), true);
  assert.equal(isAsciiSpace(0x0a), false);

  assert.equal(isAsciiWhitespace(0x0b), true);
  assert.equal(isAsciiWhitespace(0x41), false);

  assert.equal(isAsciiLineBreak(0x0a), true);
  assert.equal(isAsciiLineBreak(0x0d), true);
  assert.equal(isAsciiLineBreak(0x20), false);

  assert.equal(isAsciiDigit(0x30), true);
  assert.equal(isAsciiDigit(0x39), true);
  assert.equal(isAsciiDigit(0x3a), false);

  assert.equal(isAsciiHexDigit(0x66), true);
  assert.equal(isAsciiHexDigit(0x47), false);

  assert.equal(isAsciiAlpha(0x41), true);
  assert.equal(isAsciiAlpha(0x7a), true);
  assert.equal(isAsciiAlpha(0x30), false);

  assert.equal(isAsciiAlphaNumeric(0x30), true);
  assert.equal(isAsciiAlphaNumeric(0x5f), false);

  assert.equal(toLowerAscii(0x41), 0x61);
  assert.equal(toLowerAscii(0x61), 0x61);
});

test('char-class: bitset generation', () => {
  const bits = createBitset([[0x41, 0x5a], [0x61, 0x7a]]);
  assert.ok(bitsetHas(bits, 0x41));
  assert.ok(bitsetHas(bits, 0x6d));
  assert.equal(bitsetHas(bits, 0x30), false);
});

test('char-class: bytesMatch', () => {
  const src = new TextEncoder().encode('abcdef');
  const needle = new TextEncoder().encode('cde');
  assert.ok(bytesMatch(src, 2, needle));
  assert.ok(!bytesMatch(src, 3, needle));
});
