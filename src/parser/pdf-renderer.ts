import { blocks } from './block-parser';
import { inlineTokens } from './inline-parser';
import { FONT_SIZE, INDENT, TD, TE } from './constants';
import type { InlineToken } from './types';
import type { ParserOptions } from './index';
import { defaultUrlAllowlist, resolveUrlRelativeToBase } from './utils';

export type PdfPageSize =
  | 'letter'
  | 'a4'
  | {
      width: number;
      height: number;
    };

export interface PdfRenderOptions extends ParserOptions {
  pageSize?: PdfPageSize;
  margin?: number;
  fontSize?: number;
  lineHeight?: number;
  imageResolver?: PdfImageResolver;
  maxImageWidth?: number;
  maxImageHeight?: number;
}

export type PdfImageResolverContext = {
  src: string;
  resolvedSrc: string;
  altText: string;
  baseUrl?: string;
};

export type PdfResolvedImage = {
  bytes: Uint8Array;
  mediaType?: string;
  cacheKey?: string;
};

export type PdfImageResolver = (
  resolvedSrc: string,
  context: PdfImageResolverContext,
) => PdfResolvedImage | null | Promise<PdfResolvedImage | null>;

type PdfColor = readonly [number, number, number];

type PdfFont =
  | 'regular'
  | 'bold'
  | 'italic'
  | 'boldItalic'
  | 'mono';

type PdfTextStyle = {
  font: PdfFont;
  size: number;
  color: PdfColor;
  underline?: boolean;
  strike?: boolean;
};

type PdfTextRun = {
  bytes: Uint8Array;
  s: number;
  e: number;
  style: PdfTextStyle;
  width: number;
};

type PdfImageToken = Extract<InlineToken, { kind: 'img' }>;

type PdfInlineImageRenderer = (
  token: PdfImageToken,
  line: PdfLineComposer,
  style: PdfTextStyle,
) => boolean;

type PdfInlineImageRendererAsync = (
  token: PdfImageToken,
  line: PdfLineComposer,
  style: PdfTextStyle,
) => Promise<boolean>;

type PdfPage = {
  content: PdfByteWriter;
};

type PdfImageData = {
  chunks: Uint8Array[];
  length: number;
};

type PdfEmbeddedImage = {
  name: string;
  width: number;
  height: number;
  colorSpace: string;
  bitsPerComponent: number;
  filter: 'DCTDecode' | 'FlateDecode';
  data: PdfImageData;
  decodeParms?: string;
};

type ListFrame = {
  kind: 'ul' | 'ol';
  counter: number;
};

const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
} as const;

const COLORS = {
  text: [0.08, 0.1, 0.12] as const,
  muted: [0.38, 0.42, 0.48] as const,
  accent: [0.03, 0.35, 0.7] as const,
  rule: [0.72, 0.75, 0.8] as const,
  codeBg: [0.94, 0.95, 0.97] as const,
  quote: [0.18, 0.34, 0.6] as const,
} as const;

const FONT_IDS: Record<PdfFont, string> = {
  regular: 'F1',
  bold: 'F2',
  italic: 'F3',
  boldItalic: 'F4',
  mono: 'F5',
};

const FONT_OBJECTS: Array<{ id: PdfFont; baseFont: string }> = [
  { id: 'regular', baseFont: 'Helvetica' },
  { id: 'bold', baseFont: 'Helvetica-Bold' },
  { id: 'italic', baseFont: 'Helvetica-Oblique' },
  { id: 'boldItalic', baseFont: 'Helvetica-BoldOblique' },
  { id: 'mono', baseFont: 'Courier' },
];

const HEX = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).toUpperCase().padStart(2, '0'),
);

const SPACE = TE.encode(' ');

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function colorCommand(color: PdfColor, operator: 'rg' | 'RG'): string {
  return `${formatNumber(color[0])} ${formatNumber(color[1])} ${formatNumber(color[2])} ${operator}`;
}

function resolvePageSize(pageSize: PdfPageSize | undefined): { width: number; height: number } {
  if (!pageSize) return PAGE_SIZES.letter;
  if (pageSize === 'letter' || pageSize === 'a4') return PAGE_SIZES[pageSize];
  return {
    width: Math.max(240, pageSize.width),
    height: Math.max(240, pageSize.height),
  };
}

function cloneStyle(style: PdfTextStyle): PdfTextStyle {
  return {
    font: style.font,
    size: style.size,
    color: style.color,
    ...(style.underline ? { underline: true } : {}),
    ...(style.strike ? { strike: true } : {}),
  };
}

function mergeStyle(style: PdfTextStyle, patch: Partial<PdfTextStyle>): PdfTextStyle {
  return {
    ...cloneStyle(style),
    ...patch,
  };
}

function isAsciiWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function nextUtf8Index(bytes: Uint8Array, index: number, end: number): number {
  const byte = bytes[index];
  if (byte < 0x80) return index + 1;
  if ((byte & 0xe0) === 0xc0) return Math.min(index + 2, end);
  if ((byte & 0xf0) === 0xe0) return Math.min(index + 3, end);
  if ((byte & 0xf8) === 0xf0) return Math.min(index + 4, end);
  return index + 1;
}

function readUtf8CodePoint(
  bytes: Uint8Array,
  index: number,
  end: number,
): { codePoint: number; next: number } {
  const first = bytes[index];
  if (first < 0x80) return { codePoint: first, next: index + 1 };

  if ((first & 0xe0) === 0xc0 && index + 1 < end) {
    const b1 = bytes[index + 1];
    if ((b1 & 0xc0) === 0x80) {
      return { codePoint: ((first & 0x1f) << 6) | (b1 & 0x3f), next: index + 2 };
    }
  }

  if ((first & 0xf0) === 0xe0 && index + 2 < end) {
    const b1 = bytes[index + 1];
    const b2 = bytes[index + 2];
    if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
      return {
        codePoint: ((first & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f),
        next: index + 3,
      };
    }
  }

  if ((first & 0xf8) === 0xf0 && index + 3 < end) {
    const b1 = bytes[index + 1];
    const b2 = bytes[index + 2];
    const b3 = bytes[index + 3];
    if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80 && (b3 & 0xc0) === 0x80) {
      return {
        codePoint:
          ((first & 0x07) << 18) |
          ((b1 & 0x3f) << 12) |
          ((b2 & 0x3f) << 6) |
          (b3 & 0x3f),
        next: index + 4,
      };
    }
  }

  return { codePoint: 0x3f, next: index + 1 };
}

function mapWinAnsi(codePoint: number): number {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return codePoint;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint;

  switch (codePoint) {
    case 0x2013:
      return 0x96;
    case 0x2014:
      return 0x97;
    case 0x2018:
      return 0x91;
    case 0x2019:
      return 0x92;
    case 0x201c:
      return 0x93;
    case 0x201d:
      return 0x94;
    case 0x2022:
      return 0x95;
    case 0x2026:
      return 0x85;
    case 0x20ac:
      return 0x80;
    default:
      return 0x3f;
  }
}

