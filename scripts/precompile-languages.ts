#!/usr/bin/env tsx
/**
 * Precompiles language specs to a single binary format
 * Uses an arena-style allocator to pack all data into one Uint8Array
 * Runtime can read directly with subarray() for zero-copy performance
 */

import { builtinLanguageSpecs } from '../src/highlight/builtins';
import type { AuthorLanguageSpec } from '../src/highlight/language-core';


const TE = new TextEncoder();


/**
 * Binary format:
 * - All strings are UTF-8 encoded
 * - Format uses 32-bit integers for lengths and offsets
 * 
 * Overall structure:
 * [languageCount: u32][language1][language2]...
 * 
 * Each language:
 * [nameLen: u32][nameBytes][aliasCount: u32][alias1Len: u32][alias1Bytes]...
 * [keywordCount: u32][kw1Len: u32][kw1Bytes][kw1Code: u32]...
 * [lineCommentCount: u32][lc1Len: u32][lc1Bytes]...
 * [blockCommentCount: u32][bc1OpenLen: u32][bc1OpenBytes][bc1CloseLen: u32][bc1CloseBytes]...
 * [stringCount: u32][str1StartLen: u32][str1StartBytes][str1EndLen: u32][str1EndBytes][str1Escape: i32][str1AllowMultiline: u8]...
 * [numbersFlags: u32][regexEnabled: u8]
 * [hasTemplate: u8][templateStart: u8][templateInterpOpenLen: u32][templateInterpOpenBytes][templateInterpClose: u8]
 */

class BinaryWriter {
  private chunks: Uint8Array[] = [];
  private totalSize = 0;

