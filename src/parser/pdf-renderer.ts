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
  inflate?: PdfBinaryTransform;
  deflate?: PdfBinaryTransform;
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

export type PdfBinaryTransform = (
  input: Uint8Array,
) => Uint8Array | Promise<Uint8Array>;

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

type PdfImageMask = {
  width: number;
  height: number;
  bitsPerComponent: number;
  data: PdfImageData;
  filter?: 'FlateDecode';
  decodeParms?: string;
};

type PdfRasterXObject = {
  kind: 'image';
  name: string;
  width: number;
  height: number;
  colorSpace: string;
  bitsPerComponent: number;
  filter?: 'DCTDecode' | 'FlateDecode';
  data: PdfImageData;
  decodeParms?: string;
  softMask?: PdfImageMask;
};

type PdfFormXObject = {
  kind: 'form';
  name: string;
  width: number;
  height: number;
  data: PdfImageData;
};

type PdfEmbeddedImage = PdfRasterXObject | PdfFormXObject;
type PdfParsedImage =
  | Omit<PdfRasterXObject, 'name'>
  | Omit<PdfFormXObject, 'name'>;

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
const HELVETICA_WIDTHS: Record<number, number> = {
  32: 0.278, 33: 0.278, 34: 0.355, 35: 0.556, 36: 0.556, 37: 0.889, 38: 0.667, 39: 0.191,
  40: 0.333, 41: 0.333, 42: 0.389, 43: 0.584, 44: 0.278, 45: 0.333, 46: 0.278, 47: 0.278,
  48: 0.556, 49: 0.556, 50: 0.556, 51: 0.556, 52: 0.556, 53: 0.556, 54: 0.556, 55: 0.556,
  56: 0.556, 57: 0.556, 58: 0.278, 59: 0.278, 60: 0.584, 61: 0.584, 62: 0.584, 63: 0.556,
  64: 1.015, 65: 0.667, 66: 0.667, 67: 0.722, 68: 0.722, 69: 0.667, 70: 0.611, 71: 0.778,
  72: 0.722, 73: 0.278, 74: 0.5, 75: 0.667, 76: 0.556, 77: 0.833, 78: 0.722, 79: 0.778,
  80: 0.667, 81: 0.778, 82: 0.722, 83: 0.667, 84: 0.611, 85: 0.722, 86: 0.667, 87: 0.944,
  88: 0.667, 89: 0.667, 90: 0.611, 91: 0.278, 92: 0.278, 93: 0.278, 94: 0.469, 95: 0.556,
  96: 0.333, 97: 0.556, 98: 0.556, 99: 0.5, 100: 0.556, 101: 0.556, 102: 0.278, 103: 0.556,
  104: 0.556, 105: 0.222, 106: 0.222, 107: 0.5, 108: 0.222, 109: 0.833, 110: 0.556, 111: 0.556,
  112: 0.556, 113: 0.556, 114: 0.333, 115: 0.5, 116: 0.278, 117: 0.556, 118: 0.5, 119: 0.722,
  120: 0.5, 121: 0.5, 122: 0.5, 123: 0.334, 124: 0.26, 125: 0.334, 126: 0.584,
};
const HELVETICA_BOLD_WIDTHS: Record<number, number> = {
  32: 0.278, 33: 0.333, 34: 0.474, 35: 0.556, 36: 0.556, 37: 0.889, 38: 0.722, 39: 0.238,
  40: 0.333, 41: 0.333, 42: 0.389, 43: 0.584, 44: 0.278, 45: 0.333, 46: 0.278, 47: 0.278,
  48: 0.556, 49: 0.556, 50: 0.556, 51: 0.556, 52: 0.556, 53: 0.556, 54: 0.556, 55: 0.556,
  56: 0.556, 57: 0.556, 58: 0.333, 59: 0.333, 60: 0.584, 61: 0.584, 62: 0.584, 63: 0.611,
  64: 0.975, 65: 0.722, 66: 0.722, 67: 0.722, 68: 0.722, 69: 0.667, 70: 0.611, 71: 0.778,
  72: 0.722, 73: 0.278, 74: 0.556, 75: 0.722, 76: 0.611, 77: 0.833, 78: 0.722, 79: 0.778,
  80: 0.667, 81: 0.778, 82: 0.722, 83: 0.667, 84: 0.611, 85: 0.722, 86: 0.667, 87: 0.944,
  88: 0.667, 89: 0.667, 90: 0.611, 91: 0.333, 92: 0.278, 93: 0.333, 94: 0.584, 95: 0.556,
  96: 0.333, 97: 0.556, 98: 0.611, 99: 0.556, 100: 0.611, 101: 0.556, 102: 0.333, 103: 0.611,
  104: 0.611, 105: 0.278, 106: 0.278, 107: 0.556, 108: 0.278, 109: 0.889, 110: 0.611, 111: 0.611,
  112: 0.611, 113: 0.611, 114: 0.389, 115: 0.556, 116: 0.333, 117: 0.611, 118: 0.556, 119: 0.778,
  120: 0.556, 121: 0.556, 122: 0.5, 123: 0.389, 124: 0.28, 125: 0.389, 126: 0.584,
};

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
  if (font === 'mono') return 0.6;
  const widths = font === 'bold' || font === 'boldItalic'
    ? HELVETICA_BOLD_WIDTHS
    : HELVETICA_WIDTHS;
  return widths[byte] ?? (byte === 0x20 ? 0.278 : 0.556);
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
  return width * style.size;
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

