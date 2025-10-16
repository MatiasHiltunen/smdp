/**
 * Byte-level utility functions for parsing
 */

import type { FenceInfo, ListMarker, UrlScan } from './types';

export const isSpace = (c: number): boolean => c === 0x20 || c === 0x09;

export const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;

export const isUrlChar = (c: number): boolean =>
  !(
    c <= 0x20 ||
    c === 0x3c || // <
    c === 0x3e || // >
    c === 0x5d || // ]
    c === 0x29 || // )
    c === 0x22 || // "
    c === 0x27    // '
  );

export function skipSpaces(u8: Uint8Array, s: number, e: number): number {
  while (s < e && isSpace(u8[s])) s++;
  return s;
}

export function isBlank(u8: Uint8Array, s: number, e: number): boolean {
  for (let i = s; i < e; i++) {
    if (!isSpace(u8[i])) return false;
  }
  return true;
}

export function hasRepeat(
  u8: Uint8Array,
  s: number,
  e: number,
  ch: number,
  n: number,
): boolean {
  for (let k = 0; k < n; k++) {
    if (s + k >= e || u8[s + k] !== ch) return false;
  }
  return true;
}

export function isHr(u8: Uint8Array, s: number, e: number): boolean {
  let star = 0;
  let dash = 0;
  let seen = 0;
  
  for (let i = s; i < e; i++) {
    const c = u8[i];
    if (c === 0x20) continue; // space
    if (c === 0x2a) {         // *
      star++;
      seen++;
    } else if (c === 0x2d) {  // -
      dash++;
      seen++;
    } else {
      return false;
    }
  }
  
  return seen >= 3 && (star === 0 || dash === 0);
}

export function detectFence(
  u8: Uint8Array,
  s: number,
  e: number,
): FenceInfo | null {
  if (s >= e) return null;
  
  const c = u8[s];
  if (c !== 0x60 && c !== 0x7e) return null; // ` or ~
  
  let i = s;
  let len = 0;
  
  while (i < e && u8[i] === c) {
    len++;
    i++;
  }
  
  return len >= 3 ? { ch: c, len } : null;
}

export function parseListMarker(
  u8: Uint8Array,
  s: number,
  e: number,
): ListMarker | null {
  let i = s;
  let indent = 0;
  
  while (i < e && isSpace(u8[i])) {
    indent += u8[i] === 0x09 ? 4 : 1;
    i++;
  }
  
  if (i >= e) return null;
  
  const c = u8[i];
  
  // Unordered list: -, *, +
  if (
    (c === 0x2d || c === 0x2a || c === 0x2b) &&
    i + 1 < e &&
    u8[i + 1] === 0x20
  ) {
    return { type: 'ul', indent, afterStart: i + 2, afterEnd: e };
  }
  
  // Ordered list: 1., 2., etc.
  if (isDigit(c)) {
    let j = i;
    while (j < e && isDigit(u8[j])) j++;
    if (j < e && u8[j] === 0x2e && j + 1 < e && u8[j + 1] === 0x20) {
      return { type: 'ol', indent, afterStart: j + 2, afterEnd: e };
    }
  }
  
  return null;
}

export function findBracket(
  u8: Uint8Array,
  s: number,
  e: number,
  closing: number,
): number {
  let depth = 0;
  
  for (let i = s; i < e; i++) {
    const c = u8[i];
    if (c === 0x5b) depth++; // [
    if (c === closing) {
      if (depth === 0) return i;
      depth--;
    }
  }
  
  return -1;
}

export function matchHttp(u8: Uint8Array, i: number, e: number): boolean {
  if (
    i + 7 < e &&
    u8[i] === 0x68 &&     // h
    u8[i + 1] === 0x74 && // t
    u8[i + 2] === 0x74 && // t
    u8[i + 3] === 0x70    // p
  ) {
    let j = i + 4;
    if (j < e && u8[j] === 0x73) j++; // optional 's'
    return (
      j + 2 < e &&
      u8[j] === 0x3a &&     // :
      u8[j + 1] === 0x2f && // /
      u8[j + 2] === 0x2f    // /
    );
  }
  return false;
}

export function matchWww(u8: Uint8Array, i: number, e: number): boolean {
  return (
    i + 3 < e &&
    u8[i] === 0x77 &&     // w
    u8[i + 1] === 0x77 && // w
    u8[i + 2] === 0x77 && // w
    u8[i + 3] === 0x2e    // .
  );
}

