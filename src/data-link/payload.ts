export { encodeBlockSection, decodeBlockSection } from "../parser/block-serializer";

export const DATA_LINK_MAGIC = 0x534d4450; // "SMDP"
export const DATA_LINK_VERSION = 1;

export const FLAG_THEME_DARK = 1 << 0;
export const FLAG_THEME_LIGHT = 1 << 1;

export const THEME_MODE_DARK = 0;
export const THEME_MODE_LIGHT = 1;

export type ThemeMode = "dark" | "light";

export type ThemeSection = {
  mode: ThemeMode;
  data: Uint8Array;
};

export type BinaryPayload = {
  themes: ThemeSection[];
  blockData: Uint8Array;
  markdown: Uint8Array;
};

export function serializeBinaryPayload(payload: BinaryPayload): Uint8Array {
  const writer = new BinaryWriter();
  let flags = 0;
  for (const theme of payload.themes) {
    if (theme.mode === "dark") flags |= FLAG_THEME_DARK;
    if (theme.mode === "light") flags |= FLAG_THEME_LIGHT;
  }

  writer.writeU32(DATA_LINK_MAGIC);
  writer.writeU8(DATA_LINK_VERSION);
  writer.writeU8(flags);
  writer.writeU16(0); // reserved

  for (const theme of payload.themes) {
    writer.writeU8(theme.mode === "dark" ? THEME_MODE_DARK : THEME_MODE_LIGHT);
    writer.writeU32(theme.data.length);
    writer.writeBytes(theme.data);
  }

  writer.writeU32(payload.blockData.length);
  writer.writeBytes(payload.blockData);

  writer.writeU32(payload.markdown.length);
  writer.writeBytes(payload.markdown);

  return writer.finish();
}

export function deserializeBinaryPayload(bytes: Uint8Array): BinaryPayload {
  const reader = new BinaryReader(bytes);
  const magic = reader.readU32();
  if (magic !== DATA_LINK_MAGIC) {
    throw new Error("Invalid structured payload magic value");
  }
  const version = reader.readU8();
  if (version !== DATA_LINK_VERSION) {
    throw new Error(`Unsupported structured payload version: ${version}`);
  }

  const flags = reader.readU8();
  reader.readU16(); // reserved

  const expectedThemeCount =
    (flags & FLAG_THEME_DARK ? 1 : 0) + (flags & FLAG_THEME_LIGHT ? 1 : 0);

  const themes: ThemeSection[] = [];
  for (let index = 0; index < expectedThemeCount; index++) {
    const modeId = reader.readU8();
    const length = reader.readU32();
    const data = reader.readBytes(length);
    const mode = modeId === THEME_MODE_DARK ? "dark" : "light";
    themes.push({ mode, data });
  }

  const blockLength = reader.readU32();
  const blockData = reader.readBytes(blockLength);

  const markdownLength = reader.readU32();
  const markdown = reader.readBytes(markdownLength);

  reader.ensureEOF();

  return { themes, blockData, markdown };
}

class BinaryWriter {
  private readonly bytes: number[] = [];

  writeU8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeU16(value: number): void {
    this.writeU8((value >>> 8) & 0xff);
    this.writeU8(value & 0xff);
  }

  writeU32(value: number): void {
    this.writeU8((value >>> 24) & 0xff);
    this.writeU8((value >>> 16) & 0xff);
    this.writeU8((value >>> 8) & 0xff);
    this.writeU8(value & 0xff);
  }

  writeBytes(data: Uint8Array): void {
    for (const byte of data) {
      this.bytes.push(byte);
    }
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class BinaryReader {
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  readU8(): number {
    this.ensureAvailable(1);
    return this.bytes[this.offset++];
  }

  readU16(): number {
    const hi = this.readU8();
    const lo = this.readU8();
    return (hi << 8) | lo;
  }

  readU32(): number {
    const b1 = this.readU8();
    const b2 = this.readU8();
    const b3 = this.readU8();
    const b4 = this.readU8();
    return ((b1 << 24) | (b2 << 16) | (b3 << 8) | b4) >>> 0;
  }

  readBytes(length: number): Uint8Array {
    this.ensureAvailable(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  ensureEOF(): void {
    if (this.offset !== this.bytes.length) {
      throw new Error("Unexpected trailing data in structured payload");
    }
  }

  private ensureAvailable(length: number): void {
    if (this.offset + length > this.bytes.length) {
      throw new Error("Structured payload is truncated");
    }
  }
}