function flattenImageData(data: PdfImageData): Uint8Array {
  if (data.chunks.length === 1 && data.chunks[0].length === data.length) {
    return data.chunks[0];
  }
  const bytes = new Uint8Array(data.length);
  let offset = 0;
  for (const chunk of data.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function transformDeflate(
  input: Uint8Array,
  transform: PdfBinaryTransform | undefined,
): Promise<{ data: PdfImageData; filter?: 'FlateDecode' }> {
  if (!transform) {
    return { data: imageDataFromChunks([input]) };
  }
  const output = await transform(input);
  return {
    data: imageDataFromChunks([output]),
    filter: 'FlateDecode',
  };
}

async function inflateWithBrowserStream(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is unavailable');
  }
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  const readPromise = (async (): Promise<void> => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
  })();

  await writer.write(input as BufferSource);
  await writer.close();
  await readPromise;

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

async function deflateWithBrowserStream(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream is unavailable');
  }
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  const readPromise = (async (): Promise<void> => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
  })();

  await writer.write(input as BufferSource);
  await writer.close();
  await readPromise;

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function defaultInflate(): PdfBinaryTransform | undefined {
  return typeof DecompressionStream !== 'undefined' ? inflateWithBrowserStream : undefined;
}

function defaultDeflate(): PdfBinaryTransform | undefined {
  return typeof CompressionStream !== 'undefined' ? deflateWithBrowserStream : undefined;
}

