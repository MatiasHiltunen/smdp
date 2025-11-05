import { blocks } from "./block-parser";
import type { BlockEvent, FenceMeta } from "./types";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeBlockSection(source: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const writer = new BinaryWriter();
  const eventList = Array.from(blocks(source));
  writer.writeU32(eventList.length);
  for (const event of eventList) {
    writeBlockEvent(writer, event);
  }
  return writer.finish();
}

export function decodeBlockSection(bytes: Uint8Array<ArrayBuffer>): BlockEvent[] {
  const reader = new BinaryReader(bytes);
  const count = reader.readU32();
  const events: BlockEvent[] = [];
  for (let index = 0; index < count; index++) {
    events.push(readBlockEvent(reader));
  }
  reader.ensureEOF();
  return events;
}

const enum BlockOpcode {
  BqOpen = 0,
  BqClose = 1,
  Hr = 2,
  Heading = 3,
  ListOpen = 4,
  ListItem = 5,
  ListClose = 6,
  ParaLine = 7,
  CodeOpen = 8,
  CodeText = 9,
  CodeClose = 10,
  TableOpen = 11,
  TableHeader = 12,
  TableRow = 13,
  TableClose = 14,
  InfoOpen = 15,
  InfoClose = 16,
  FootnoteDef = 17,
}

function writeBlockEvent(writer: BinaryWriter, event: BlockEvent): void {
  switch (event.type) {
    case "bqOpen":
      writer.writeU8(BlockOpcode.BqOpen);
      return;
    case "bqClose":
      writer.writeU8(BlockOpcode.BqClose);
      return;
    case "hr":
      writer.writeU8(BlockOpcode.Hr);
      return;
    case "heading":
      writer.writeU8(BlockOpcode.Heading);
      writer.writeU8(event.level);
      writer.writeU32(event.s >>> 0);
      writer.writeU32(event.e >>> 0);
      return;
    case "listOpen":
      writer.writeU8(BlockOpcode.ListOpen);
      writer.writeU8(event.kind === "ul" ? 0 : 1);
      writer.writeU16(event.indent & 0xffff);
      return;
    case "listItem": {
      writer.writeU8(BlockOpcode.ListItem);
      writer.writeU32(event.s >>> 0);
      writer.writeU32(event.e >>> 0);
      let flags = 0;
      if (event.task) flags |= 1 << 0;
      if (event.checked) flags |= 1 << 1;
      writer.writeU8(flags);
      return;
    }
    case "listClose":
      writer.writeU8(BlockOpcode.ListClose);
      writer.writeU8(event.kind === "ul" ? 0 : 1);
      return;
    case "paraLine":
      writer.writeU8(BlockOpcode.ParaLine);
      writer.writeU32(event.s >>> 0);
      writer.writeU32(event.e >>> 0);
      return;
    case "codeOpen":
      writer.writeU8(BlockOpcode.CodeOpen);
      if (event.info) {
        writer.writeU8(1);
        writer.writeString(event.info.infoString);
        writer.writeString(event.info.rawLang ?? "");
        writer.writeString(event.info.meta ?? "");
      } else {
        writer.writeU8(0);
      }
      return;
    case "codeText":
      writer.writeU8(BlockOpcode.CodeText);
      writer.writeU32(event.s >>> 0);
      writer.writeU32(event.e >>> 0);
      return;
    case "codeClose":
      writer.writeU8(BlockOpcode.CodeClose);
      return;
    case "tableOpen":
      writer.writeU8(BlockOpcode.TableOpen);
      return;
    case "tableHeader":
      writer.writeU8(BlockOpcode.TableHeader);
      writer.writeU16(event.cells.length);
      for (const cell of event.cells) {
        writer.writeU8(encodeAlign(cell.align));
        writer.writeU32(cell.s >>> 0);
        writer.writeU32(cell.e >>> 0);
      }
      return;
    case "tableRow":
      writer.writeU8(BlockOpcode.TableRow);
      writer.writeU16(event.cells.length);
      for (const cell of event.cells) {
        writer.writeU32(cell.s >>> 0);
        writer.writeU32(cell.e >>> 0);
      }
      return;
    case "tableClose":
      writer.writeU8(BlockOpcode.TableClose);
      return;
    case "infoOpen":
      writer.writeU8(BlockOpcode.InfoOpen);
      writer.writeU8(encodeInfoType(event.infoType));
      return;
    case "infoClose":
      writer.writeU8(BlockOpcode.InfoClose);
      return;
    case "footnoteDef":
      writer.writeU8(BlockOpcode.FootnoteDef);
      writer.writeU32(event.idS >>> 0);
      writer.writeU32(event.idE >>> 0);
      writer.writeU32(event.contentS >>> 0);
      writer.writeU32(event.contentE >>> 0);
      return;
    default:
      throw new Error(`Unable to serialize block event of type ${(event as { type: string }).type}`);
  }
}