function asciiWidth(byte: number, font: PdfFont): number {
  if (byte === 0x20) return font === 'mono' ? 0.6 : 0.28;
  if (font === 'mono') return 0.6;
  if (byte >= 0x30 && byte <= 0x39) return 0.56;
  if (byte >= 0x41 && byte <= 0x5a) return 0.64;
  if (byte >= 0x61 && byte <= 0x7a) {
    if (byte === 0x69 || byte === 0x6c) return 0.25;
    if (byte === 0x6d || byte === 0x77) return 0.78;
    return 0.5;
  }
  if (byte === 0x2e || byte === 0x2c || byte === 0x3a || byte === 0x3b) return 0.26;
  if (byte === 0x2d) return 0.33;
  if (byte === 0x28 || byte === 0x29 || byte === 0x5b || byte === 0x5d) return 0.32;
  return 0.5;
}

function measureTextSpan(bytes: Uint8Array, s: number, e: number, style: PdfTextStyle): number {
  let width = 0;
  let i = s;
  while (i < e) {
    const byte = bytes[i];
    if (byte < 0x80) {
      width += asciiWidth(isAsciiWhitespace(byte) ? 0x20 : byte, style.font);
      i++;
    } else {
      width += style.font === 'mono' ? 0.6 : 0.56;
      i = nextUtf8Index(bytes, i, e);
    }
  }
  const boldFactor = style.font === 'bold' || style.font === 'boldItalic' ? 1.04 : 1;
  return width * style.size * boldFactor;
}

function writePdfTextHex(out: PdfByteWriter, bytes: Uint8Array, s: number, e: number): void {
  let hex = '';
  let i = s;
  while (i < e) {
    const byte = bytes[i];
    if (byte < 0x80) {
      const mapped = byte < 0x20 ? (isAsciiWhitespace(byte) ? 0x20 : 0x3f) : byte;
      hex += HEX[mapped];
      i++;
      continue;
    }

    const decoded = readUtf8CodePoint(bytes, i, e);
    hex += HEX[mapWinAnsi(decoded.codePoint)];
    i = decoded.next;
  }
  out.writeAscii(hex);
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] * 0x1000000) +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function bytesEqual(bytes: Uint8Array, offset: number, values: readonly number[]): boolean {
  if (offset + values.length > bytes.length) return false;
  for (let index = 0; index < values.length; index++) {
    if (bytes[offset + index] !== values[index]) return false;
  }
  return true;
}

function asciiChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function imageDataFromChunks(chunks: Uint8Array[]): PdfImageData {
  let length = 0;
  for (const chunk of chunks) {
    length += chunk.length;
  }
  return { chunks, length };
}

function parseJpegImage(bytes: Uint8Array): Omit<PdfEmbeddedImage, 'name'> | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return null;

    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return null;

    const segmentLength = readUint16(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame) {
      if (segmentLength < 8) return null;
      const bitsPerComponent = bytes[offset + 2];
      const height = readUint16(bytes, offset + 3);
      const width = readUint16(bytes, offset + 5);
      const components = bytes[offset + 7];
      const colorSpace =
        components === 1 ? '/DeviceGray' :
        components === 3 ? '/DeviceRGB' :
        components === 4 ? '/DeviceCMYK' :
        null;
      if (!colorSpace || width <= 0 || height <= 0 || bitsPerComponent <= 0) {
        return null;
      }
      return {
        width,
        height,
        colorSpace,
        bitsPerComponent,
        filter: 'DCTDecode',
        data: imageDataFromChunks([bytes]),
      };
    }

    offset += segmentLength;
  }

  return null;
}

function parsePngImage(bytes: Uint8Array): Omit<PdfEmbeddedImage, 'name'> | null {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
  if (!bytesEqual(bytes, 0, pngSignature)) {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  const idatChunks: Uint8Array[] = [];

  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + length + 4;
    if (length < 0 || nextOffset > bytes.length) return null;

    const type = asciiChunkType(bytes, typeOffset);
    if (type === 'IHDR') {
      if (length !== 13) return null;
      width = readUint32(bytes, dataOffset);
      height = readUint32(bytes, dataOffset + 4);
      bitDepth = bytes[dataOffset + 8];
      colorType = bytes[dataOffset + 9];
      const compression = bytes[dataOffset + 10];
      const filter = bytes[dataOffset + 11];
      interlace = bytes[dataOffset + 12];
      if (compression !== 0 || filter !== 0) return null;
    } else if (type === 'PLTE') {
      palette = bytes.subarray(dataOffset, dataOffset + length);
    } else if (type === 'IDAT') {
      idatChunks.push(bytes.subarray(dataOffset, dataOffset + length));
    } else if (type === 'IEND') {
      break;
    }

    offset = nextOffset;
  }

  if (width <= 0 || height <= 0 || idatChunks.length === 0 || interlace !== 0) {
    return null;
  }

  if (![1, 2, 4, 8].includes(bitDepth)) {
    return null;
  }

  let colorSpace: string | null = null;
  let colors = 1;
  if (colorType === 0) {
    colorSpace = '/DeviceGray';
    colors = 1;
  } else if (colorType === 2) {
    colorSpace = '/DeviceRGB';
    colors = 3;
  } else if (colorType === 3 && palette && palette.length >= 3 && palette.length % 3 === 0) {
    const maxIndex = Math.min(255, Math.floor(palette.length / 3) - 1);
    let paletteHex = '';
    for (const byte of palette) paletteHex += HEX[byte];
    colorSpace = `[/Indexed /DeviceRGB ${maxIndex} <${paletteHex}>]`;
    colors = 1;
  }

  if (!colorSpace) {
    return null;
  }

  return {
    width,
    height,
    colorSpace,
    bitsPerComponent: bitDepth,
    filter: 'FlateDecode',
    data: imageDataFromChunks(idatChunks),
    decodeParms: `<< /Predictor 15 /Colors ${colors} /BitsPerComponent ${bitDepth} /Columns ${width} >>`,
  };
}

function parsePdfImage(bytes: Uint8Array, mediaType: string | undefined): Omit<PdfEmbeddedImage, 'name'> | null {
  const normalizedType = mediaType?.toLowerCase().split(';', 1)[0]?.trim();
  if (normalizedType === 'image/jpeg' || normalizedType === 'image/jpg') {
    return parseJpegImage(bytes);
  }
  if (normalizedType === 'image/png') {
    return parsePngImage(bytes);
  }
  return parseJpegImage(bytes) ?? parsePngImage(bytes);
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value;
}

class PdfByteWriter {
  private readonly chunks: Uint8Array[] = [];
  length = 0;

  writeAscii(value: string): void {
    if (!value) return;
    const bytes = TE.encode(value);
    this.writeBytes(bytes);
  }