function parseJpegImage(bytes: Uint8Array): PdfParsedImage | null {
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
        kind: 'image',
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

function parsePngImage(bytes: Uint8Array): PdfParsedImage | null {
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
    kind: 'image',
    width,
    height,
    colorSpace,
    bitsPerComponent: bitDepth,
    filter: 'FlateDecode',
    data: imageDataFromChunks(idatChunks),
    decodeParms: `<< /Predictor 15 /Colors ${colors} /BitsPerComponent ${bitDepth} /Columns ${width} >>`,
  };
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterPngScanlines(
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
): Uint8Array | null {
  const rowLength = width * bytesPerPixel;
  const expectedLength = (rowLength + 1) * height;
  if (bytes.length < expectedLength) return null;

  const output = new Uint8Array(rowLength * height);
  let inputOffset = 0;
  let outputOffset = 0;

  for (let row = 0; row < height; row++) {
    const filter = bytes[inputOffset++];
    const rowStart = outputOffset;
    const prevRowStart = row === 0 ? -1 : rowStart - rowLength;

    for (let col = 0; col < rowLength; col++) {
      const raw = bytes[inputOffset++];
      const left = col >= bytesPerPixel ? output[rowStart + col - bytesPerPixel] : 0;
      const up = prevRowStart >= 0 ? output[prevRowStart + col] : 0;
      const upLeft = prevRowStart >= 0 && col >= bytesPerPixel
        ? output[prevRowStart + col - bytesPerPixel]
        : 0;

      let value: number;
      if (filter === 0) {
        value = raw;
      } else if (filter === 1) {
        value = raw + left;
      } else if (filter === 2) {
        value = raw + up;
      } else if (filter === 3) {
        value = raw + Math.floor((left + up) / 2);
      } else if (filter === 4) {
        value = raw + paethPredictor(left, up, upLeft);
      } else {
        return null;
      }
      output[outputOffset++] = value & 0xff;
    }
  }

  return output;
}

async function parsePngImageWithAlpha(
  bytes: Uint8Array,
  inflate: PdfBinaryTransform | undefined,
  deflate: PdfBinaryTransform | undefined,
): Promise<PdfParsedImage | null> {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
  if (!bytesEqual(bytes, 0, pngSignature)) return null;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idatChunks: Uint8Array[] = [];

  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + length + 4;
    if (nextOffset > bytes.length) return null;

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
    } else if (type === 'IDAT') {
      idatChunks.push(bytes.subarray(dataOffset, dataOffset + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = nextOffset;
  }

  if (width <= 0 || height <= 0 || bitDepth !== 8 || interlace !== 0 || idatChunks.length === 0) {
    return null;
  }
  if (colorType !== 4 && colorType !== 6) {
    return null;
  }

  const activeInflate = inflate ?? defaultInflate();
  if (!activeInflate) return null;

  const compressed = imageDataFromChunks(idatChunks);
  const decoded = await activeInflate(flattenImageData(compressed));
  const sourceChannels = colorType === 6 ? 4 : 2;
  const colorChannels = colorType === 6 ? 3 : 1;
  const unfiltered = unfilterPngScanlines(decoded, width, height, sourceChannels);
  if (!unfiltered) return null;

  const pixelCount = width * height;
  const colorBytes = new Uint8Array(pixelCount * colorChannels);
  const alphaBytes = new Uint8Array(pixelCount);
  let sourceOffset = 0;
  let colorOffset = 0;
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (colorType === 6) {
      colorBytes[colorOffset++] = unfiltered[sourceOffset++];
      colorBytes[colorOffset++] = unfiltered[sourceOffset++];
      colorBytes[colorOffset++] = unfiltered[sourceOffset++];
      alphaBytes[pixel] = unfiltered[sourceOffset++];
    } else {
      colorBytes[colorOffset++] = unfiltered[sourceOffset++];
      alphaBytes[pixel] = unfiltered[sourceOffset++];
    }
  }

  const colorEncoded = await transformDeflate(colorBytes, deflate ?? defaultDeflate());
  const alphaEncoded = await transformDeflate(alphaBytes, deflate ?? defaultDeflate());
  return {
    kind: 'image',
    width,
    height,
    colorSpace: colorType === 6 ? '/DeviceRGB' : '/DeviceGray',
    bitsPerComponent: 8,
    data: colorEncoded.data,
    ...(colorEncoded.filter ? { filter: colorEncoded.filter } : {}),
    softMask: {
      width,
      height,
      bitsPerComponent: 8,
      data: alphaEncoded.data,
      ...(alphaEncoded.filter ? { filter: alphaEncoded.filter } : {}),
    },
  };
}

function parseSvgAttributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrRe = /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(attrRe)) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function parseSvgNumber(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function parseSvgNumberList(value: string | undefined): number[] {
  if (!value) return [];
  const numbers: number[] = [];
  const numberRe = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  for (const match of value.matchAll(numberRe)) {
    const number = Number(match[0]);
    if (Number.isFinite(number)) numbers.push(number);
  }
  return numbers;
}

function parseSvgStyle(attrs: Map<string, string>): Map<string, string> {
  const style = new Map<string, string>();
  const raw = attrs.get('style');
  if (!raw) return style;
  for (const part of raw.split(';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    style.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
  }
  return style;
}

function svgAttr(attrs: Map<string, string>, style: Map<string, string>, name: string): string | undefined {
  return attrs.get(name) ?? style.get(name);
}

function parseSvgColor(value: string | undefined): PdfColor | null {
  if (!value) return null;
  const color = value.trim().toLowerCase();
  if (!color || color === 'none' || color === 'transparent' || color.startsWith('url(')) {
    return null;
  }
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const r = Number.parseInt(color[1] + color[1], 16) / 255;
    const g = Number.parseInt(color[2] + color[2], 16) / 255;
    const b = Number.parseInt(color[3] + color[3], 16) / 255;
    return [r, g, b] as const;
  }
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const r = Number.parseInt(color.slice(1, 3), 16) / 255;
    const g = Number.parseInt(color.slice(3, 5), 16) / 255;
    const b = Number.parseInt(color.slice(5, 7), 16) / 255;
    return [r, g, b] as const;
  }
  if (color === 'black') return [0, 0, 0] as const;
  if (color === 'white') return [1, 1, 1] as const;
  if (color === 'red') return [1, 0, 0] as const;
  if (color === 'green') return [0, 0.5, 0] as const;
  if (color === 'blue') return [0, 0, 1] as const;
  return null;
}

