/**
 * Byte-level utility functions for parsing
 */

import { isAsciiDigit, isAsciiSpace } from "../common/char-class.ts";
import { ByteStream } from "../common/byte-stream.ts";
import type { FenceInfo, FenceMeta, ListMarker, UrlScan } from "./types";
import { TD } from "./constants";

export const isSpace = (c: number): boolean => isAsciiSpace(c);

export const isDigit = (c: number): boolean => isAsciiDigit(c);

export const isUrlChar = (c: number): boolean =>
  !(
    c <= 0x20 ||
    c === 0x3c || // <
    c === 0x3e || // >
    c === 0x5d || // ]
    c === 0x29 || // )
    c === 0x22 || // "
    c === 0x27 // '
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
    if (c === 0x2a) {
      // *
      star++;
      seen++;
    } else if (c === 0x2d) {
      // -
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

export function parseFenceMeta(
  u8: Uint8Array,
  s: number,
  e: number,
): FenceMeta | undefined {
  let start = skipSpaces(u8, s, e);
  let end = e;

  while (end > start && isSpace(u8[end - 1])) {
    end--;
  }

  if (end <= start) {
    return undefined;
  }

  const infoString = TD.decode(u8.subarray(start, end)).trim();

  if (!infoString) {
    return undefined;
  }

  const parts = infoString.split(/\s+/);
  let rawLang = parts.shift();
  const metaParts: string[] = [];

  if (rawLang && rawLang.includes(":")) {
    const [langPart, ...rest] = rawLang.split(":");
    rawLang = langPart;
    if (rest.length) {
      metaParts.push(rest.join(":"));
    }
  }

  if (parts.length) {
    metaParts.push(parts.join(" "));
  }

  const meta = metaParts.join(" ").trim();

  const result: FenceMeta = { infoString };

  if (rawLang && rawLang.length) {
    result.rawLang = rawLang;
    result.lang = rawLang.toLowerCase();
  }

  if (meta) {
    result.meta = meta;
  }

  return result;
}

export function parseListMarker(
  u8: Uint8Array,
  s: number,
  e: number,
): ListMarker | null {
  const stream = new ByteStream(u8, s, e);
  const indent = stream.consumeIndent();
  const i = stream.pos;

  if (i >= e) return null;

  const c = u8[i];

  // Unordered list: -, *, +
  if (
    (c === 0x2d || c === 0x2a || c === 0x2b) &&
    i + 1 < e &&
    u8[i + 1] === 0x20
  ) {
    return { type: "ul", indent, afterStart: i + 2, afterEnd: e };
  }

  // Ordered list: 1., 2., etc.
  if (isDigit(c)) {
    let j = i;
    while (j < e && isDigit(u8[j])) j++;
    if (j < e && u8[j] === 0x2e && j + 1 < e && u8[j + 1] === 0x20) {
      return { type: "ol", indent, afterStart: j + 2, afterEnd: e };
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
    u8[i] === 0x68 && // h
    u8[i + 1] === 0x74 && // t
    u8[i + 2] === 0x74 && // t
    u8[i + 3] === 0x70 // p
  ) {
    let j = i + 4;
    if (j < e && u8[j] === 0x73) j++; // optional 's'
    return (
      j + 2 < e &&
      u8[j] === 0x3a && // :
      u8[j + 1] === 0x2f && // /
      u8[j + 2] === 0x2f // /
    );
  }
  return false;
}

export function matchWww(u8: Uint8Array, i: number, e: number): boolean {
  return (
    i + 3 < e &&
    u8[i] === 0x77 && // w
    u8[i + 1] === 0x77 && // w
    u8[i + 2] === 0x77 && // w
    u8[i + 3] === 0x2e // .
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
): { isTable: boolean; alignments: Array<"left" | "center" | "right"> } {
  let i = skipSpaces(u8, start, end);
  const alignments: Array<"left" | "center" | "right"> = [];

  // Must start with |
  if (i >= end || u8[i] !== 0x7c) {
    // |
    return { isTable: false, alignments: [] };
  }
  i++;

  while (i < end) {
    i = skipSpaces(u8, i, end);
    if (i >= end) break;

    // Check for alignment markers
    let leftColon = false;
    let rightColon = false;

    if (u8[i] === 0x3a) {
      // :
      leftColon = true;
      i++;
    }

    // Must have at least one dash
    let hasDash = false;
    while (i < end && u8[i] === 0x2d) {
      // -
      hasDash = true;
      i++;
    }

    if (!hasDash) {
      return { isTable: false, alignments: [] };
    }

    if (i < end && u8[i] === 0x3a) {
      // :
      rightColon = true;
      i++;
    }

    // Determine alignment
    if (leftColon && rightColon) {
      alignments.push("center");
    } else if (rightColon) {
      alignments.push("right");
    } else {
      alignments.push("left");
    }

    i = skipSpaces(u8, i, end);

    // Should have | or end
    if (i < end && u8[i] === 0x7c) {
      // |
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
  const stream = new ByteStream(u8, start, end);

  while (!stream.eof && isSpace(stream.peek())) {
    stream.advance();
  }

  if (!stream.eof && stream.peek() === 0x7c) {
    stream.advance();
  }

  while (!stream.eof) {
    while (!stream.eof && isSpace(stream.peek())) stream.advance();
    const cellStart = stream.pos;

    while (!stream.eof && stream.peek() !== 0x7c) {
      stream.advance();
    }

    let cellEnd = stream.pos;
    while (cellEnd > cellStart && isSpace(u8[cellEnd - 1])) {
      cellEnd--;
    }

    cells.push({ s: cellStart, e: cellEnd });

    if (!stream.eof && stream.peek() === 0x7c) {
      stream.advance();
    }

    if (stream.eof) break;
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
  if (
    i + 3 > end ||
    u8[i] !== 0x3a ||
    u8[i + 1] !== 0x3a ||
    u8[i + 2] !== 0x3a
  ) {
    // :::
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

  const typeBytes = u8.subarray(typeStart, i);
  const type = TD.decode(typeBytes).toLowerCase();

  if (
    type === "info" ||
    type === "warning" ||
    type === "error" ||
    type === "success"
  ) {
    return { isInfo: true, type };
  }

  return { isInfo: false };
}

/**
 * Determine the expected length (in bytes) of a UTF-8 sequence from its lead byte.
 * Returns 0 for invalid lead bytes.
 */
function utf8SequenceLength(lead: number): number {
  if (lead <= 0x7f) return 1;
  if ((lead & 0b1110_0000) === 0b1100_0000) return 2;
  if ((lead & 0b1111_0000) === 0b1110_0000) return 3;
  if ((lead & 0b1111_1000) === 0b1111_0000) return 4;
  return 0;
}

/**
 * Clamp the end offset of a slice so it never splits a UTF-8 code point.
 * If the provided end already aligns with a code point boundary it is returned as-is.
 * If the end lands inside a code point and the full sequence fits within maxEnd,
 * the end is extended to include the remaining continuation bytes. Otherwise the
 * partial sequence is dropped to preserve well-formed UTF-8.
 */
export function clampUtf8SliceEnd(
  u8: Uint8Array,
  start: number,
  end: number,
  maxEnd: number = end,
): number {
  if (end <= start) return end;
  if (end > u8.length) end = u8.length;
  if (maxEnd > u8.length) maxEnd = u8.length;

  const last = u8[end - 1];
  if ((last & 0b1000_0000) === 0) {
    // ASCII, already aligned.
    return end;
  }

  let leadIndex = end - 1;
  while (leadIndex > start && (u8[leadIndex] & 0b1100_0000) === 0b1000_0000) {
    leadIndex--;
  }

  const leadByte = u8[leadIndex];
  if ((leadByte & 0b1100_0000) === 0b1000_0000) {
    // We ran out of buffer before finding a lead byte; treat as aligned.
    return end;
  }

  const expected = utf8SequenceLength(leadByte);
  if (expected === 0) {
    return end;
  }

  const have = end - leadIndex;
  if (have === expected) {
    return end;
  }

  if (have < expected) {
    const extended = end + (expected - have);
    if (extended <= maxEnd) {
      return extended;
    }
    return leadIndex;
  }

  // have > expected: clamp back to the end of this code point
  const clamped = leadIndex + expected;
  return clamped <= end ? clamped : end;
}

/**
 * Determine if a URL is allowed based on protocol allowlist.
 * - Allowed protocols: http, https, mailto
 * - Relative URLs (no protocol before first '/' or '?') are allowed
 */
export function isUrlAllowed(u8: Uint8Array, s: number, e: number): boolean {
  let i = s;
  let colonAt = -1;
  while (i < e) {
    const c = u8[i];
    if (c === 0x3a) {
      // ':'
      colonAt = i;
      break;
    }
    if (c === 0x2f || c === 0x3f || c === 0x23) {
      // '/', '?', '#'
      // No protocol before path/query/fragment → relative
      return true;
    }
    i++;
  }
  if (colonAt === -1) {
    // No ':' found → relative or hostname-only → allow
    return true;
  }
  // Compare lowercase protocol prefix
  const protEnd = colonAt;
  const len = protEnd - s;
  if (len <= 0) return false;

  // Fast-path checks for 'http' and 'mailto'
  // http / https
  if (
    len === 4 &&
    (u8[s] | 32) === 0x68 && // h
    (u8[s + 1] | 32) === 0x74 && // t
    (u8[s + 2] | 32) === 0x74 && // t
    (u8[s + 3] | 32) === 0x70
  ) {
    // p
    return true;
  }
  // mailto
  if (
    len === 6 &&
    (u8[s] | 32) === 0x6d && // m
    (u8[s + 1] | 32) === 0x61 && // a
    (u8[s + 2] | 32) === 0x69 && // i
    (u8[s + 3] | 32) === 0x6c && // l
    (u8[s + 4] | 32) === 0x74 && // t
    (u8[s + 5] | 32) === 0x6f
  ) {
    // o
    return true;
  }
  return false;
}

const ABSOLUTE_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function defaultUrlAllowlist(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:")
  ) {
    return true;
  }
  return !trimmed.includes("://");
}

export function resolveUrlRelativeToBase(
  url: string,
  baseUrl: string | undefined,
): string {
  if (!baseUrl) {
    return url;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return url;
  }
  if (trimmed.startsWith("//") || ABSOLUTE_PROTOCOL_RE.test(trimmed)) {
    return url;
  }
  try {
    const resolved = new URL(trimmed, baseUrl);
    return resolved.toString();
  } catch {
    return url;
  }
}
