/**
 * Line-span generator for efficiently splitting input into lines
 */

import { tryCreateWasmLineSpanIterator } from '../wasm/core';
import type { LineSpan } from './types';

/**
 * Generator that yields line spans (start, end positions) from a Uint8Array
 * Handles \n, \r, and \r\n line endings
 */
export function* lineSpans(u8: Uint8Array): Generator<LineSpan> {
  const wasm = tryCreateWasmLineSpanIterator(u8);
  if (wasm) {
    yield* wasm;
    return;
  }

  const len = u8.length;
  let pos = 0;
  
  while (pos < len) {
    const start = pos;
    
    // Scan until EOL
    while (pos < len) {
      const b = u8[pos++];
      if (b === 0x0a) break; // \n
      if (b === 0x0d) {      // \r or \r\n
        if (pos < len && u8[pos] === 0x0a) pos++;
        break;
      }
    }
    
    let end = pos;
    if (end > start) {
      const last = u8[end - 1];
      if (last === 0x0a || last === 0x0d) end--;
      if (end > start && u8[end - 1] === 0x0d) end--;
    }
    
    yield { start, end };
  }
}