function writeSvgPaint(
  out: PdfByteWriter,
  attrs: Map<string, string>,
  defaultFill: PdfColor | null,
): boolean {
  const style = parseSvgStyle(attrs);
  const fill = parseSvgColor(svgAttr(attrs, style, 'fill')) ?? defaultFill;
  const stroke = parseSvgColor(svgAttr(attrs, style, 'stroke'));
  const strokeWidth = Math.max(0.1, parseSvgNumber(svgAttr(attrs, style, 'stroke-width')) ?? 1);

  if (!fill && !stroke) return false;
  if (fill) out.writeAscii(`${colorCommand(fill, 'rg')}\n`);
  if (stroke) {
    out.writeAscii(`${colorCommand(stroke, 'RG')}\n`);
    out.writeAscii(`${formatNumber(strokeWidth)} w\n`);
  }
  out.writeAscii(fill && stroke ? 'B\n' : fill ? 'f\n' : 'S\n');
  return true;
}

function writeSvgRectPath(out: PdfByteWriter, attrs: Map<string, string>): boolean {
  const x = parseSvgNumber(attrs.get('x')) ?? 0;
  const y = parseSvgNumber(attrs.get('y')) ?? 0;
  const width = parseSvgNumber(attrs.get('width')) ?? 0;
  const height = parseSvgNumber(attrs.get('height')) ?? 0;
  if (width <= 0 || height <= 0) return false;
  out.writeAscii(`${formatNumber(x)} ${formatNumber(y)} ${formatNumber(width)} ${formatNumber(height)} re\n`);
  return true;
}

function writeSvgLinePath(out: PdfByteWriter, attrs: Map<string, string>): boolean {
  const x1 = parseSvgNumber(attrs.get('x1')) ?? 0;
  const y1 = parseSvgNumber(attrs.get('y1')) ?? 0;
  const x2 = parseSvgNumber(attrs.get('x2')) ?? 0;
  const y2 = parseSvgNumber(attrs.get('y2')) ?? 0;
  out.writeAscii(`${formatNumber(x1)} ${formatNumber(y1)} m ${formatNumber(x2)} ${formatNumber(y2)} l\n`);
  return true;
}