function readBlockEvent(reader: BinaryReader): BlockEvent {
  const opcode = reader.readU8();
  switch (opcode) {
    case BlockOpcode.BqOpen:
      return { type: "bqOpen" };
    case BlockOpcode.BqClose:
      return { type: "bqClose" };
    case BlockOpcode.Hr:
      return { type: "hr" };
    case BlockOpcode.Heading: {
      const level = reader.readU8();
      const s = reader.readU32();
      const e = reader.readU32();
      return { type: "heading", level, s, e };
    }
    case BlockOpcode.ListOpen: {
      const kind = reader.readU8() === 0 ? "ul" : "ol";
      const indent = reader.readU16();
      return { type: "listOpen", kind, indent };
    }
    case BlockOpcode.ListItem: {
      const s = reader.readU32();
      const e = reader.readU32();
      const flags = reader.readU8();
      return {
        type: "listItem",
        s,
        e,
        task: !!(flags & (1 << 0)),
        checked: !!(flags & (1 << 1)),
      };
    }
    case BlockOpcode.ListClose: {
      const kind = reader.readU8() === 0 ? "ul" : "ol";
      return { type: "listClose", kind };
    }
    case BlockOpcode.ParaLine: {
      const s = reader.readU32();
      const e = reader.readU32();
      return { type: "paraLine", s, e };
    }
    case BlockOpcode.CodeOpen: {
      const hasInfo = reader.readU8() === 1;
      if (!hasInfo) {
        return { type: "codeOpen" };
      }
      const infoString = reader.readString();
      const rawLang = reader.readString();
      const meta = reader.readString();
      const info = {
        infoString,
        rawLang: rawLang || undefined,
        lang: rawLang ? rawLang.toLowerCase() : undefined,
        meta: meta || undefined,
      };
      return { type: "codeOpen", info: info as FenceMeta };
    }
    case BlockOpcode.CodeText: {
      const s = reader.readU32();
      const e = reader.readU32();
      return { type: "codeText", s, e };
    }
    case BlockOpcode.CodeClose:
      return { type: "codeClose" };
    case BlockOpcode.TableOpen:
      return { type: "tableOpen" };
    case BlockOpcode.TableHeader: {
      const count = reader.readU16();
      const cells: Array<{ s: number; e: number; align: "left" | "center" | "right" }> = [];
      for (let i = 0; i < count; i++) {
        const align = decodeAlign(reader.readU8());
        const s = reader.readU32();
        const e = reader.readU32();
        cells.push({ s, e, align });
      }
      return { type: "tableHeader", cells };
    }
    case BlockOpcode.TableRow: {
      const count = reader.readU16();
      const cells: Array<{ s: number; e: number }> = [];
      for (let i = 0; i < count; i++) {
        const s = reader.readU32();
        const e = reader.readU32();
        cells.push({ s, e });
      }
      return { type: "tableRow", cells };
    }
    case BlockOpcode.TableClose:
      return { type: "tableClose" };
    case BlockOpcode.InfoOpen: {
      const infoType = decodeInfoType(reader.readU8());
      return { type: "infoOpen", infoType };
    }
    case BlockOpcode.InfoClose:
      return { type: "infoClose" };
    case BlockOpcode.FootnoteDef: {
      const idS = reader.readU32();
      const idE = reader.readU32();
      const contentS = reader.readU32();
      const contentE = reader.readU32();
      return { type: "footnoteDef", idS, idE, contentS, contentE };
    }
    default:
      throw new Error(`Unknown block opcode: ${opcode}`);
  }
}

function encodeAlign(align: "left" | "center" | "right"): number {
  switch (align) {
    case "left":
      return 0;
    case "center":
      return 1;
    case "right":
      return 2;
    default:
      return 0;
  }
}

function decodeAlign(code: number): "left" | "center" | "right" {
  switch (code) {
    case 0:
      return "left";
    case 1:
      return "center";
    case 2:
      return "right";
    default:
      return "left";
  }
}

function encodeInfoType(infoType: "info" | "warning" | "error" | "success"): number {
  switch (infoType) {
    case "info":
      return 0;
    case "warning":
      return 1;
    case "error":
      return 2;
    case "success":
      return 3;
    default:
      return 0;
  }
}

function decodeInfoType(code: number): "info" | "warning" | "error" | "success" {
  switch (code) {
    case 0:
      return "info";
    case 1:
      return "warning";
    case 2:
      return "error";
    case 3:
      return "success";
    default:
      return "info";
  }
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

  writeBytes(data: Uint8Array<ArrayBuffer>): void {
    for (const byte of data) {
      this.bytes.push(byte);
    }
  }

  writeString(value: string): void {
    const encoded = textEncoder.encode(value);
    this.writeU32(encoded.length);
    this.writeBytes(encoded);
  }

  finish(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.bytes);
  }
}

class BinaryReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array<ArrayBuffer>) {}

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

  readBytes(length: number): Uint8Array<ArrayBuffer> {
    this.ensureAvailable(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  readString(): string {
    const length = this.readU32();
    const slice = this.readBytes(length);
    return textDecoder.decode(slice);
  }

  ensureEOF(): void {
    if (this.offset !== this.bytes.length) {
      throw new Error("Unexpected trailing data in serialized block section");
    }
  }

  private ensureAvailable(length: number): void {
    if (this.offset + length > this.bytes.length) {
      throw new Error("Serialized block section is truncated");
    }
  }
}