  writeBytes(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  writeWriter(writer: PdfByteWriter): void {
    for (const chunk of writer.chunks) {
      this.writeBytes(chunk);
    }
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

class PdfLineComposer {
  private readonly line: PdfTextRun[] = [];
  private lineWidth = 0;
  private readonly renderer: PdfBlockRenderer;
  private readonly x: number;
  private readonly maxWidth: number;
  private readonly lineHeight: number;

  constructor(
    renderer: PdfBlockRenderer,
    x: number,
    maxWidth: number,
    lineHeight: number,
  ) {
    this.renderer = renderer;
    this.x = x;
    this.maxWidth = maxWidth;
    this.lineHeight = lineHeight;
  }

  addGenerated(text: string, style: PdfTextStyle): void {
    const bytes = TE.encode(text);
    this.addTextSpan(bytes, 0, bytes.length, style);
  }

  addSpace(style: PdfTextStyle): void {
    if (this.lineWidth === 0) return;
    const width = measureTextSpan(SPACE, 0, SPACE.length, style);
    if (this.lineWidth + width > this.maxWidth) {
      this.flush();
      return;
    }
    this.line.push({
      bytes: SPACE,
      s: 0,
      e: SPACE.length,
      style: cloneStyle(style),
      width,
    });
    this.lineWidth += width;
  }

  addTextSpan(
    bytes: Uint8Array,
    s: number,
    e: number,
    style: PdfTextStyle,
    preserveWhitespace = false,
  ): void {
    if (s >= e) return;

    if (preserveWhitespace) {
      this.addSegment(bytes, s, e, style);
      return;
    }

    let i = s;
    while (i < e) {
      if (isAsciiWhitespace(bytes[i])) {
        while (i < e && isAsciiWhitespace(bytes[i])) i++;
        this.addSpace(style);
        continue;
      }

      const start = i;
      while (i < e && !isAsciiWhitespace(bytes[i])) {
        i = nextUtf8Index(bytes, i, e);
      }
      this.addSegment(bytes, start, i, style);
    }
  }

  flush(): void {
    if (this.line.length === 0) return;
    this.renderer.drawTextLine(this.line, this.x, this.lineHeight);
    this.line.length = 0;
    this.lineWidth = 0;
  }

  private addSegment(bytes: Uint8Array, s: number, e: number, style: PdfTextStyle): void {
    if (s >= e) return;
    const width = measureTextSpan(bytes, s, e, style);
    if (this.lineWidth > 0 && this.lineWidth + width > this.maxWidth) {
      this.flush();
    }

    if (width > this.maxWidth) {
      this.addLongSegment(bytes, s, e, style);
      return;
    }

    this.line.push({
      bytes,
      s,
      e,
      style: cloneStyle(style),
      width,
    });
    this.lineWidth += width;
  }

  private addLongSegment(bytes: Uint8Array, s: number, e: number, style: PdfTextStyle): void {
    let i = s;
    while (i < e) {
      const next = nextUtf8Index(bytes, i, e);
      const width = measureTextSpan(bytes, i, next, style);
      if (this.lineWidth > 0 && this.lineWidth + width > this.maxWidth) {
        this.flush();
      }
      this.line.push({
        bytes,
        s: i,
        e: next,
        style: cloneStyle(style),
        width,
      });
      this.lineWidth += width;
      i = next;
    }
  }
}

class PdfBlockRenderer {
  readonly pages: PdfPage[] = [];
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private readonly margin: number;
  private readonly baseFontSize: number;
  private readonly lineHeightMultiplier: number;
  private readonly contentWidth: number;
  private readonly urlAllowlist: (url: string) => boolean;
  private readonly baseUrl: string | undefined;
  private currentPage: PdfPage;
  private cursorY = 0;
  private indent = 0;
  private para: PdfLineComposer | null = null;
  private inCode = false;
  private listStack: ListFrame[] = [];
  private infoStackDepth = 0;
  private readonly options: PdfRenderOptions;
  private readonly images: PdfEmbeddedImage[] = [];
  private readonly imageByKey = new Map<string, PdfEmbeddedImage>();
  private readonly imagePromises = new Map<string, Promise<PdfEmbeddedImage | null>>();

  constructor(options: PdfRenderOptions) {
    this.options = options;
    const page = resolvePageSize(options.pageSize);
    this.pageWidth = page.width;
    this.pageHeight = page.height;
    this.margin = Math.max(24, options.margin ?? 54);
    this.baseFontSize = Math.max(8, options.fontSize ?? FONT_SIZE.base);
    this.lineHeightMultiplier = Math.max(1.1, options.lineHeight ?? 1.35);
    this.contentWidth = Math.max(120, this.pageWidth - this.margin * 2);
    this.urlAllowlist = options.urlAllowlist ?? defaultUrlAllowlist;
    this.baseUrl = options.baseUrl;
    this.currentPage = this.createPage();
  }

  render(markdown: Uint8Array): Uint8Array {
    const blockParseOptions = this.options.allowRawHtml ? { allowRawHtml: true } : undefined;
    const imageRenderer: PdfInlineImageRenderer = (token, line, style) =>
      this.renderInlineImageSync(markdown, token, line, style);

    for (const ev of blocks(markdown, blockParseOptions)) {
      switch (ev.type) {
        case 'bqOpen':
          this.closeParagraph();
          this.addVerticalSpace(this.baseFontSize * 0.35);
          this.indent += INDENT;
          break;

        case 'bqClose':
          this.closeParagraph();
          this.indent = Math.max(0, this.indent - INDENT);
          this.addVerticalSpace(this.baseFontSize * 0.6);
          break;

        case 'hr':
          this.closeParagraph();
          this.drawRule();
          break;

        case 'heading': {
          this.closeParagraph();
          const size = this.headingSize(ev.level);
          this.addVerticalSpace(size * 0.35);
          const style = this.style({ font: 'bold', size });
          const line = this.createLine(size * this.lineHeightMultiplier);
          renderInlineRange(markdown, ev.s, ev.e, line, style, this.options, this.urlAllowlist, this.baseUrl, imageRenderer);
          line.flush();
          this.addVerticalSpace(size * 0.2);
          break;
        }

        case 'listOpen':
          this.closeParagraph();
          this.listStack.push({ kind: ev.kind, counter: 1 });
          this.indent += INDENT;
          break;

        case 'listItem':
          this.closeParagraph();
          this.renderListItem(markdown, ev);
          break;

        case 'listClose':
          this.closeParagraph();
          this.listStack.pop();
          this.indent = Math.max(0, this.indent - INDENT);
          this.addVerticalSpace(this.baseFontSize * 0.2);
          break;

        case 'paraLine':
          const para = this.ensureParagraph();
          renderInlineRange(
            markdown,
            ev.s,
            ev.e,
            para,
            this.style(),
            this.options,
            this.urlAllowlist,
            this.baseUrl,
            imageRenderer,
          );
          para.addSpace(this.style());
          break;

        case 'rawHtmlLine':
          this.closeParagraph();
          this.renderRawLine(markdown, ev.s, ev.e);
          break;

        case 'codeOpen':
          this.closeParagraph();
          this.inCode = true;
          this.addVerticalSpace(this.baseFontSize * 0.4);
          break;

        case 'codeText':
          if (this.inCode) {
            this.renderCodeLine(markdown, ev.s, ev.e);
          }
          break;

        case 'codeClose':
          if (this.inCode) {
            this.inCode = false;
            this.addVerticalSpace(this.baseFontSize * 0.6);
          }
          break;

        case 'tableOpen':
          this.closeParagraph();
          this.addVerticalSpace(this.baseFontSize * 0.4);
          break;

        case 'tableHeader':
          this.renderTableCells(markdown, ev.cells, true);
          break;

        case 'tableRow':
          this.renderTableCells(markdown, ev.cells, false);
          break;

        case 'tableClose':
          this.addVerticalSpace(this.baseFontSize * 0.6);
          break;

        case 'infoOpen':
          this.closeParagraph();
          this.infoStackDepth++;
          this.renderInfoLabel(ev.infoType.toUpperCase());
          this.indent += INDENT;
          break;

        case 'infoClose':
          this.closeParagraph();
          if (this.infoStackDepth > 0) this.infoStackDepth--;
          this.indent = Math.max(0, this.indent - INDENT);
          this.addVerticalSpace(this.baseFontSize * 0.45);
          break;

        case 'footnoteDef':
          this.closeParagraph();
          this.renderFootnote(markdown, ev.idS, ev.idE, ev.contentS, ev.contentE);
          break;
      }
    }

    this.closeParagraph();
    return buildPdfFile(this.pages, this.pageWidth, this.pageHeight, this.images);
  }

  async renderAsync(markdown: Uint8Array): Promise<Uint8Array> {
    const blockParseOptions = this.options.allowRawHtml ? { allowRawHtml: true } : undefined;
    const imageRenderer: PdfInlineImageRendererAsync = async (token, line, style) =>
      await this.renderInlineImageAsync(markdown, token, line, style);

    for (const ev of blocks(markdown, blockParseOptions)) {
      switch (ev.type) {
        case 'bqOpen':
          this.closeParagraph();
          this.addVerticalSpace(this.baseFontSize * 0.35);
          this.indent += INDENT;
          break;

        case 'bqClose':
          this.closeParagraph();
          this.indent = Math.max(0, this.indent - INDENT);
          this.addVerticalSpace(this.baseFontSize * 0.6);
          break;

        case 'hr':
          this.closeParagraph();
          this.drawRule();
          break;

        case 'heading': {
          this.closeParagraph();
          const size = this.headingSize(ev.level);
          this.addVerticalSpace(size * 0.35);
          const style = this.style({ font: 'bold', size });
          const line = this.createLine(size * this.lineHeightMultiplier);
          await renderInlineRangeAsync(
            markdown,
            ev.s,
            ev.e,
            line,
            style,
            this.options,
            this.urlAllowlist,
            this.baseUrl,
            imageRenderer,
          );
          line.flush();
          this.addVerticalSpace(size * 0.2);
          break;
        }

        case 'listOpen':
          this.closeParagraph();
          this.listStack.push({ kind: ev.kind, counter: 1 });
          this.indent += INDENT;
          break;

        case 'listItem':
          this.closeParagraph();
          await this.renderListItemAsync(markdown, ev, imageRenderer);
          break;

        case 'listClose':
          this.closeParagraph();
          this.listStack.pop();
          this.indent = Math.max(0, this.indent - INDENT);
          this.addVerticalSpace(this.baseFontSize * 0.2);
          break;

        case 'paraLine': {
          const para = this.ensureParagraph();
          await renderInlineRangeAsync(
            markdown,
            ev.s,
            ev.e,
            para,
            this.style(),
            this.options,
            this.urlAllowlist,
            this.baseUrl,
            imageRenderer,
          );
          para.addSpace(this.style());
          break;
        }

        case 'rawHtmlLine':
          this.closeParagraph();
          this.renderRawLine(markdown, ev.s, ev.e);
          break;

        case 'codeOpen':
          this.closeParagraph();
          this.inCode = true;
          this.addVerticalSpace(this.baseFontSize * 0.4);
          break;

        case 'codeText':
          if (this.inCode) {
            this.renderCodeLine(markdown, ev.s, ev.e);
          }
          break;

        case 'codeClose':
          if (this.inCode) {
            this.inCode = false;
            this.addVerticalSpace(this.baseFontSize * 0.6);
          }
          break;

        case 'tableOpen':
          this.closeParagraph();
          this.addVerticalSpace(this.baseFontSize * 0.4);
          break;

        case 'tableHeader':
          await this.renderTableCellsAsync(markdown, ev.cells, true, imageRenderer);
          break;

        case 'tableRow':
          await this.renderTableCellsAsync(markdown, ev.cells, false, imageRenderer);
          break;

        case 'tableClose':
          this.addVerticalSpace(this.baseFontSize * 0.6);
          break;

        case 'infoOpen':
          this.closeParagraph();
          this.infoStackDepth++;
          this.renderInfoLabel(ev.infoType.toUpperCase());
          this.indent += INDENT;
          break;

        case 'infoClose':
          this.closeParagraph();
          if (this.infoStackDepth > 0) this.infoStackDepth--;
          this.indent = Math.max(0, this.indent - INDENT);
          this.addVerticalSpace(this.baseFontSize * 0.45);
          break;

        case 'footnoteDef':
          this.closeParagraph();
          await this.renderFootnoteAsync(markdown, ev.idS, ev.idE, ev.contentS, ev.contentE, imageRenderer);
          break;
      }
    }

    this.closeParagraph();
    return buildPdfFile(this.pages, this.pageWidth, this.pageHeight, this.images);
  }

  drawTextLine(runs: readonly PdfTextRun[], x: number, lineHeight: number): void {
    const maxSize = runs.reduce((size, run) => Math.max(size, run.style.size), this.baseFontSize);
    this.ensureSpace(lineHeight);
    const baseline = this.cursorY - maxSize;
    let cursorX = x;
    const decorations: Array<{ run: PdfTextRun; x1: number; x2: number; baseline: number }> = [];
    const content = this.currentPage.content;

    content.writeAscii('BT\n');
    for (const run of runs) {
      if (run.s >= run.e) continue;
      const fontId = FONT_IDS[run.style.font];
      content.writeAscii(`/${fontId} ${formatNumber(run.style.size)} Tf\n`);
      content.writeAscii(`${colorCommand(run.style.color, 'rg')}\n`);
      content.writeAscii(`1 0 0 1 ${formatNumber(cursorX)} ${formatNumber(baseline)} Tm\n<`);
      writePdfTextHex(content, run.bytes, run.s, run.e);
      content.writeAscii('> Tj\n');
      if (run.style.underline || run.style.strike) {
        decorations.push({ run, x1: cursorX, x2: cursorX + run.width, baseline });
      }
      cursorX += run.width;
    }
    content.writeAscii('ET\n');

    for (const decoration of decorations) {
      if (decoration.run.style.underline) {
        this.drawLine(
          decoration.x1,
          decoration.baseline - decoration.run.style.size * 0.18,
          decoration.x2,
          decoration.baseline - decoration.run.style.size * 0.18,
          COLORS.accent,
          0.6,
        );
      }
      if (decoration.run.style.strike) {
        this.drawLine(
          decoration.x1,
          decoration.baseline + decoration.run.style.size * 0.32,
          decoration.x2,
          decoration.baseline + decoration.run.style.size * 0.32,
          decoration.run.style.color,
          0.6,
        );
      }
    }

    this.cursorY -= lineHeight;
  }

  private renderInlineImageSync(
    markdown: Uint8Array,
    token: PdfImageToken,
    line: PdfLineComposer,
    _style: PdfTextStyle,
  ): boolean {
    const image = this.resolveImageSync(markdown, token);
    if (!image) return false;
    line.flush();
    this.drawImage(image);
    return true;
  }

  private async renderInlineImageAsync(
    markdown: Uint8Array,
    token: PdfImageToken,
    line: PdfLineComposer,
    _style: PdfTextStyle,
  ): Promise<boolean> {
    const image = await this.resolveImageAsync(markdown, token);
    if (!image) return false;
    line.flush();
    this.drawImage(image);
    return true;
  }

  private resolveImageSync(markdown: Uint8Array, token: PdfImageToken): PdfEmbeddedImage | null {
    const resolver = this.options.imageResolver;
    if (!resolver) return null;

    const context = this.buildImageContext(markdown, token);
    if (!this.urlAllowlist(context.resolvedSrc)) return null;

    const cached = this.imageByKey.get(context.resolvedSrc);
    if (cached) return cached;

    try {
      const resolved = resolver(context.resolvedSrc, context);
      if (isPromiseLike(resolved)) return null;
      return this.registerResolvedImage(resolved, context.resolvedSrc);
    } catch {
      return null;
    }
  }

  private async resolveImageAsync(markdown: Uint8Array, token: PdfImageToken): Promise<PdfEmbeddedImage | null> {
    const resolver = this.options.imageResolver;
    if (!resolver) return null;

    const context = this.buildImageContext(markdown, token);
    if (!this.urlAllowlist(context.resolvedSrc)) return null;

    const cached = this.imageByKey.get(context.resolvedSrc);
    if (cached) return cached;

    const pending = this.imagePromises.get(context.resolvedSrc);
    if (pending) return await pending;

    const promise = (async (): Promise<PdfEmbeddedImage | null> => {
      try {
        const resolved = await resolver(context.resolvedSrc, context);
        return this.registerResolvedImage(resolved, context.resolvedSrc);
      } catch {
        return null;
      }
    })();
    this.imagePromises.set(context.resolvedSrc, promise);
    return await promise;
  }

  private buildImageContext(markdown: Uint8Array, token: PdfImageToken): PdfImageResolverContext {
    const src = TD.decode(markdown.subarray(token.srcS, token.srcE));
    const resolvedSrc = resolveUrlRelativeToBase(src, this.baseUrl);
    const altText = TD.decode(markdown.subarray(token.altS, token.altE));
    return {
      src,
      resolvedSrc,
      altText,
      ...(this.baseUrl !== undefined ? { baseUrl: this.baseUrl } : {}),
    };
  }

  private registerResolvedImage(
    resolved: PdfResolvedImage | null,
    fallbackKey: string,
  ): PdfEmbeddedImage | null {
    if (!resolved) return null;

    const cacheKey = resolved.cacheKey ?? fallbackKey;
    const cached = this.imageByKey.get(cacheKey);
    if (cached) {
      this.imageByKey.set(fallbackKey, cached);
      return cached;
    }

    const parsed = parsePdfImage(resolved.bytes, resolved.mediaType);
    if (!parsed) return null;

    const image: PdfEmbeddedImage = {
      name: `Im${this.images.length + 1}`,
      ...parsed,
    };
    this.images.push(image);
    this.imageByKey.set(cacheKey, image);
    this.imageByKey.set(fallbackKey, image);
    return image;
  }

  private drawImage(image: PdfEmbeddedImage): void {
    const availableWidth = Math.max(80, this.contentWidth - this.indent);
    const configuredMaxWidth = this.options.maxImageWidth ?? availableWidth;
    const configuredMaxHeight = this.options.maxImageHeight ?? (this.pageHeight - this.margin * 2);
    const maxWidth = Math.max(24, Math.min(availableWidth, configuredMaxWidth));
    const maxHeight = Math.max(24, Math.min(this.pageHeight - this.margin * 2, configuredMaxHeight));

    let drawWidth = Math.min(image.width, maxWidth);
    let drawHeight = image.height * (drawWidth / image.width);
    if (drawHeight > maxHeight) {
      const scale = maxHeight / drawHeight;
      drawWidth *= scale;
      drawHeight *= scale;
    }

    this.ensureSpace(drawHeight + this.baseFontSize * 0.6);
    const x = this.margin + this.indent;
    const y = this.cursorY - drawHeight;
    this.currentPage.content.writeAscii(
      `q ${formatNumber(drawWidth)} 0 0 ${formatNumber(drawHeight)} ${formatNumber(x)} ${formatNumber(y)} cm /${image.name} Do Q\n`,
    );
    this.cursorY -= drawHeight + this.baseFontSize * 0.45;
  }

  private createPage(): PdfPage {
    const page = { content: new PdfByteWriter() };
    this.pages.push(page);
    this.cursorY = this.pageHeight - this.margin;
    return page;
  }

  private ensureSpace(height: number): void {
    if (this.cursorY - height >= this.margin) return;
    this.currentPage = this.createPage();
  }

  private addVerticalSpace(height: number): void {
    if (height <= 0) return;
    this.ensureSpace(height);
    this.cursorY -= height;
  }

  private createLine(lineHeight = this.baseFontSize * this.lineHeightMultiplier): PdfLineComposer {
    const x = this.margin + this.indent;
    const width = Math.max(80, this.contentWidth - this.indent);
    return new PdfLineComposer(this, x, width, lineHeight);
  }

  private ensureParagraph(): PdfLineComposer {
    if (!this.para) {
      this.para = this.createLine(this.baseFontSize * this.lineHeightMultiplier);
    }
    return this.para;
  }

  private closeParagraph(): void {
    if (!this.para) return;
    this.para.flush();
    this.para = null;
    this.addVerticalSpace(this.baseFontSize * 0.45);
  }

  private style(patch: Partial<PdfTextStyle> = {}): PdfTextStyle {
    return mergeStyle(
      {
        font: 'regular',
        size: this.baseFontSize,
        color: this.infoStackDepth > 0 ? COLORS.quote : COLORS.text,
      },
      patch,
    );
  }

  private headingSize(level: number): number {
    const index = Math.max(0, Math.min(FONT_SIZE.heading.length - 1, level - 1));
    return FONT_SIZE.heading[index];
  }

  private drawRule(): void {
    const gap = this.baseFontSize * 0.8;
    this.ensureSpace(gap * 2);
    const y = this.cursorY - gap;
    const x1 = this.margin + this.indent;
    const x2 = this.pageWidth - this.margin;
    this.drawLine(x1, y, x2, y, COLORS.rule, 1);
    this.cursorY -= gap * 2;
  }

  private drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: PdfColor,
    width: number,
  ): void {
    this.currentPage.content.writeAscii(
      `q ${colorCommand(color, 'RG')} ${formatNumber(width)} w ${formatNumber(x1)} ${formatNumber(y1)} m ${formatNumber(x2)} ${formatNumber(y2)} l S Q\n`,
    );
  }

  private fillRect(x: number, y: number, width: number, height: number, color: PdfColor): void {
    this.currentPage.content.writeAscii(
      `q ${colorCommand(color, 'rg')} ${formatNumber(x)} ${formatNumber(y)} ${formatNumber(width)} ${formatNumber(height)} re f Q\n`,
    );
  }

  private renderListItem(
    markdown: Uint8Array,
    ev: { s: number; e: number; task?: boolean; checked?: boolean },
  ): void {
    const line = this.createLine(this.baseFontSize * this.lineHeightMultiplier);
    const top = this.listStack[this.listStack.length - 1];
    let marker = '- ';
    if (top?.kind === 'ol') {
      marker = `${top.counter}. `;
      top.counter += 1;
    }
    if (ev.task) {
      marker += ev.checked ? '[x] ' : '[ ] ';
    }
    line.addGenerated(marker, this.style({ font: 'bold', color: COLORS.muted }));
    renderInlineRange(
      markdown,
      ev.s,
      ev.e,
      line,
      this.style(),
      this.options,
      this.urlAllowlist,
      this.baseUrl,
      (token, targetLine, style) => this.renderInlineImageSync(markdown, token, targetLine, style),
    );
    line.flush();
  }

  private async renderListItemAsync(
    markdown: Uint8Array,
    ev: { s: number; e: number; task?: boolean; checked?: boolean },
    imageRenderer: PdfInlineImageRendererAsync,
  ): Promise<void> {
    const line = this.createLine(this.baseFontSize * this.lineHeightMultiplier);
    const top = this.listStack[this.listStack.length - 1];
    let marker = '- ';
    if (top?.kind === 'ol') {
      marker = `${top.counter}. `;
      top.counter += 1;
    }
    if (ev.task) {
      marker += ev.checked ? '[x] ' : '[ ] ';
    }
    line.addGenerated(marker, this.style({ font: 'bold', color: COLORS.muted }));
    await renderInlineRangeAsync(
      markdown,
      ev.s,
      ev.e,
      line,
      this.style(),
      this.options,
      this.urlAllowlist,
      this.baseUrl,
      imageRenderer,
    );
    line.flush();
  }

  private renderRawLine(markdown: Uint8Array, s: number, e: number): void {
    const line = this.createLine(this.baseFontSize * this.lineHeightMultiplier);
    line.addTextSpan(markdown, s, e, this.style({ color: COLORS.muted }));
    line.flush();
  }

  private renderCodeLine(markdown: Uint8Array, s: number, e: number): void {
    const lineHeight = this.baseFontSize * 1.35;
    this.ensureSpace(lineHeight);
    const y = this.cursorY - lineHeight + 2;
    this.fillRect(
      this.margin + this.indent - 4,
      y,
      Math.max(80, this.contentWidth - this.indent) + 8,
      lineHeight,
      COLORS.codeBg,
    );
    const line = this.createLine(lineHeight);
    if (s < e) {
      line.addTextSpan(markdown, s, e, this.style({ font: 'mono', size: this.baseFontSize * 0.9 }), true);
      line.flush();
    } else {
      this.cursorY -= lineHeight;
    }
  }

  private renderTableCells(
    markdown: Uint8Array,
    cells: ReadonlyArray<{ s: number; e: number }>,
    header: boolean,
  ): void {
    const line = this.createLine(this.baseFontSize * this.lineHeightMultiplier);
    const cellStyle = this.style(header ? { font: 'bold' } : {});
    cells.forEach((cell, index) => {
      if (index > 0) {
        line.addGenerated(' | ', this.style({ color: COLORS.rule }));
      }
      renderInlineRange(
        markdown,
        cell.s,
        cell.e,
        line,
        cellStyle,
        this.options,
        this.urlAllowlist,
        this.baseUrl,
        (token, targetLine, style) => this.renderInlineImageSync(markdown, token, targetLine, style),
      );
    });
    line.flush();
    if (header) this.drawRule();
  }

  private async renderTableCellsAsync(
    markdown: Uint8Array,
    cells: ReadonlyArray<{ s: number; e: number }>,
    header: boolean,
    imageRenderer: PdfInlineImageRendererAsync,
  ): Promise<void> {
    const line = this.createLine(this.baseFontSize * this.lineHeightMultiplier);
    const cellStyle = this.style(header ? { font: 'bold' } : {});
    let index = 0;
    for (const cell of cells) {
      if (index > 0) {
        line.addGenerated(' | ', this.style({ color: COLORS.rule }));
      }
      await renderInlineRangeAsync(
        markdown,
        cell.s,
        cell.e,
        line,
        cellStyle,
        this.options,
        this.urlAllowlist,
        this.baseUrl,
        imageRenderer,
      );
      index++;
    }
    line.flush();
    if (header) this.drawRule();
  }

  private renderInfoLabel(label: string): void {
    const line = this.createLine(this.baseFontSize * this.lineHeightMultiplier);
    line.addGenerated(`${label}:`, this.style({ font: 'bold', color: COLORS.quote }));
    line.flush();
  }

  private renderFootnote(markdown: Uint8Array, idS: number, idE: number, contentS: number, contentE: number): void {
    const style = this.style({ size: this.baseFontSize * 0.85, color: COLORS.muted });
    const line = this.createLine(this.baseFontSize * 1.2);
    line.addGenerated('[', style);
    line.addTextSpan(markdown, idS, idE, style);
    line.addGenerated('] ', style);
    renderInlineRange(
      markdown,
      contentS,
      contentE,
      line,
      style,
      this.options,
      this.urlAllowlist,
      this.baseUrl,
      (token, targetLine, textStyle) => this.renderInlineImageSync(markdown, token, targetLine, textStyle),
    );
    line.flush();
  }

  private async renderFootnoteAsync(
    markdown: Uint8Array,
    idS: number,
    idE: number,
    contentS: number,
    contentE: number,
    imageRenderer: PdfInlineImageRendererAsync,
  ): Promise<void> {
    const style = this.style({ size: this.baseFontSize * 0.85, color: COLORS.muted });
    const line = this.createLine(this.baseFontSize * 1.2);
    line.addGenerated('[', style);
    line.addTextSpan(markdown, idS, idE, style);
    line.addGenerated('] ', style);
    await renderInlineRangeAsync(
      markdown,
      contentS,
      contentE,
      line,
      style,
      this.options,
      this.urlAllowlist,
      this.baseUrl,
      imageRenderer,
    );
    line.flush();
  }
}

function renderInlineRange(
  markdown: Uint8Array,
  s: number,
  e: number,
  line: PdfLineComposer,
  baseStyle: PdfTextStyle,
  options: PdfRenderOptions,
  urlAllowlist: (url: string) => boolean,
  baseUrl: string | undefined,
  imageRenderer?: PdfInlineImageRenderer,
  depth = 0,
): void {
  const inlineParseOptions = options.allowRawHtml ? { allowRawHtml: true } : undefined;
  const styleStack: PdfTextStyle[] = [];
  let currentStyle = cloneStyle(baseStyle);
  let pendingTextStart = -1;
  let pendingTextEnd = -1;

  const flushText = (): void => {
    if (pendingTextStart >= 0 && pendingTextEnd > pendingTextStart) {
      line.addTextSpan(markdown, pendingTextStart, pendingTextEnd, currentStyle);
    }
    pendingTextStart = -1;
    pendingTextEnd = -1;
  };

  const pushStyle = (patch: Partial<PdfTextStyle>): void => {
    flushText();
    styleStack.push(currentStyle);
    currentStyle = mergeStyle(currentStyle, patch);
  };

  const popStyle = (): void => {
    flushText();
    currentStyle = styleStack.pop() ?? cloneStyle(baseStyle);
  };

  const appendText = (tok: Extract<InlineToken, { kind: 'text' }>): void => {
    if (pendingTextStart >= 0 && tok.s === pendingTextEnd) {
      pendingTextEnd = tok.e;
      return;
    }
    flushText();
    pendingTextStart = tok.s;
    pendingTextEnd = tok.e;
  };

  for (const tok of inlineTokens(markdown, s, e, inlineParseOptions)) {
    switch (tok.kind) {
      case 'text':
        appendText(tok);
        break;

      case 'code':
        flushText();
        line.addTextSpan(markdown, tok.s, tok.e, mergeStyle(currentStyle, {
          font: 'mono',
          size: Math.max(8, currentStyle.size * 0.9),
          color: COLORS.quote,
        }), true);
        break;

      case 'img':
        flushText();
        if (imageRenderer?.(tok, line, currentStyle)) {
          break;
        }
        line.addGenerated('[image', mergeStyle(currentStyle, { font: 'italic', color: COLORS.muted }));
        if (tok.altE > tok.altS) {
          line.addGenerated(': ', mergeStyle(currentStyle, { font: 'italic', color: COLORS.muted }));
          line.addTextSpan(markdown, tok.altS, tok.altE, mergeStyle(currentStyle, {
            font: 'italic',
            color: COLORS.muted,
          }));
        }
        line.addGenerated(']', mergeStyle(currentStyle, { font: 'italic', color: COLORS.muted }));
        break;

      case 'link': {
        flushText();
        const href = TD.decode(markdown.subarray(tok.hrefS, tok.hrefE));
        const resolvedHref = resolveUrlRelativeToBase(href, baseUrl);
        const linkStyle = urlAllowlist(resolvedHref)
          ? mergeStyle(currentStyle, { color: COLORS.accent, underline: true })
          : currentStyle;
        if (depth < 8) {
          renderInlineRange(markdown, tok.textS, tok.textE, line, linkStyle, options, urlAllowlist, baseUrl, imageRenderer, depth + 1);
        } else {
          line.addTextSpan(markdown, tok.textS, tok.textE, linkStyle);
        }
        break;
      }

      case 'autolink':
        flushText();
        line.addTextSpan(markdown, tok.s, tok.e, mergeStyle(currentStyle, {
          color: COLORS.accent,
          underline: true,
        }));
        break;

      case 'footnoteRef':
        flushText();
        line.addGenerated('[', mergeStyle(currentStyle, { size: currentStyle.size * 0.75, color: COLORS.accent }));
        line.addTextSpan(markdown, tok.idS, tok.idE, mergeStyle(currentStyle, {
          size: currentStyle.size * 0.75,
          color: COLORS.accent,
        }));
        line.addGenerated(']', mergeStyle(currentStyle, { size: currentStyle.size * 0.75, color: COLORS.accent }));
        break;

      case 'rawHtml':
        flushText();
        break;

      case 'emOpen':
        pushStyle({ font: currentStyle.font === 'bold' ? 'boldItalic' : 'italic' });
        break;

      case 'emClose':
        popStyle();
        break;

      case 'strongOpen':
        pushStyle({ font: currentStyle.font === 'italic' ? 'boldItalic' : 'bold' });
        break;

      case 'strongClose':
        popStyle();
        break;

      case 'strikeOpen':
        pushStyle({ strike: true });
        break;

      case 'strikeClose':
        popStyle();
        break;
    }
  }

  flushText();
}

async function renderInlineRangeAsync(
  markdown: Uint8Array,
  s: number,
  e: number,
  line: PdfLineComposer,
  baseStyle: PdfTextStyle,
  options: PdfRenderOptions,
  urlAllowlist: (url: string) => boolean,
  baseUrl: string | undefined,
  imageRenderer?: PdfInlineImageRendererAsync,
  depth = 0,
): Promise<void> {
  const inlineParseOptions = options.allowRawHtml ? { allowRawHtml: true } : undefined;
  const styleStack: PdfTextStyle[] = [];
  let currentStyle = cloneStyle(baseStyle);
  let pendingTextStart = -1;
  let pendingTextEnd = -1;

  const flushText = (): void => {
    if (pendingTextStart >= 0 && pendingTextEnd > pendingTextStart) {
      line.addTextSpan(markdown, pendingTextStart, pendingTextEnd, currentStyle);
    }
    pendingTextStart = -1;
    pendingTextEnd = -1;
  };

  const pushStyle = (patch: Partial<PdfTextStyle>): void => {
    flushText();
    styleStack.push(currentStyle);
    currentStyle = mergeStyle(currentStyle, patch);
  };

  const popStyle = (): void => {
    flushText();
    currentStyle = styleStack.pop() ?? cloneStyle(baseStyle);
  };

  const appendText = (tok: Extract<InlineToken, { kind: 'text' }>): void => {
    if (pendingTextStart >= 0 && tok.s === pendingTextEnd) {
      pendingTextEnd = tok.e;
      return;
    }
    flushText();
    pendingTextStart = tok.s;
    pendingTextEnd = tok.e;
  };

  for (const tok of inlineTokens(markdown, s, e, inlineParseOptions)) {
    switch (tok.kind) {
      case 'text':
        appendText(tok);
        break;

      case 'code':
        flushText();
        line.addTextSpan(markdown, tok.s, tok.e, mergeStyle(currentStyle, {
          font: 'mono',
          size: Math.max(8, currentStyle.size * 0.9),
          color: COLORS.quote,
        }), true);
        break;

      case 'img':
        flushText();
        if (await imageRenderer?.(tok, line, currentStyle)) {
          break;
        }
        line.addGenerated('[image', mergeStyle(currentStyle, { font: 'italic', color: COLORS.muted }));
        if (tok.altE > tok.altS) {
          line.addGenerated(': ', mergeStyle(currentStyle, { font: 'italic', color: COLORS.muted }));
          line.addTextSpan(markdown, tok.altS, tok.altE, mergeStyle(currentStyle, {
            font: 'italic',
            color: COLORS.muted,
          }));
        }
        line.addGenerated(']', mergeStyle(currentStyle, { font: 'italic', color: COLORS.muted }));
        break;

      case 'link': {
        flushText();
        const href = TD.decode(markdown.subarray(tok.hrefS, tok.hrefE));
        const resolvedHref = resolveUrlRelativeToBase(href, baseUrl);
        const linkStyle = urlAllowlist(resolvedHref)
          ? mergeStyle(currentStyle, { color: COLORS.accent, underline: true })
          : currentStyle;
        if (depth < 8) {
          await renderInlineRangeAsync(markdown, tok.textS, tok.textE, line, linkStyle, options, urlAllowlist, baseUrl, imageRenderer, depth + 1);
        } else {
          line.addTextSpan(markdown, tok.textS, tok.textE, linkStyle);
        }
        break;
      }

      case 'autolink':
        flushText();
        line.addTextSpan(markdown, tok.s, tok.e, mergeStyle(currentStyle, {
          color: COLORS.accent,
          underline: true,
        }));
        break;

      case 'footnoteRef':
        flushText();
        line.addGenerated('[', mergeStyle(currentStyle, { size: currentStyle.size * 0.75, color: COLORS.accent }));
        line.addTextSpan(markdown, tok.idS, tok.idE, mergeStyle(currentStyle, {
          size: currentStyle.size * 0.75,
          color: COLORS.accent,
        }));
        line.addGenerated(']', mergeStyle(currentStyle, { size: currentStyle.size * 0.75, color: COLORS.accent }));
        break;

      case 'rawHtml':
        flushText();
        break;

      case 'emOpen':
        pushStyle({ font: currentStyle.font === 'bold' ? 'boldItalic' : 'italic' });
        break;

      case 'emClose':
        popStyle();
        break;

      case 'strongOpen':
        pushStyle({ font: currentStyle.font === 'italic' ? 'boldItalic' : 'bold' });
        break;

      case 'strongClose':
        popStyle();
        break;

      case 'strikeOpen':
        pushStyle({ strike: true });
        break;

      case 'strikeClose':
        popStyle();
        break;
    }
  }

  flushText();
}

function buildPdfFile(
  pages: readonly PdfPage[],
  pageWidth: number,
  pageHeight: number,
  images: readonly PdfEmbeddedImage[],
): Uint8Array {
  const out = new PdfByteWriter();
  const offsets: number[] = [0];
  const pageCount = pages.length;
  const firstPageObject = 3;
  const firstContentObject = firstPageObject + pageCount;
  const firstFontObject = firstContentObject + pageCount;
  const firstImageObject = firstFontObject + FONT_OBJECTS.length;

  const writeObject = (objectId: number, writeBody: () => void): void => {
    offsets[objectId] = out.length;
    out.writeAscii(`${objectId} 0 obj\n`);
    writeBody();
    out.writeAscii('\nendobj\n');
  };

  out.writeAscii('%PDF-1.7\n');

  writeObject(1, () => {
    out.writeAscii('<< /Type /Catalog /Pages 2 0 R >>');
  });

  writeObject(2, () => {
    out.writeAscii(`<< /Type /Pages /Count ${pageCount} /Kids [`);
    for (let index = 0; index < pageCount; index++) {
      out.writeAscii(`${firstPageObject + index} 0 R `);
    }
    out.writeAscii('] >>');
  });

  for (let index = 0; index < pageCount; index++) {
    const pageObject = firstPageObject + index;
    const contentObject = firstContentObject + index;
    writeObject(pageObject, () => {
      out.writeAscii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatNumber(pageWidth)} ${formatNumber(pageHeight)}] `,
      );
      out.writeAscii(`/Contents ${contentObject} 0 R /Resources << /Font << `);
      FONT_OBJECTS.forEach((font, fontIndex) => {
        out.writeAscii(`/${FONT_IDS[font.id]} ${firstFontObject + fontIndex} 0 R `);
      });
      out.writeAscii('>>');
      if (images.length > 0) {
        out.writeAscii(' /XObject << ');
        images.forEach((image, imageIndex) => {
          out.writeAscii(`/${image.name} ${firstImageObject + imageIndex} 0 R `);
        });
        out.writeAscii('>>');
      }
      out.writeAscii(' >> >>');
    });
  }

  for (let index = 0; index < pageCount; index++) {
    const contentObject = firstContentObject + index;
    const content = pages[index].content;
    writeObject(contentObject, () => {
      out.writeAscii(`<< /Length ${content.length} >>\nstream\n`);
      out.writeWriter(content);
      out.writeAscii('endstream');
    });
  }

  FONT_OBJECTS.forEach((font, index) => {
    writeObject(firstFontObject + index, () => {
      out.writeAscii(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${font.baseFont} /Encoding /WinAnsiEncoding >>`,
      );
    });
  });

  images.forEach((image, index) => {
    writeObject(firstImageObject + index, () => {
      out.writeAscii(
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} `,
      );
      out.writeAscii(
        `/ColorSpace ${image.colorSpace} /BitsPerComponent ${image.bitsPerComponent} `,
      );
      out.writeAscii(`/Filter /${image.filter} `);
      if (image.decodeParms) {
        out.writeAscii(`/DecodeParms ${image.decodeParms} `);
      }
      out.writeAscii(`/Length ${image.data.length} >>\nstream\n`);
      for (const chunk of image.data.chunks) {
        out.writeBytes(chunk);
      }
      out.writeAscii('\nendstream');
    });
  });

  const xrefOffset = out.length;
  const objectCount = firstImageObject + images.length;
  out.writeAscii(`xref\n0 ${objectCount}\n`);
  out.writeAscii('0000000000 65535 f \n');
  for (let objectId = 1; objectId < objectCount; objectId++) {
    out.writeAscii(`${String(offsets[objectId] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  out.writeAscii(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\n`);
  out.writeAscii(`startxref\n${xrefOffset}\n%%EOF\n`);

  return out.toUint8Array();
}

export function renderPDFFromBlocks(markdown: Uint8Array, options: PdfRenderOptions = {}): Uint8Array {
  return new PdfBlockRenderer(options).render(markdown);
}

export async function renderPDFFromBlocksAsync(
  markdown: Uint8Array,
  options: PdfRenderOptions = {},
): Promise<Uint8Array> {
  return await new PdfBlockRenderer(options).renderAsync(markdown);
}
