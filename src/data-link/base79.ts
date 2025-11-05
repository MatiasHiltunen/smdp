/* 
Base79 experiment is planned to be removed
*/

const URL_SAFE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "abcdefghijklmnopqrstuvwxyz" +
  "0123456789" +
  ".-_" +
  "~" +
  "!$&'()*+,;=:@";

const BASE = URL_SAFE_ALPHABET.length; // 79

const CHAR_TO_VALUE: Int16Array = new Int16Array(128).fill(-1);
for (let i = 0; i < BASE; i++) {
  const ch = URL_SAFE_ALPHABET.charCodeAt(i);
  CHAR_TO_VALUE[ch] = i;
}

/**
 * Encode arbitrary binary data into a URL-safe Base79 string.
 */
export function base79UrlSafeEncode(data: Uint8Array | null | undefined): string {
  if (!data || data.length === 0) {
    return "";
  }

  let leadingZeroCount = 0;
  while (leadingZeroCount < data.length && data[leadingZeroCount] === 0) {
    leadingZeroCount += 1;
  }

  let value = 0n;
  for (const byte of data) {
    value = (value << 8n) | BigInt(byte);
  }

  const encoded: string[] = [];
  while (value > 0n) {
    const remainder = Number(value % BigInt(BASE));
    value /= BigInt(BASE);
    encoded.push(URL_SAFE_ALPHABET[remainder]);
  }

  for (let i = 0; i < leadingZeroCount; i++) {
    encoded.push(URL_SAFE_ALPHABET[0]);
  }

  return encoded.reverse().join("");
}

/**
 * Decode a Base79 string back into a byte array. Returns an empty array for invalid input.
 */
export function base79UrlSafeDecode(encoded: string): Uint8Array {
  if (!encoded) {
    return new Uint8Array(0);
  }

  let leadingZeroCount = 0;
  while (
    leadingZeroCount < encoded.length &&
    encoded.charCodeAt(leadingZeroCount) < CHAR_TO_VALUE.length &&
    CHAR_TO_VALUE[encoded.charCodeAt(leadingZeroCount)] === 0
  ) {
    leadingZeroCount += 1;
  }

  let value = 0n;
  for (let index = leadingZeroCount; index < encoded.length; index++) {
    const chCode = encoded.charCodeAt(index);
    if (chCode >= CHAR_TO_VALUE.length) continue;
    const digit = CHAR_TO_VALUE[chCode];
    if (digit < 0) continue;
    value = value * BigInt(BASE) + BigInt(digit);
  }

  const bytes: number[] = [];
  while (value > 0n) {
    bytes.push(Number(value & 0xffn));
    value >>= 8n;
  }
  bytes.reverse();

  for (let i = 0; i < leadingZeroCount; i++) {
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

/**
 * Compute a non-cryptographic 32-bit FNV-1a hash for integrity checks.
 */
export function fnv1a32(data: Uint8Array): number {
  let hash = 0x811c9dc5;
  const prime = 0x01000193;

  for (const byte of data) {
    hash ^= byte;
    hash = (hash * prime) >>> 0;
  }

  return hash >>> 0;
}

/**
 * Encode data with a checksum to allow verification on decode.
 */
export function base79EncodeWithChecksum(data: Uint8Array): string {
  const checksum = fnv1a32(data);
  const combined = new Uint8Array(data.length + 4);
  combined.set(data, 0);
  combined[data.length] = (checksum >>> 24) & 0xff;
  combined[data.length + 1] = (checksum >>> 16) & 0xff;
  combined[data.length + 2] = (checksum >>> 8) & 0xff;
  combined[data.length + 3] = checksum & 0xff;
  return base79UrlSafeEncode(combined);
}

/**
 * Decode Base79 data produced by {@link base79EncodeWithChecksum}.
 * Returns null when the checksum does not match.
 */
export function base79DecodeWithChecksum(encoded: string): Uint8Array | null {
  const combined = base79UrlSafeDecode(encoded);
  if (combined.length < 4) {
    return null;
  }

  const payloadLength = combined.length - 4;
  const payload = combined.subarray(0, payloadLength);
  const received =
    (combined[payloadLength] << 24) |
    (combined[payloadLength + 1] << 16) |
    (combined[payloadLength + 2] << 8) |
    combined[payloadLength + 3];
  const computed = fnv1a32(payload);
  if ((computed >>> 0) !== (received >>> 0)) {
    return null;
  }
  return payload;
}

export const __private__ = {
  URL_SAFE_ALPHABET,
  BASE,
  CHAR_TO_VALUE,
};