  writeU32(value: number): void {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value, true); // little-endian
    this.chunks.push(buf);
    this.totalSize += 4;
  }

  writeI32(value: number): void {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setInt32(0, value, true);
    this.chunks.push(buf);
    this.totalSize += 4;
  }

  writeU8(value: number): void {
    const buf = new Uint8Array(1);
    buf[0] = value;
    this.chunks.push(buf);
    this.totalSize += 1;
  }

  writeBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.totalSize += bytes.length;
  }

  writeString(str: string): void {
    const bytes = TE.encode(str);
    this.writeU32(bytes.length);
    this.writeBytes(bytes);
  }

  toUint8Array(): Uint8Array {
    const result = new Uint8Array(this.totalSize);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

function writeLanguage(writer: BinaryWriter, spec: AuthorLanguageSpec): void {
  // Write name
  writer.writeString(spec.name);

  // Write aliases
  const aliases = spec.aliases ?? [spec.name];
  writer.writeU32(aliases.length);
  for (const alias of aliases) {
    writer.writeString(alias);
  }

  // Write keywords
  const keywords = spec.keywords ?? [];
  writer.writeU32(keywords.length);
  for (const kw of keywords) {
    const kwBytes = TE.encode(kw.word.toLowerCase());
    writer.writeU32(kwBytes.length);
    writer.writeBytes(kwBytes);
    writer.writeU32(kw.code ?? 0);
  }

  // Write line comments
  const lineComments = spec.lineComments ?? [];
  writer.writeU32(lineComments.length);
  for (const lc of lineComments) {
    const bytes = TE.encode(lc);
    writer.writeU32(bytes.length);
    writer.writeBytes(bytes);
  }

  // Write block comments
  const blockComments = spec.blockComments ?? [];
  writer.writeU32(blockComments.length);
  for (const [open, close] of blockComments) {
    const openBytes = TE.encode(open);
    const closeBytes = TE.encode(close);
    writer.writeU32(openBytes.length);
    writer.writeBytes(openBytes);
    writer.writeU32(closeBytes.length);
    writer.writeBytes(closeBytes);
  }

  // Write strings
  const strings = spec.strings ?? [
    { quote: "'", escape: '\\' },
    { quote: '"', escape: '\\' },
  ];
  writer.writeU32(strings.length);
  for (const str of strings) {
    const startBytes = TE.encode(str.quote);
    const endBytes = TE.encode(str.quote);
    writer.writeU32(startBytes.length);
    writer.writeBytes(startBytes);
    writer.writeU32(endBytes.length);
    writer.writeBytes(endBytes);
    writer.writeI32(str.escape ? str.escape.charCodeAt(0) : -1);
    writer.writeU8(str.allowMultiline ? 1 : 0);
  }

  // Write numbers flags
  const nums = spec.numbers ?? {};
  let numbersFlags = 0;
  if (nums.allowHex) numbersFlags |= 1 << 0;
  if (nums.allowBin) numbersFlags |= 1 << 1;
  if (nums.allowOct) numbersFlags |= 1 << 2;
  if (nums.allowUnderscore) numbersFlags |= 1 << 3;
  if (nums.allowBigInt) numbersFlags |= 1 << 4;
  if (nums.allowExp !== false) numbersFlags |= 1 << 5; // default true
  if (nums.allowLeadingDot) numbersFlags |= 1 << 6;
  writer.writeU32(numbersFlags);

  // Write regex enabled
  writer.writeU8(spec.regex?.enabled ? 1 : 0);

  // Write template
  if (spec.templates?.enabled) {
    writer.writeU8(1); // hasTemplate
    const quote = (spec.templates.quote ?? '`').charCodeAt(0);
    writer.writeU8(quote);
    const interpOpen = TE.encode(spec.templates.interpOpen ?? '${');
    writer.writeU32(interpOpen.length);
    writer.writeBytes(interpOpen);
    const interpClose = (spec.templates.interpClose ?? '}').charCodeAt(0);
    writer.writeU8(interpClose);
  } else {
    writer.writeU8(0); // no template
  }
}

function generatePrecompiledFile() {
  console.log('Precompiling language specs to binary format...');

  const allSpecs = builtinLanguageSpecs;
  
  const writer = new BinaryWriter();
  writer.writeU32(allSpecs.length);
  
  for (const spec of allSpecs) {
    console.log(`  - ${spec.name}`);
    writeLanguage(writer, spec);
  }

  const binaryData = writer.toUint8Array();
  const base64 = Buffer.from(binaryData).toString('base64');

  // Also precompile span bytes
  const spanWriter = new BinaryWriter();
  const spans = {
    kw: '<span class="tok-kw">',
    id: '<span class="tok-id">',
    num: '<span class="tok-num">',
    str: '<span class="tok-str">',
    tpl: '<span class="tok-tpl">',
    com: '<span class="tok-com">',
    rx: '<span class="tok-rx">',
    op: '<span class="tok-op">',
    p: '<span class="tok-p">',
    close: '</span>',
  };

  // Write spans as: [count][len1][bytes1][len2][bytes2]...
  spanWriter.writeU32(Object.keys(spans).length);
  for (const [key, value] of Object.entries(spans)) {
    const bytes = TE.encode(value);
    spanWriter.writeU32(bytes.length);
    spanWriter.writeBytes(bytes);
  }
  const spanBinary = spanWriter.toUint8Array();
  const spanBase64 = Buffer.from(spanBinary).toString('base64');

  const output = `/**
 * AUTO-GENERATED FILE - DO NOT EDIT
 * Generated by scripts/precompile-languages.ts
 * 
 * Precompiled language specs in single binary format
 * Uses arena-style reading with subarray() for zero-copy performance
 */

// Single binary blob containing all language specs
export const LANGUAGE_BINARY = "${base64}";

// Span HTML bytes for syntax highlighting
export const SPAN_BINARY = "${spanBase64}";

/**
 * Decode base64 string to Uint8Array
 * Uses atob() as fallback
 */
export function fromBase64(base64: string): Uint8Array {

  // @ts-ignore
  if(typeof window !== 'undefined' && window?.Uint8Array?.fromBase64) {
    console.log('Using browser Uint8Array.fromBase64');
    // @ts-ignore   
    return window.Uint8Array.fromBase64(base64);
  } else {
    
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
}
`;

  return output;
}

// Generate and write the file
const output = generatePrecompiledFile();
const fs = await import('fs');
const path = await import('path');

const outputPath = path.join(process.cwd(), 'src/highlight/precompiled.ts');
fs.writeFileSync(outputPath, output, 'utf-8');

console.log(`✓ Precompiled language specs written to ${outputPath}`);
console.log(`  File size: ${(output.length / 1024).toFixed(2)} KB`);