function writeSvgEllipsePath(out: PdfByteWriter, cx: number, cy: number, rx: number, ry: number): boolean {
  if (rx <= 0 || ry <= 0) return false;
  const k = 0.5522847498;
  out.writeAscii(`${formatNumber(cx + rx)} ${formatNumber(cy)} m\n`);
  out.writeAscii(`${formatNumber(cx + rx)} ${formatNumber(cy + ry * k)} ${formatNumber(cx + rx * k)} ${formatNumber(cy + ry)} ${formatNumber(cx)} ${formatNumber(cy + ry)} c\n`);
  out.writeAscii(`${formatNumber(cx - rx * k)} ${formatNumber(cy + ry)} ${formatNumber(cx - rx)} ${formatNumber(cy + ry * k)} ${formatNumber(cx - rx)} ${formatNumber(cy)} c\n`);
  out.writeAscii(`${formatNumber(cx - rx)} ${formatNumber(cy - ry * k)} ${formatNumber(cx - rx * k)} ${formatNumber(cy - ry)} ${formatNumber(cx)} ${formatNumber(cy - ry)} c\n`);
  out.writeAscii(`${formatNumber(cx + rx * k)} ${formatNumber(cy - ry)} ${formatNumber(cx + rx)} ${formatNumber(cy - ry * k)} ${formatNumber(cx + rx)} ${formatNumber(cy)} c\nh\n`);
  return true;
}

function writeSvgPointsPath(out: PdfByteWriter, points: string | undefined, close: boolean): boolean {
  const values = parseSvgNumberList(points);
  if (values.length < 4) return false;
  out.writeAscii(`${formatNumber(values[0])} ${formatNumber(values[1])} m\n`);
  for (let index = 2; index + 1 < values.length; index += 2) {
    out.writeAscii(`${formatNumber(values[index])} ${formatNumber(values[index + 1])} l\n`);
  }
  if (close) out.writeAscii('h\n');
  return true;
}

function writeSvgPathData(out: PdfByteWriter, d: string | undefined): boolean {
  if (!d) return false;
  const tokens = Array.from(d.matchAll(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g), (match) => match[0]);
  if (tokens.length === 0) return false;
  let index = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let wrote = false;

  const isCommand = (value: string): boolean => /^[A-Za-z]$/.test(value);
  const readNumber = (): number | null => {
    if (index >= tokens.length || isCommand(tokens[index])) return null;
    const number = Number(tokens[index++]);
    return Number.isFinite(number) ? number : null;
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      cmd = tokens[index++];
    } else if (!cmd) {
      return false;
    }

    const relative = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();
    if (upper === 'Z') {
      out.writeAscii('h\n');
      x = startX;
      y = startY;
      wrote = true;
      continue;
    }

    if (upper === 'M') {
      const nx = readNumber();
      const ny = readNumber();
      if (nx === null || ny === null) return wrote;
      x = relative ? x + nx : nx;
      y = relative ? y + ny : ny;
      startX = x;
      startY = y;
      out.writeAscii(`${formatNumber(x)} ${formatNumber(y)} m\n`);
      wrote = true;
      cmd = relative ? 'l' : 'L';
      continue;
    }

    if (upper === 'L') {
      const nx = readNumber();
      const ny = readNumber();
      if (nx === null || ny === null) return wrote;
      x = relative ? x + nx : nx;
      y = relative ? y + ny : ny;
      out.writeAscii(`${formatNumber(x)} ${formatNumber(y)} l\n`);
      wrote = true;
      continue;
    }

    if (upper === 'H') {
      const nx = readNumber();
      if (nx === null) return wrote;
      x = relative ? x + nx : nx;
      out.writeAscii(`${formatNumber(x)} ${formatNumber(y)} l\n`);
      wrote = true;
      continue;
    }

    if (upper === 'V') {
      const ny = readNumber();
      if (ny === null) return wrote;
      y = relative ? y + ny : ny;
      out.writeAscii(`${formatNumber(x)} ${formatNumber(y)} l\n`);
      wrote = true;
      continue;
    }

    if (upper === 'C') {
      const x1 = readNumber();
      const y1 = readNumber();
      const x2 = readNumber();
      const y2 = readNumber();
      const x3 = readNumber();
      const y3 = readNumber();
      if (x1 === null || y1 === null || x2 === null || y2 === null || x3 === null || y3 === null) {
        return wrote;
      }
      const cx1 = relative ? x + x1 : x1;
      const cy1 = relative ? y + y1 : y1;
      const cx2 = relative ? x + x2 : x2;
      const cy2 = relative ? y + y2 : y2;
      x = relative ? x + x3 : x3;
      y = relative ? y + y3 : y3;
      out.writeAscii(`${formatNumber(cx1)} ${formatNumber(cy1)} ${formatNumber(cx2)} ${formatNumber(cy2)} ${formatNumber(x)} ${formatNumber(y)} c\n`);
      wrote = true;
      continue;
    }

    return wrote;
  }

  return wrote;
}

