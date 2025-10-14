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