export function scanUrl(u8: Uint8Array, i: number, e: number): UrlScan {
  let j = i;
  
  if (u8[i] === 0x77) {
    // www.
    while (j < e && isUrlChar(u8[j])) j++;
  } else {
    // http:// or https://
    const offset = u8[i + 4] === 0x73 ? 8 : 7; // https:// or http://
    j = i + offset;
    while (j < e && isUrlChar(u8[j])) j++;
  }
  
  return { hrefStart: i, hrefEnd: j };
}

/**
 * Detect if line is a table separator: |---|:---:|---:|
 * Returns alignments for each column
 */
export function isTableSeparator(
  u8: Uint8Array,
  start: number,
  end: number,
): { isTable: boolean; alignments: Array<'left' | 'center' | 'right'> } {
  let i = skipSpaces(u8, start, end);
  const alignments: Array<'left' | 'center' | 'right'> = [];
  
  // Must start with |
  if (i >= end || u8[i] !== 0x7c) { // |
    return { isTable: false, alignments: [] };
  }
  i++;
  
  while (i < end) {
    i = skipSpaces(u8, i, end);
    if (i >= end) break;
    
    // Check for alignment markers
    let leftColon = false;
    let rightColon = false;
    
    if (u8[i] === 0x3a) { // :
      leftColon = true;
      i++;
    }
    
    // Must have at least one dash
    let hasDash = false;
    while (i < end && u8[i] === 0x2d) { // -
      hasDash = true;
      i++;
    }
    
    if (!hasDash) {
      return { isTable: false, alignments: [] };
    }
    
    if (i < end && u8[i] === 0x3a) { // :
      rightColon = true;
      i++;
    }
    
    // Determine alignment
    if (leftColon && rightColon) {
      alignments.push('center');
    } else if (rightColon) {
      alignments.push('right');
    } else {
      alignments.push('left');
    }
    
    i = skipSpaces(u8, i, end);
    
    // Should have | or end
    if (i < end && u8[i] === 0x7c) { // |
      i++;
    } else if (i < end) {
      return { isTable: false, alignments: [] };
    }
  }
  
  return { isTable: alignments.length > 0, alignments };
}

/**
 * Parse table row into cells
 */
export function parseTableRow(
  u8: Uint8Array,
  start: number,
  end: number,
): Array<{ s: number; e: number }> {
  const cells: Array<{ s: number; e: number }> = [];
  let i = skipSpaces(u8, start, end);
  
  // Skip leading |
  if (i < end && u8[i] === 0x7c) { // |
    i++;
  }
  
  while (i < end) {
    i = skipSpaces(u8, i, end);
    const cellStart = i;
    
    // Find next | or end
    while (i < end && u8[i] !== 0x7c) { // |
      i++;
    }
    
    // Trim trailing spaces from cell content
    let cellEnd = i;
    while (cellEnd > cellStart && isSpace(u8[cellEnd - 1])) {
      cellEnd--;
    }
    
    if (cellEnd > cellStart) {
      cells.push({ s: cellStart, e: cellEnd });
    } else {
      cells.push({ s: cellStart, e: cellStart }); // Empty cell
    }
    
    // Skip |
    if (i < end && u8[i] === 0x7c) { // |
      i++;
    }
  }
  
  return cells;
}

/**
 * Detect info block start: ::: info, ::: warning, etc.
 */
export function detectInfoBlock(
  u8: Uint8Array,
  start: number,
  end: number,
): { isInfo: boolean; type?: string; isClose?: boolean } {
  let i = skipSpaces(u8, start, end);
  
  // Check for :::
  if (i + 3 > end || u8[i] !== 0x3a || u8[i + 1] !== 0x3a || u8[i + 2] !== 0x3a) { // :::
    return { isInfo: false };
  }
  i += 3;
  
  i = skipSpaces(u8, i, end);
  
  // If nothing after :::, it's a closing tag
  if (i >= end) {
    return { isInfo: true, isClose: true };
  }
  
  // Extract type
  const typeStart = i;
  while (i < end && !isSpace(u8[i])) {
    i++;
  }
  
  const typeBytes = u8.slice(typeStart, i);
  const type = new TextDecoder().decode(typeBytes).toLowerCase();
  
  if (type === 'info' || type === 'warning' || type === 'error' || type === 'success') {
    return { isInfo: true, type };
  }
  
  return { isInfo: false };
}