function parseSvgImage(bytes: Uint8Array, mediaType: string | undefined): PdfParsedImage | null {
  const normalizedType = mediaType?.toLowerCase().split(';', 1)[0]?.trim();
  const source = TD.decode(bytes).trim();
  if (normalizedType !== 'image/svg+xml' && !source.startsWith('<svg')) return null;
  if (/<\s*(script|foreignobject|iframe|object|embed|image|use|style|animate|set|filter|mask|clippath|pattern|lineargradient|radialgradient)\b/i.test(source)) {
    return null;
  }
  if (/\b(?:href|xlink:href)\s*=|url\s*\(/i.test(source)) {
    return null;
  }

  const svgMatch = /<\s*svg\b([^>]*)>/i.exec(source);
  if (!svgMatch) return null;
  const svgAttrs = parseSvgAttributes(svgMatch[1]);
  const viewBox = parseSvgNumberList(svgAttrs.get('viewbox'));
  const minX = viewBox.length >= 4 ? viewBox[0] : 0;
  const minY = viewBox.length >= 4 ? viewBox[1] : 0;
  const viewWidth = viewBox.length >= 4 ? viewBox[2] : parseSvgNumber(svgAttrs.get('width')) ?? 0;
  const viewHeight = viewBox.length >= 4 ? viewBox[3] : parseSvgNumber(svgAttrs.get('height')) ?? 0;
  const width = parseSvgNumber(svgAttrs.get('width')) ?? viewWidth;
  const height = parseSvgNumber(svgAttrs.get('height')) ?? viewHeight;
  if (width <= 0 || height <= 0 || viewWidth <= 0 || viewHeight <= 0) return null;

  const content = new PdfByteWriter();
  const scaleX = width / viewWidth;
  const scaleY = height / viewHeight;
  content.writeAscii(`q ${formatNumber(scaleX)} 0 0 ${formatNumber(-scaleY)} ${formatNumber(-minX * scaleX)} ${formatNumber(height + minY * scaleY)} cm\n`);

  const tagRe = /<\s*([A-Za-z][A-Za-z0-9:-]*)([^<>]*?)(?:\/\s*)?>/g;
  for (const match of source.matchAll(tagRe)) {
    const tag = match[1].toLowerCase();
    if (tag === 'svg' || tag === 'g') continue;
    const attrs = parseSvgAttributes(match[2]);
    const shape = new PdfByteWriter();
    let defaultFill: PdfColor | null = [0, 0, 0] as const;
    let hasPath = false;

    if (tag === 'rect') {
      hasPath = writeSvgRectPath(shape, attrs);
    } else if (tag === 'line') {
      defaultFill = null;
      hasPath = writeSvgLinePath(shape, attrs);
    } else if (tag === 'circle') {
      const cx = parseSvgNumber(attrs.get('cx')) ?? 0;
      const cy = parseSvgNumber(attrs.get('cy')) ?? 0;
      const r = parseSvgNumber(attrs.get('r')) ?? 0;
      hasPath = writeSvgEllipsePath(shape, cx, cy, r, r);
    } else if (tag === 'ellipse') {
      const cx = parseSvgNumber(attrs.get('cx')) ?? 0;
      const cy = parseSvgNumber(attrs.get('cy')) ?? 0;
      const rx = parseSvgNumber(attrs.get('rx')) ?? 0;
      const ry = parseSvgNumber(attrs.get('ry')) ?? 0;
      hasPath = writeSvgEllipsePath(shape, cx, cy, rx, ry);
    } else if (tag === 'polygon') {
      hasPath = writeSvgPointsPath(shape, attrs.get('points'), true);
    } else if (tag === 'polyline') {
      defaultFill = null;
      hasPath = writeSvgPointsPath(shape, attrs.get('points'), false);
    } else if (tag === 'path') {
      hasPath = writeSvgPathData(shape, attrs.get('d'));
    }

    if (!hasPath) continue;
    content.writeAscii('q\n');
    content.writeWriter(shape);
    if (!writeSvgPaint(content, attrs, defaultFill)) {
      content.writeAscii('n\n');
    }
    content.writeAscii('Q\n');
  }

  content.writeAscii('Q\n');
  return {
    kind: 'form',
    width,
    height,
    data: imageDataFromChunks([content.toUint8Array()]),
  };
}

function parsePdfImage(bytes: Uint8Array, mediaType: string | undefined): PdfParsedImage | null {
  const normalizedType = mediaType?.toLowerCase().split(';', 1)[0]?.trim();
  if (normalizedType === 'image/svg+xml') {
    return parseSvgImage(bytes, mediaType);
  }
  if (normalizedType === 'image/jpeg' || normalizedType === 'image/jpg') {
    return parseJpegImage(bytes);
  }
  if (normalizedType === 'image/png') {
    return parsePngImage(bytes);
  }
  return parseJpegImage(bytes) ?? parsePngImage(bytes) ?? parseSvgImage(bytes, mediaType);
}

async function parsePdfImageAsync(
  bytes: Uint8Array,
  mediaType: string | undefined,
  options: PdfRenderOptions,
): Promise<PdfParsedImage | null> {
  const normalizedType = mediaType?.toLowerCase().split(';', 1)[0]?.trim();
  if (normalizedType === 'image/svg+xml') {
    return parseSvgImage(bytes, mediaType);
  }
  if (normalizedType === 'image/jpeg' || normalizedType === 'image/jpg') {
    return parseJpegImage(bytes);
  }
  if (normalizedType === 'image/png') {
    return parsePngImage(bytes) ?? await parsePngImageWithAlpha(bytes, options.inflate, options.deflate);
  }
  return (
    parseJpegImage(bytes) ??
    parsePngImage(bytes) ??
    await parsePngImageWithAlpha(bytes, options.inflate, options.deflate) ??
    parseSvgImage(bytes, mediaType)
  );
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
  private pendingSpace = false;
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
    this.pendingSpace = true;
    const spaceWidth = measureTextSpan(SPACE, 0, SPACE.length, style);
    if (this.lineWidth + spaceWidth > this.maxWidth) {
      this.flush();
    }
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
    this.pendingSpace = false;
  }

  private addSegment(bytes: Uint8Array, s: number, e: number, style: PdfTextStyle): void {
    if (s >= e) return;
    const segmentWidth = measureTextSpan(bytes, s, e, style);
    const spaceWidth = this.pendingSpace && this.lineWidth > 0
      ? measureTextSpan(SPACE, 0, SPACE.length, style)
      : 0;
    let width = segmentWidth + spaceWidth;
    if (this.lineWidth > 0 && this.lineWidth + width > this.maxWidth) {
      this.flush();
      width = segmentWidth;
    }

    if (width > this.maxWidth) {
      this.pendingSpace = false;
      this.addLongSegment(bytes, s, e, style);
      return;
    }

    let runBytes = bytes;
    let runStart = s;
    let runEnd = e;
    if (this.pendingSpace && this.lineWidth > 0) {
      runBytes = new Uint8Array(e - s + 1);
      runBytes[0] = 0x20;
      runBytes.set(bytes.subarray(s, e), 1);
      runStart = 0;
      runEnd = runBytes.length;
    }
    this.pendingSpace = false;
    this.line.push({
      bytes: runBytes,
      s: runStart,
      e: runEnd,
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
        return await this.registerResolvedImageAsync(resolved, context.resolvedSrc);
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

  private async registerResolvedImageAsync(
    resolved: PdfResolvedImage | null,
    fallbackKey: string,
  ): Promise<PdfEmbeddedImage | null> {
    if (!resolved) return null;

    const cacheKey = resolved.cacheKey ?? fallbackKey;
    const cached = this.imageByKey.get(cacheKey);
    if (cached) {
      this.imageByKey.set(fallbackKey, cached);
      return cached;
    }

    const parsed = await parsePdfImageAsync(resolved.bytes, resolved.mediaType, this.options);
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
  const imageObjectIds = new Map<PdfEmbeddedImage, number>();
  const maskObjectIds = new Map<PdfImageMask, number>();
  let nextObjectId = firstImageObject;
  for (const image of images) {
    imageObjectIds.set(image, nextObjectId++);
    if (image.kind === 'image' && image.softMask) {
      maskObjectIds.set(image.softMask, nextObjectId++);
    }
  }

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
        images.forEach((image) => {
          out.writeAscii(`/${image.name} ${imageObjectIds.get(image) ?? 0} 0 R `);
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

  images.forEach((image) => {
    writeObject(imageObjectIds.get(image) ?? 0, () => {
      if (image.kind === 'form') {
        out.writeAscii(
          `<< /Type /XObject /Subtype /Form /BBox [0 0 ${formatNumber(image.width)} ${formatNumber(image.height)}] `,
        );
        out.writeAscii(`/Length ${image.data.length} >>\nstream\n`);
        for (const chunk of image.data.chunks) {
          out.writeBytes(chunk);
        }
        out.writeAscii('\nendstream');
        return;
      }

      out.writeAscii(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} `);
      out.writeAscii(`/ColorSpace ${image.colorSpace} /BitsPerComponent ${image.bitsPerComponent} `);
      if (image.filter) {
        out.writeAscii(`/Filter /${image.filter} `);
      }
      if (image.decodeParms) {
        out.writeAscii(`/DecodeParms ${image.decodeParms} `);
      }
      if (image.softMask) {
        out.writeAscii(`/SMask ${maskObjectIds.get(image.softMask) ?? 0} 0 R `);
      }
      out.writeAscii(`/Length ${image.data.length} >>\nstream\n`);
      for (const chunk of image.data.chunks) {
        out.writeBytes(chunk);
      }
      out.writeAscii('\nendstream');
    });

    if (image.kind === 'image' && image.softMask) {
      const mask = image.softMask;
      writeObject(maskObjectIds.get(mask) ?? 0, () => {
        out.writeAscii(
          `<< /Type /XObject /Subtype /Image /Width ${mask.width} /Height ${mask.height} `,
        );
        out.writeAscii(`/ColorSpace /DeviceGray /BitsPerComponent ${mask.bitsPerComponent} `);
        if (mask.filter) {
          out.writeAscii(`/Filter /${mask.filter} `);
        }
        if (mask.decodeParms) {
          out.writeAscii(`/DecodeParms ${mask.decodeParms} `);
        }
        out.writeAscii(`/Length ${mask.data.length} >>\nstream\n`);
        for (const chunk of mask.data.chunks) {
          out.writeBytes(chunk);
        }
        out.writeAscii('\nendstream');
      });
    }
  });

  const xrefOffset = out.length;
  const objectCount = nextObjectId;
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
