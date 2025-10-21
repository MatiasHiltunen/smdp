/**
 * Shared character classification utilities optimised for byte-oriented parsing.
 */

export type CharRange = ReadonlyArray<readonly [number, number]>;

/**
 * Build a compact bitset describing a list of inclusive character ranges.
 * Returns a 256-bit (32-byte) array suitable for ASCII lookups.
 */
export function createBitset(
  ranges?: CharRange | null,
  fallback?: CharRange | null,
): Uint8Array {
  const bits = new Uint8Array(32); // 256 bits
  const apply = (lo: number, hi: number): void => {
    const start = Math.max(0, lo);
    const end = Math.min(255, hi);
    for (let value = start; value <= end; value++) {
      bits[value >>> 3] |= 1 << (value & 7);
    }
  };

  const source = ranges && ranges.length ? ranges : fallback;
  if (source) {
    for (const [lo, hi] of source) apply(lo, hi);
  }

  return bits;
}

export function bitsetHas(bits: Uint8Array, value: number): boolean {
  if (value < 0 || value > 255) return false;
  return (bits[value >>> 3] & (1 << (value & 7))) !== 0;
}

export function toLowerAscii(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code | 0x20 : code;
}

export function isAsciiSpace(code: number): boolean {
  return code === 0x20 || code === 0x09;
}

export function isAsciiWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x0b || code === 0x0c || code === 0x20;
}

export function isAsciiLineBreak(code: number): boolean {
  return code === 0x0a || code === 0x0d;
}

export function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

export function isAsciiHexDigit(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

export function isAsciiAlpha(code: number): boolean {
  const lowered = code | 0x20;
  return lowered >= 0x61 && lowered <= 0x7a;
}

export function isAsciiAlphaNumeric(code: number): boolean {
  return isAsciiAlpha(code) || isAsciiDigit(code);
}

export function bytesMatch(
  buffer: Uint8Array,
  position: number,
  needle: Uint8Array,
): boolean {
  if (position < 0 || position + needle.length > buffer.length) return false;
  for (let i = 0; i < needle.length; i++) {
    if (buffer[position + i] !== needle[i]) return false;
  }
  return true;
}
