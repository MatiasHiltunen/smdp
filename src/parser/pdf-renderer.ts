import { blocks } from './block-parser';
import { inlineTokens } from './inline-parser';
import { INDENT, TD, TE } from './constants';
import type { InlineToken } from './types';
import type { ParserOptions } from './index';
import { defaultUrlAllowlist, resolveUrlRelativeToBase } from './utils';
import {
  tokenizeCodeBlock,
  type HighlightTokenKind,
  type HighlightTokenSpan,
} from '../highlight';
import { bufferCodeBlock, type CodeBlockSourceSpan } from './code-block-buffer';

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
  maxContentWidth?: number;
  codeColors?: PdfCodeColorOptions;
  documentStyle?: PdfDocumentStyleOptions;
  emojiFont?: Uint8Array | ArrayBuffer;
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

export type PdfRGB = readonly [number, number, number];
export type PdfCodeColorKey = Exclude<HighlightTokenKind, 'text'>;
export type PdfCodeColorOptions = Partial<Record<PdfCodeColorKey, PdfRGB>>;

export interface PdfDocumentStyleOptions {
  pageBackground?: PdfRGB;
  text?: PdfRGB;
  textSecondary?: PdfRGB;
  accent?: PdfRGB;
  border?: PdfRGB;
  surface?: PdfRGB;
  codeBackground?: PdfRGB;
  codeBorder?: PdfRGB;
  inlineCodeBackground?: PdfRGB;
  inlineCodeText?: PdfRGB;
  tableHeaderBackground?: PdfRGB;
  tableStripeBackground?: PdfRGB;
  blockquoteBorder?: PdfRGB;
  blockquoteText?: PdfRGB;
  infoBorder?: PdfRGB;
  infoBackground?: PdfRGB;
  warningBorder?: PdfRGB;
  warningBackground?: PdfRGB;
  errorBorder?: PdfRGB;
  errorBackground?: PdfRGB;
  successBorder?: PdfRGB;
  successBackground?: PdfRGB;
}

type PdfColor = PdfRGB;

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
  fallbackFont?: PdfEmbeddedTextFont;
  underline?: boolean;
  strike?: boolean;
  background?: PdfColor;
  backgroundPaddingX?: number;
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

type PdfEmbeddedTextFont = {
  resourceName: string;
  baseFontName: string;
  bytes: Uint8Array;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  bbox: readonly [number, number, number, number];
  glyphs: Map<number, number>;
  widths: number[];
  usedGlyphs: Map<number, number>;
};

type ListFrame = {
  kind: 'ul' | 'ol';
  counter: number;
};

type PdfInfoKind = 'info' | 'warning' | 'error' | 'success';

type PdfContainerFrame = {
  x: number;
  width: number;
};

type PdfInfoFrame = PdfContainerFrame & {
  kind: PdfInfoKind;
};

type PdfTableAlign = 'left' | 'center' | 'right';

type PdfTableInputCell = {
  s: number;
  e: number;
  align: PdfTableAlign;
};

type PdfTableInputRow = {
  header: boolean;
  cells: PdfTableInputCell[];
};

type PdfTableBuffer = {
  alignments: PdfTableAlign[];
  rows: PdfTableInputRow[];
};

type PdfTableRenderCell = {
  align: PdfTableAlign;
  rows: PdfTextRun[][];
};

type PdfTableRenderRow = {
  header: boolean;
  cells: PdfTableRenderCell[];
  height: number;
};

const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
} as const;

const DEFAULT_DOCUMENT_STYLE = {
  pageBackground: [1, 1, 1] as const,
  text: [0.08, 0.1, 0.12] as const,
  textSecondary: [0.35, 0.38, 0.45] as const,
  accent: [0.145, 0.388, 0.922] as const,
  border: [0.86, 0.88, 0.91] as const,
  surface: [0.96, 0.969, 0.98] as const,
  codeBackground: [0.96, 0.969, 0.98] as const,
  codeBorder: [0.86, 0.88, 0.91] as const,
  inlineCodeBackground: [0.93, 0.95, 0.98] as const,
  inlineCodeText: [0.145, 0.388, 0.922] as const,
  tableHeaderBackground: [0.94, 0.955, 0.975] as const,
  tableStripeBackground: [0.985, 0.989, 0.995] as const,
  blockquoteBorder: [0.145, 0.388, 0.922] as const,
  blockquoteText: [0.27, 0.31, 0.39] as const,
  infoBorder: [0.36, 0.58, 0.93] as const,
  infoBackground: [0.94, 0.965, 1] as const,
  warningBorder: [0.82, 0.58, 0.08] as const,
  warningBackground: [1, 0.975, 0.9] as const,
  errorBorder: [0.82, 0.25, 0.25] as const,
  errorBackground: [1, 0.94, 0.94] as const,
  successBorder: [0.18, 0.65, 0.36] as const,
  successBackground: [0.93, 0.99, 0.95] as const,
} as const;

type ResolvedPdfDocumentStyle = {
  [K in keyof PdfDocumentStyleOptions]-?: PdfColor;
};

function resolveDocumentStyle(style: PdfDocumentStyleOptions | undefined): ResolvedPdfDocumentStyle {
  const accent = style?.accent ?? DEFAULT_DOCUMENT_STYLE.accent;
  const border = style?.border ?? DEFAULT_DOCUMENT_STYLE.border;
  const surface = style?.surface ?? DEFAULT_DOCUMENT_STYLE.surface;
  return {
    pageBackground: style?.pageBackground ?? DEFAULT_DOCUMENT_STYLE.pageBackground,
    text: style?.text ?? DEFAULT_DOCUMENT_STYLE.text,
    textSecondary: style?.textSecondary ?? DEFAULT_DOCUMENT_STYLE.textSecondary,
    accent,
    border,
    surface,
    codeBackground: style?.codeBackground ?? style?.surface ?? DEFAULT_DOCUMENT_STYLE.codeBackground,
    codeBorder: style?.codeBorder ?? style?.border ?? DEFAULT_DOCUMENT_STYLE.codeBorder,
    inlineCodeBackground: style?.inlineCodeBackground ?? style?.surface ?? DEFAULT_DOCUMENT_STYLE.inlineCodeBackground,
    inlineCodeText: style?.inlineCodeText ?? style?.accent ?? DEFAULT_DOCUMENT_STYLE.inlineCodeText,
    tableHeaderBackground: style?.tableHeaderBackground ?? style?.surface ?? DEFAULT_DOCUMENT_STYLE.tableHeaderBackground,
    tableStripeBackground: style?.tableStripeBackground ?? style?.surface ?? DEFAULT_DOCUMENT_STYLE.tableStripeBackground,
    blockquoteBorder: style?.blockquoteBorder ?? style?.accent ?? DEFAULT_DOCUMENT_STYLE.blockquoteBorder,
    blockquoteText: style?.blockquoteText ?? style?.textSecondary ?? DEFAULT_DOCUMENT_STYLE.blockquoteText,
    infoBorder: style?.infoBorder ?? DEFAULT_DOCUMENT_STYLE.infoBorder,
    infoBackground: style?.infoBackground ?? DEFAULT_DOCUMENT_STYLE.infoBackground,
    warningBorder: style?.warningBorder ?? DEFAULT_DOCUMENT_STYLE.warningBorder,
    warningBackground: style?.warningBackground ?? DEFAULT_DOCUMENT_STYLE.warningBackground,
    errorBorder: style?.errorBorder ?? DEFAULT_DOCUMENT_STYLE.errorBorder,
    errorBackground: style?.errorBackground ?? DEFAULT_DOCUMENT_STYLE.errorBackground,
    successBorder: style?.successBorder ?? DEFAULT_DOCUMENT_STYLE.successBorder,
    successBackground: style?.successBackground ?? DEFAULT_DOCUMENT_STYLE.successBackground,
  };
}

function documentColor<K extends keyof PdfDocumentStyleOptions>(
  options: PdfRenderOptions,
  key: K,
): PdfColor {
  const style = options.documentStyle;
  const direct = style?.[key];
  if (direct) return direct;
  if (
    key === 'codeBackground' ||
    key === 'inlineCodeBackground' ||
    key === 'tableHeaderBackground'
  ) {
    return style?.surface ?? DEFAULT_DOCUMENT_STYLE[key];
  }
  if (key === 'codeBorder') return style?.border ?? DEFAULT_DOCUMENT_STYLE.codeBorder;
  if (key === 'inlineCodeText' || key === 'blockquoteBorder') {
    return style?.accent ?? DEFAULT_DOCUMENT_STYLE[key];
  }
  if (key === 'blockquoteText') {
    return style?.textSecondary ?? DEFAULT_DOCUMENT_STYLE.blockquoteText;
  }
  return DEFAULT_DOCUMENT_STYLE[key];
}

const CODE_COLORS: Record<PdfCodeColorKey, PdfColor> = {
  kw: [0.145, 0.388, 0.922] as const,
  id: [0.153, 0.192, 0.259] as const,
  num: [0.792, 0.541, 0.016] as const,
  str: [0.082, 0.502, 0.239] as const,
  tpl: [0.051, 0.58, 0.533] as const,
  com: [0.408, 0.451, 0.525] as const,
  op: [0.576, 0.2, 0.918] as const,
  punc: [0.325, 0.376, 0.459] as const,
  rx: [0.761, 0.255, 0.047] as const,
};

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

function isWhitespaceSpan(bytes: Uint8Array, s: number, e: number): boolean {
  if (s >= e) return false;
  for (let index = s; index < e; index++) {
    if (!isAsciiWhitespace(bytes[index])) return false;
  }
  return true;
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
    ...(style.fallbackFont ? { fallbackFont: style.fallbackFont } : {}),
    ...(style.underline ? { underline: true } : {}),
    ...(style.strike ? { strike: true } : {}),
    ...(style.background ? { background: style.background } : {}),
    ...(style.backgroundPaddingX !== undefined
      ? { backgroundPaddingX: style.backgroundPaddingX }
      : {}),
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

function mapWinAnsi(codePoint: number): number | null {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return codePoint;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint;

  switch (codePoint) {
    case 0x0152:
      return 0x8c;
    case 0x0153:
      return 0x9c;
    case 0x0160:
      return 0x8a;
    case 0x0161:
      return 0x9a;
    case 0x0178:
      return 0x9f;
    case 0x017d:
      return 0x8e;
    case 0x017e:
      return 0x9e;
    case 0x0192:
      return 0x83;
    case 0x02c6:
      return 0x88;
    case 0x02dc:
      return 0x98;
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
    case 0x201a:
      return 0x82;
    case 0x201e:
      return 0x84;
    case 0x2022:
      return 0x95;
    case 0x2026:
      return 0x85;
    case 0x2030:
      return 0x89;
    case 0x2039:
      return 0x8b;
    case 0x203a:
      return 0x9b;
    case 0x20ac:
      return 0x80;
    case 0x2122:
      return 0x99;
    default:
      return null;
  }
}

function isPdfTextIgnorable(codePoint: number): boolean {
  return (
    codePoint === 0x200d ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

function pdfDisplayByteForCodePoint(codePoint: number): number | null {
  if (isPdfTextIgnorable(codePoint)) return null;
  return mapWinAnsi(codePoint) ?? 0x3f;
}

type PdfEncodedTextSegment = {
  kind: 'base' | 'embedded';
  font?: PdfEmbeddedTextFont;
  hex: string;
  width: number;
  actualHex?: string;
};

function asciiWidth(byte: number, font: PdfFont): number {
  if (font === 'mono') return 0.6;
  const widths = font === 'bold' || font === 'boldItalic'
    ? HELVETICA_BOLD_WIDTHS
    : HELVETICA_WIDTHS;
  return widths[byte] ?? (byte === 0x20 ? 0.278 : 0.556);
}

function appendUtf16BeHex(hex: string, codePoint: number): string {
  if (codePoint <= 0xffff) {
    return hex + HEX[(codePoint >>> 8) & 0xff] + HEX[codePoint & 0xff];
  }
  const value = codePoint - 0x10000;
  const high = 0xd800 + (value >>> 10);
  const low = 0xdc00 + (value & 0x3ff);
  return (
    hex +
    HEX[(high >>> 8) & 0xff] +
    HEX[high & 0xff] +
    HEX[(low >>> 8) & 0xff] +
    HEX[low & 0xff]
  );
}

function embeddedGlyphForCodePoint(style: PdfTextStyle, codePoint: number): { font: PdfEmbeddedTextFont; glyphId: number } | null {
  const font = style.fallbackFont;
  if (!font || mapWinAnsi(codePoint) !== null) return null;
  const glyphId = font.glyphs.get(codePoint);
  return glyphId !== undefined && glyphId > 0 ? { font, glyphId } : null;
}

function appendFourDigitHex(hex: string, value: number): string {
  return hex + HEX[(value >>> 8) & 0xff] + HEX[value & 0xff];
}

function encodePdfTextSegments(bytes: Uint8Array, s: number, e: number, style: PdfTextStyle): PdfEncodedTextSegment[] {
  const segments: PdfEncodedTextSegment[] = [];
  let kind: 'base' | 'embedded' | null = null;
  let font: PdfEmbeddedTextFont | undefined;
  let hex = '';
  let actualHex = 'FEFF';
  let needsActual = false;
  let width = 0;

  const flush = (): void => {
    if (!kind || hex.length === 0) return;
    segments.push({
      kind,
      ...(font ? { font } : {}),
      hex,
      width,
      ...(needsActual ? { actualHex } : {}),
    });
    kind = null;
    font = undefined;
    hex = '';
    actualHex = 'FEFF';
    needsActual = false;
    width = 0;
  };

  const ensureSegment = (nextKind: 'base' | 'embedded', nextFont?: PdfEmbeddedTextFont): void => {
    if (kind === nextKind && font === nextFont) return;
    flush();
    kind = nextKind;
    font = nextFont;
  };

  let i = s;
  while (i < e) {
    const byte = bytes[i];
    if (byte < 0x80) {
      const mapped = byte < 0x20 ? (isAsciiWhitespace(byte) ? 0x20 : 0x3f) : byte;
      ensureSegment('base');
      hex += HEX[mapped];
      actualHex = appendUtf16BeHex(actualHex, mapped);
      needsActual ||= mapped !== byte;
      width += asciiWidth(isAsciiWhitespace(mapped) ? 0x20 : mapped, style.font) * style.size;
      i++;
      continue;
    }

    const decoded = readUtf8CodePoint(bytes, i, e);
    if (isPdfTextIgnorable(decoded.codePoint)) {
      actualHex = appendUtf16BeHex(actualHex, decoded.codePoint);
      needsActual = true;
      i = decoded.next;
      continue;
    }

    const embedded = embeddedGlyphForCodePoint(style, decoded.codePoint);
    if (embedded) {
      ensureSegment('embedded', embedded.font);
      hex = appendFourDigitHex(hex, embedded.glyphId);
      actualHex = appendUtf16BeHex(actualHex, decoded.codePoint);
      needsActual = true;
      width += (embedded.font.widths[embedded.glyphId] ?? 1000) * style.size / 1000;
      embedded.font.usedGlyphs.set(embedded.glyphId, decoded.codePoint);
      i = decoded.next;
      continue;
    }

    ensureSegment('base');
    actualHex = appendUtf16BeHex(actualHex, decoded.codePoint);
    needsActual = true;
    const mapped = pdfDisplayByteForCodePoint(decoded.codePoint);
    if (mapped !== null) {
      hex += HEX[mapped];
      width += asciiWidth(mapped, style.font) * style.size;
    }
    i = decoded.next;
  }
  flush();
  return segments;
}

function measureTextSpan(bytes: Uint8Array, s: number, e: number, style: PdfTextStyle): number {
  return encodePdfTextSegments(bytes, s, e, style).reduce((total, segment) => total + segment.width, 0);
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

function readInt16(bytes: Uint8Array, offset: number): number {
  const value = readUint16(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function normalizeFontBytes(input: Uint8Array | ArrayBuffer | undefined): Uint8Array | undefined {
  if (!input) return undefined;
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

function safePdfName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned || 'EmbeddedFont';
}

function readFontName(bytes: Uint8Array, tableOffset: number, tableLength: number): string | null {
  if (tableLength < 6 || tableOffset + tableLength > bytes.length) return null;
  const count = readUint16(bytes, tableOffset + 2);
  const stringOffset = tableOffset + readUint16(bytes, tableOffset + 4);
  for (let index = 0; index < count; index++) {
    const recordOffset = tableOffset + 6 + index * 12;
    if (recordOffset + 12 > tableOffset + tableLength) return null;
    const platformId = readUint16(bytes, recordOffset);
    const nameId = readUint16(bytes, recordOffset + 6);
    const length = readUint16(bytes, recordOffset + 8);
    const offset = readUint16(bytes, recordOffset + 10);
    const s = stringOffset + offset;
    const e = s + length;
    if (nameId !== 6 || e > tableOffset + tableLength) continue;
    if (platformId === 0 || platformId === 3) {
      const codeUnits: number[] = [];
      for (let i = s; i + 1 < e; i += 2) {
        codeUnits.push(readUint16(bytes, i));
      }
      return String.fromCharCode(...codeUnits);
    }
    return TD.decode(bytes.subarray(s, e));
  }
  return null;
}

function parseCmapFormat4(bytes: Uint8Array, offset: number, end: number, glyphs: Map<number, number>): void {
  if (offset + 16 > end) return;
  const length = readUint16(bytes, offset + 2);
  const tableEnd = Math.min(end, offset + length);
  const segCount = readUint16(bytes, offset + 6) / 2;
  const endCodeOffset = offset + 14;
  const startCodeOffset = endCodeOffset + segCount * 2 + 2;
  const idDeltaOffset = startCodeOffset + segCount * 2;
  const idRangeOffsetOffset = idDeltaOffset + segCount * 2;
  if (idRangeOffsetOffset + segCount * 2 > tableEnd) return;

  for (let segment = 0; segment < segCount; segment++) {
    const endCode = readUint16(bytes, endCodeOffset + segment * 2);
    const startCode = readUint16(bytes, startCodeOffset + segment * 2);
    const idDelta = readInt16(bytes, idDeltaOffset + segment * 2);
    const idRangeOffset = readUint16(bytes, idRangeOffsetOffset + segment * 2);
    if (startCode === 0xffff && endCode === 0xffff) continue;
    for (let codePoint = startCode; codePoint <= endCode; codePoint++) {
      let glyphId = 0;
      if (idRangeOffset === 0) {
        glyphId = (codePoint + idDelta) & 0xffff;
      } else {
        const glyphOffset = idRangeOffsetOffset + segment * 2 + idRangeOffset + (codePoint - startCode) * 2;
        if (glyphOffset + 2 > tableEnd) continue;
        const rawGlyphId = readUint16(bytes, glyphOffset);
        glyphId = rawGlyphId === 0 ? 0 : (rawGlyphId + idDelta) & 0xffff;
      }
      if (glyphId > 0) glyphs.set(codePoint, glyphId);
    }
  }
}

function parseCmapFormat12(bytes: Uint8Array, offset: number, end: number, glyphs: Map<number, number>): void {
  if (offset + 16 > end) return;
  const length = readUint32(bytes, offset + 4);
  const groupCount = readUint32(bytes, offset + 12);
  const tableEnd = Math.min(end, offset + length);
  let groupOffset = offset + 16;
  for (let group = 0; group < groupCount; group++) {
    if (groupOffset + 12 > tableEnd) return;
    const startCharCode = readUint32(bytes, groupOffset);
    const endCharCode = readUint32(bytes, groupOffset + 4);
    const startGlyphId = readUint32(bytes, groupOffset + 8);
    const count = endCharCode - startCharCode + 1;
    if (count <= 0 || count > 0x20000) {
      groupOffset += 12;
      continue;
    }
    for (let index = 0; index < count; index++) {
      glyphs.set(startCharCode + index, startGlyphId + index);
    }
    groupOffset += 12;
  }
}

function parseTrueTypeFont(
  input: Uint8Array | ArrayBuffer | undefined,
  resourceName: string,
  fallbackBaseFontName: string,
): PdfEmbeddedTextFont | undefined {
  const bytes = normalizeFontBytes(input);
  if (!bytes || bytes.length < 12) return undefined;
  const tableCount = readUint16(bytes, 4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let index = 0; index < tableCount; index++) {
    const recordOffset = 12 + index * 16;
    if (recordOffset + 16 > bytes.length) return undefined;
    const tag = TD.decode(bytes.subarray(recordOffset, recordOffset + 4));
    const offset = readUint32(bytes, recordOffset + 8);
    const length = readUint32(bytes, recordOffset + 12);
    if (offset + length > bytes.length) return undefined;
    tables.set(tag, { offset, length });
  }

  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const maxp = tables.get('maxp');
  const hmtx = tables.get('hmtx');
  const cmap = tables.get('cmap');
  if (!head || !hhea || !maxp || !hmtx || !cmap) return undefined;

  const unitsPerEm = readUint16(bytes, head.offset + 18) || 1000;
  const bbox: [number, number, number, number] = [
    readInt16(bytes, head.offset + 36),
    readInt16(bytes, head.offset + 38),
    readInt16(bytes, head.offset + 40),
    readInt16(bytes, head.offset + 42),
  ];
  const ascent = readInt16(bytes, hhea.offset + 4);
  const descent = readInt16(bytes, hhea.offset + 6);
  const numberOfHMetrics = readUint16(bytes, hhea.offset + 34);
  const glyphCount = readUint16(bytes, maxp.offset + 4);
  const widths = new Array<number>(glyphCount).fill(0);
  let lastAdvance = 0;
  for (let index = 0; index < glyphCount; index++) {
    if (index < numberOfHMetrics) {
      const metricOffset = hmtx.offset + index * 4;
      if (metricOffset + 2 > hmtx.offset + hmtx.length) return undefined;
      lastAdvance = readUint16(bytes, metricOffset);
    }
    widths[index] = Math.round((lastAdvance * 1000) / unitsPerEm);
  }

  const glyphs = new Map<number, number>();
  const cmapEnd = cmap.offset + cmap.length;
  const cmapTableCount = readUint16(bytes, cmap.offset + 2);
  const subtables: Array<{ format: number; offset: number; priority: number }> = [];
  for (let index = 0; index < cmapTableCount; index++) {
    const recordOffset = cmap.offset + 4 + index * 8;
    if (recordOffset + 8 > cmapEnd) return undefined;
    const platformId = readUint16(bytes, recordOffset);
    const encodingId = readUint16(bytes, recordOffset + 2);
    const subtableOffset = cmap.offset + readUint32(bytes, recordOffset + 4);
    if (subtableOffset + 2 > cmapEnd) continue;
    const format = readUint16(bytes, subtableOffset);
    const priority = platformId === 3 && encodingId === 10
      ? 0
      : platformId === 0
        ? 1
        : platformId === 3 && encodingId === 1
          ? 2
          : 3;
    subtables.push({ format, offset: subtableOffset, priority });
  }
  subtables.sort((a, b) => a.priority - b.priority);
  for (const subtable of subtables) {
    if (subtable.format === 12) {
      parseCmapFormat12(bytes, subtable.offset, cmapEnd, glyphs);
    } else if (subtable.format === 4) {
      parseCmapFormat4(bytes, subtable.offset, cmapEnd, glyphs);
    }
  }

  const name = tables.get('name');
  const baseFontName = safePdfName(
    (name ? readFontName(bytes, name.offset, name.length) : null) ?? fallbackBaseFontName,
  );
  return {
    resourceName,
    baseFontName,
    bytes,
    unitsPerEm,
    ascent,
    descent,
    bbox,
    glyphs,
    widths,
    usedGlyphs: new Map(),
  };
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
  private readonly continuationIndent: number;
  private lineIndex = 0;

  constructor(
    renderer: PdfBlockRenderer,
    x: number,
    maxWidth: number,
    lineHeight: number,
    continuationIndent = 0,
  ) {
    this.renderer = renderer;
    this.x = x;
    this.maxWidth = maxWidth;
    this.lineHeight = lineHeight;
    this.continuationIndent = Math.max(0, Math.min(continuationIndent, maxWidth - 1));
  }

  private currentMaxWidth(): number {
    return this.lineIndex === 0
      ? this.maxWidth
      : Math.max(1, this.maxWidth - this.continuationIndent);
  }

  addGenerated(text: string, style: PdfTextStyle): void {
    const bytes = TE.encode(text);
    this.addTextSpan(bytes, 0, bytes.length, style);
  }

  addSpace(style: PdfTextStyle): void {
    if (this.lineWidth === 0) return;
    this.pendingSpace = true;
    const spaceWidth = measureTextSpan(SPACE, 0, SPACE.length, style);
    if (this.lineWidth + spaceWidth > this.currentMaxWidth()) {
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
    const lineX = this.lineIndex === 0 ? this.x : this.x + this.continuationIndent;
    this.renderer.drawTextLine(this.line, lineX, this.lineHeight);
    this.line.length = 0;
    this.lineWidth = 0;
    this.pendingSpace = false;
    this.lineIndex++;
  }

  private addSegment(bytes: Uint8Array, s: number, e: number, style: PdfTextStyle): void {
    if (s >= e) return;
    const segmentWidth = measureTextSpan(bytes, s, e, style);
    const spaceWidth = this.pendingSpace && this.lineWidth > 0
      ? measureTextSpan(SPACE, 0, SPACE.length, style)
      : 0;
    let width = segmentWidth + spaceWidth;
    if (this.lineWidth > 0 && this.lineWidth + width > this.currentMaxWidth()) {
      this.flush();
      width = segmentWidth;
    }

    if (width > this.currentMaxWidth()) {
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
      if (this.lineWidth > 0 && this.lineWidth + width > this.currentMaxWidth()) {
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

function pushTextRun(
  runs: PdfTextRun[],
  bytes: Uint8Array,
  s: number,
  e: number,
  style: PdfTextStyle,
): void {
  if (s >= e) return;
  runs.push({
    bytes,
    s,
    e,
    style: cloneStyle(style),
    width: measureTextSpan(bytes, s, e, style),
  });
}

function pushGeneratedTextRun(runs: PdfTextRun[], text: string, style: PdfTextStyle): void {
  const bytes = TE.encode(text);
  pushTextRun(runs, bytes, 0, bytes.length, style);
}

function measureRuns(runs: readonly PdfTextRun[]): number {
  return runs.reduce((width, run) => width + run.width, 0);
}

function measureRunSlice(
  run: PdfTextRun,
  s: number,
  maxWidth: number,
  allowOversizedGlyph: boolean,
): { e: number; width: number } {
  let width = 0;
  let i = s;
  while (i < run.e) {
    const next = nextUtf8Index(run.bytes, i, run.e);
    const glyphWidth = measureTextSpan(run.bytes, i, next, run.style);
    if (width + glyphWidth > maxWidth) {
      if (i === s && allowOversizedGlyph) {
        return { e: next, width: glyphWidth };
      }
      break;
    }
    width += glyphWidth;
    i = next;
  }
  return { e: i, width };
}

function cloneRunSlice(run: PdfTextRun, s: number, e: number, width: number): PdfTextRun {
  return {
    bytes: run.bytes,
    s,
    e,
    style: cloneStyle(run.style),
    width,
  };
}

function wrapCodeRuns(runs: readonly PdfTextRun[], maxWidth: number): PdfTextRun[][] {
  const rows: PdfTextRun[][] = [];
  let row: PdfTextRun[] = [];
  let rowWidth = 0;

  const flush = (): void => {
    if (row.length === 0) return;
    rows.push(row);
    row = [];
    rowWidth = 0;
  };

  for (const run of runs) {
    let s = run.s;
    while (s < run.e) {
      const runWidth = s === run.s
        ? run.width
        : measureTextSpan(run.bytes, s, run.e, run.style);
      const capacity = maxWidth - rowWidth;

      if (rowWidth > 0 && runWidth > capacity) {
        const slice = measureRunSlice(run, s, capacity, false);
        if (slice.e > s) {
          row.push(cloneRunSlice(run, s, slice.e, slice.width));
          s = slice.e;
        }
        flush();
        continue;
      }

      if (rowWidth === 0 && runWidth > maxWidth) {
        const slice = measureRunSlice(run, s, maxWidth, true);
        row.push(cloneRunSlice(run, s, slice.e, slice.width));
        s = slice.e;
        flush();
        continue;
      }

      row.push(cloneRunSlice(run, s, run.e, runWidth));
      rowWidth += runWidth;
      break;
    }
  }

  flush();
  return rows;
}

function fitTableColumnWidths(
  desiredWidths: readonly number[],
  availableWidth: number,
  minColumnWidth: number,
): number[] {
  const columnCount = desiredWidths.length;
  if (columnCount === 0) return [];

  if (availableWidth <= minColumnWidth * columnCount) {
    return new Array(columnCount).fill(availableWidth / columnCount);
  }

  const desiredTotal = desiredWidths.reduce((sum, width) => sum + width, 0);
  if (desiredTotal <= availableWidth) {
    const extra = (availableWidth - desiredTotal) / columnCount;
    return desiredWidths.map((width) => width + extra);
  }

  const flex = desiredWidths.map((width) => Math.max(0, width - minColumnWidth));
  const flexTotal = flex.reduce((sum, width) => sum + width, 0);
  const flexibleWidth = availableWidth - minColumnWidth * columnCount;
  if (flexTotal <= 0) {
    return new Array(columnCount).fill(availableWidth / columnCount);
  }
  return desiredWidths.map((_, index) => minColumnWidth + flexibleWidth * (flex[index] / flexTotal));
}

function collectInlineRuns(
  markdown: Uint8Array,
  s: number,
  e: number,
  runs: PdfTextRun[],
  baseStyle: PdfTextStyle,
  options: PdfRenderOptions,
  urlAllowlist: (url: string) => boolean,
  baseUrl: string | undefined,
  depth = 0,
): void {
  const inlineParseOptions = options.allowRawHtml ? { allowRawHtml: true } : undefined;
  const styleStack: PdfTextStyle[] = [];
  let currentStyle = cloneStyle(baseStyle);
  let pendingTextStart = -1;
  let pendingTextEnd = -1;

  const flushText = (): void => {
    if (pendingTextStart >= 0 && pendingTextEnd > pendingTextStart) {
      pushTextRun(runs, markdown, pendingTextStart, pendingTextEnd, currentStyle);
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
        pushTextRun(runs, markdown, tok.s, tok.e, mergeStyle(currentStyle, {
          font: 'mono',
          size: Math.max(8, currentStyle.size * 0.9),
          color: documentColor(options, 'inlineCodeText'),
          background: documentColor(options, 'inlineCodeBackground'),
          backgroundPaddingX: Math.max(1.5, currentStyle.size * 0.22),
        }));
        break;

      case 'img':
        flushText();
        pushGeneratedTextRun(runs, '[image', mergeStyle(currentStyle, { font: 'italic', color: documentColor(options, 'textSecondary') }));
        if (tok.altE > tok.altS) {
          pushGeneratedTextRun(runs, ': ', mergeStyle(currentStyle, { font: 'italic', color: documentColor(options, 'textSecondary') }));
          pushTextRun(runs, markdown, tok.altS, tok.altE, mergeStyle(currentStyle, {
            font: 'italic',
            color: documentColor(options, 'textSecondary'),
          }));
        }
        pushGeneratedTextRun(runs, ']', mergeStyle(currentStyle, { font: 'italic', color: documentColor(options, 'textSecondary') }));
        break;

      case 'link': {
        flushText();
        const href = TD.decode(markdown.subarray(tok.hrefS, tok.hrefE));
        const resolvedHref = resolveUrlRelativeToBase(href, baseUrl);
        const linkStyle = urlAllowlist(resolvedHref)
          ? mergeStyle(currentStyle, { color: documentColor(options, 'accent'), underline: true })
          : currentStyle;
        if (depth < 8) {
          collectInlineRuns(markdown, tok.textS, tok.textE, runs, linkStyle, options, urlAllowlist, baseUrl, depth + 1);
        } else {
          pushTextRun(runs, markdown, tok.textS, tok.textE, linkStyle);
        }
        break;
      }

      case 'autolink':
        flushText();
        pushTextRun(runs, markdown, tok.s, tok.e, mergeStyle(currentStyle, {
          color: documentColor(options, 'accent'),
          underline: true,
        }));
        break;

      case 'footnoteRef':
        flushText();
        pushGeneratedTextRun(runs, '[', mergeStyle(currentStyle, { size: currentStyle.size * 0.75, color: documentColor(options, 'accent') }));
        pushTextRun(runs, markdown, tok.idS, tok.idE, mergeStyle(currentStyle, {
          size: currentStyle.size * 0.75,
          color: documentColor(options, 'accent'),
        }));
        pushGeneratedTextRun(runs, ']', mergeStyle(currentStyle, { size: currentStyle.size * 0.75, color: documentColor(options, 'accent') }));
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

class PdfBlockRenderer {
  readonly pages: PdfPage[] = [];
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private readonly margin: number;
  private readonly baseFontSize: number;
  private readonly lineHeightMultiplier: number;
  private readonly contentWidth: number;
  private readonly contentLeft: number;
  private readonly colors: ResolvedPdfDocumentStyle;
  private readonly urlAllowlist: (url: string) => boolean;
  private readonly baseUrl: string | undefined;
  private currentPage: PdfPage;
  private cursorY = 0;
  private indent = 0;
  private para: PdfLineComposer | null = null;
  private inCode = false;
  private codeLang: string | undefined;
  private codeBuffer: CodeBlockSourceSpan[] | null = null;
  private tableBuffer: PdfTableBuffer | null = null;
  private listStack: ListFrame[] = [];
  private readonly blockquoteStack: PdfContainerFrame[] = [];
  private readonly infoStack: PdfInfoFrame[] = [];
  private readonly options: PdfRenderOptions;
  private readonly emojiFont: PdfEmbeddedTextFont | undefined;
  private readonly images: PdfEmbeddedImage[] = [];
  private readonly imageByKey = new Map<string, PdfEmbeddedImage>();
  private readonly imagePromises = new Map<string, Promise<PdfEmbeddedImage | null>>();

  constructor(options: PdfRenderOptions) {
    this.options = options;
    this.emojiFont = parseTrueTypeFont(options.emojiFont, 'FE1', 'NotoEmoji');
    const page = resolvePageSize(options.pageSize);
    this.pageWidth = page.width;
    this.pageHeight = page.height;
    this.margin = Math.max(24, options.margin ?? 54);
    this.baseFontSize = Math.max(8, options.fontSize ?? 11.5);
    this.lineHeightMultiplier = Math.max(1.1, options.lineHeight ?? 1.58);
    const availableWidth = Math.max(120, this.pageWidth - this.margin * 2);
    this.contentWidth = Math.min(availableWidth, Math.max(120, options.maxContentWidth ?? availableWidth));
    this.contentLeft = (this.pageWidth - this.contentWidth) / 2;
    this.colors = resolveDocumentStyle(options.documentStyle);
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
          this.openBlockquote();
          break;

        case 'bqClose':
          this.closeBlockquote();
          break;

        case 'hr':
          this.closeParagraph();
          this.drawRule();
          break;

        case 'heading': {
          this.closeParagraph();
          const size = this.headingSize(ev.level);
          const before = size * (ev.level <= 2 ? 0.55 : 0.4);
          const lineHeight = size * 1.16;
          const after = size * 0.28;
          this.ensureSpace(before + lineHeight + after + this.baseFontSize * this.lineHeightMultiplier * 2);
          this.addVerticalSpace(before);
          const style = this.style({ font: 'bold', size, color: this.colors.text });
          const line = this.createLine(lineHeight);
          renderInlineRange(markdown, ev.s, ev.e, line, style, this.options, this.urlAllowlist, this.baseUrl, imageRenderer);
          line.flush();
          if (ev.level === 2) this.drawHeadingRule();
          this.addVerticalSpace(after);
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
          this.openCodeBlock(ev.info?.lang ?? ev.info?.rawLang);
          break;

        case 'codeText':
          if (this.inCode) {
            this.codeBuffer?.push({ s: ev.s, e: ev.e });
          }
          break;

        case 'codeClose':
          if (this.inCode) {
            this.closeCodeBlock(markdown);
          }
          break;

        case 'tableOpen':
          this.closeParagraph();
          this.beginTable();
          break;

        case 'tableHeader':
          this.addTableHeader(ev.cells);
          break;

        case 'tableRow':
          this.addTableRow(ev.cells);
          break;

        case 'tableClose':
          this.finishTable(markdown);
          this.addVerticalSpace(this.baseFontSize * 0.6);
          break;

        case 'infoOpen':
          this.openInfo(ev.infoType);
          break;

        case 'infoClose':
          this.closeInfo();
          break;

        case 'footnoteDef':
          this.closeParagraph();
          this.renderFootnote(markdown, ev.idS, ev.idE, ev.contentS, ev.contentE);
          break;
      }
    }

    this.finishTable(markdown);
    this.closeParagraph();
    return buildPdfFile(this.pages, this.pageWidth, this.pageHeight, this.images, this.embeddedFonts());
  }

  async renderAsync(markdown: Uint8Array): Promise<Uint8Array> {
    const blockParseOptions = this.options.allowRawHtml ? { allowRawHtml: true } : undefined;
    const imageRenderer: PdfInlineImageRendererAsync = async (token, line, style) =>
      await this.renderInlineImageAsync(markdown, token, line, style);

    for (const ev of blocks(markdown, blockParseOptions)) {
      switch (ev.type) {
        case 'bqOpen':
          this.openBlockquote();
          break;

        case 'bqClose':
          this.closeBlockquote();
          break;

        case 'hr':
          this.closeParagraph();
          this.drawRule();
          break;

        case 'heading': {
          this.closeParagraph();
          const size = this.headingSize(ev.level);
          const before = size * (ev.level <= 2 ? 0.55 : 0.4);
          const lineHeight = size * 1.16;
          const after = size * 0.28;
          this.ensureSpace(before + lineHeight + after + this.baseFontSize * this.lineHeightMultiplier * 2);
          this.addVerticalSpace(before);
          const style = this.style({ font: 'bold', size, color: this.colors.text });
          const line = this.createLine(lineHeight);
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
          if (ev.level === 2) this.drawHeadingRule();
          this.addVerticalSpace(after);
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
          this.openCodeBlock(ev.info?.lang ?? ev.info?.rawLang);
          break;

        case 'codeText':
          if (this.inCode) {
            this.codeBuffer?.push({ s: ev.s, e: ev.e });
          }
          break;

        case 'codeClose':
          if (this.inCode) {
            this.closeCodeBlock(markdown);
          }
          break;

        case 'tableOpen':
          this.closeParagraph();
          this.beginTable();
          break;

        case 'tableHeader':
          this.addTableHeader(ev.cells);
          break;

        case 'tableRow':
          this.addTableRow(ev.cells);
          break;

        case 'tableClose':
          this.finishTable(markdown);
          this.addVerticalSpace(this.baseFontSize * 0.6);
          break;

        case 'infoOpen':
          this.openInfo(ev.infoType);
          break;

        case 'infoClose':
          this.closeInfo();
          break;

        case 'footnoteDef':
          this.closeParagraph();
          await this.renderFootnoteAsync(markdown, ev.idS, ev.idE, ev.contentS, ev.contentE, imageRenderer);
          break;
      }
    }

    this.finishTable(markdown);
    this.closeParagraph();
    return buildPdfFile(this.pages, this.pageWidth, this.pageHeight, this.images, this.embeddedFonts());
  }

  private embeddedFonts(): PdfEmbeddedTextFont[] {
    return this.emojiFont && this.emojiFont.usedGlyphs.size > 0 ? [this.emojiFont] : [];
  }

  drawTextLine(runs: readonly PdfTextRun[], x: number, lineHeight: number): void {
    const maxSize = runs.reduce((size, run) => Math.max(size, run.style.size), this.baseFontSize);
    this.ensureSpace(lineHeight);
    this.decorateVerticalSlice(this.cursorY, this.cursorY - lineHeight);
    const baseline = this.cursorY - maxSize;
    this.drawTextRunsAt(runs, x, baseline);
    this.cursorY -= lineHeight;
  }

  private drawTextRunsAt(runs: readonly PdfTextRun[], x: number, baseline: number): void {
    let cursorX = x;
    const decorations: Array<{ run: PdfTextRun; x1: number; x2: number; baseline: number }> = [];
    const content = this.currentPage.content;

    let backgroundX = x;
    for (const run of runs) {
      const backgroundPaddingX = run.style.backgroundPaddingX ?? 0;
      if (run.style.background && run.s < run.e) {
        this.fillRect(
          backgroundX - backgroundPaddingX,
          baseline - run.style.size * 0.24,
          run.width + backgroundPaddingX * 2,
          run.style.size * 1.22,
          run.style.background,
        );
      }
      backgroundX += run.width;
    }

    for (const run of runs) {
      if (run.s >= run.e) continue;
      const segments = encodePdfTextSegments(run.bytes, run.s, run.e, run.style);
      const runStartX = cursorX;
      for (const segment of segments) {
        if (segment.hex.length === 0) continue;
        const fontId = segment.kind === 'embedded' && segment.font
          ? segment.font.resourceName
          : FONT_IDS[run.style.font];
        if (segment.actualHex) {
          content.writeAscii(`/Span << /ActualText <${segment.actualHex}> >> BDC\n`);
        }
        content.writeAscii('BT\n');
        content.writeAscii(`/${fontId} ${formatNumber(run.style.size)} Tf\n`);
        content.writeAscii(`${colorCommand(run.style.color, 'rg')}\n`);
        content.writeAscii(`1 0 0 1 ${formatNumber(cursorX)} ${formatNumber(baseline)} Tm\n<${segment.hex}> Tj\n`);
        content.writeAscii('ET\n');
        if (segment.actualHex) {
          content.writeAscii('EMC\n');
        }
        cursorX += segment.width;
      }
      if (run.style.underline || run.style.strike) {
        decorations.push({ run, x1: runStartX, x2: cursorX, baseline });
      }
    }

    for (const decoration of decorations) {
      if (decoration.run.style.underline) {
        this.drawLine(
          decoration.x1,
          decoration.baseline - decoration.run.style.size * 0.18,
          decoration.x2,
          decoration.baseline - decoration.run.style.size * 0.18,
          this.colors.accent,
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

    const trailingGap = this.baseFontSize * 0.45;
    this.ensureSpace(drawHeight + this.baseFontSize * 0.6);
    const x = this.contentLeft + this.indent;
    const y = this.cursorY - drawHeight;
    this.decorateVerticalSlice(this.cursorY, y - trailingGap);
    this.currentPage.content.writeAscii(
      `q ${formatNumber(drawWidth)} 0 0 ${formatNumber(drawHeight)} ${formatNumber(x)} ${formatNumber(y)} cm /${image.name} Do Q\n`,
    );
    this.cursorY = y - trailingGap;
  }

  private createPage(): PdfPage {
    const page = { content: new PdfByteWriter() };
    if (this.colors && !this.isWhite(this.colors.pageBackground)) {
      page.content.writeAscii(
        `q ${colorCommand(this.colors.pageBackground, 'rg')} 0 0 ${formatNumber(this.pageWidth)} ${formatNumber(this.pageHeight)} re f Q\n`,
      );
    }
    this.pages.push(page);
    this.cursorY = this.pageHeight - this.margin;
    return page;
  }

  private ensureSpace(height: number): boolean {
    if (this.cursorY - height >= this.margin) return false;
    this.currentPage = this.createPage();
    return true;
  }

  private addVerticalSpace(height: number): void {
    if (height <= 0) return;
    if (this.cursorY - height < this.margin) {
      this.cursorY = this.margin;
      return;
    }
    this.decorateVerticalSlice(this.cursorY, this.cursorY - height);
    this.cursorY -= height;
  }

  private createLine(
    lineHeight = this.baseFontSize * this.lineHeightMultiplier,
    continuationIndent = 0,
  ): PdfLineComposer {
    const x = this.contentLeft + this.indent;
    const width = Math.max(80, this.contentWidth - this.indent);
    return new PdfLineComposer(this, x, width, lineHeight, continuationIndent);
  }

  private ensureParagraph(): PdfLineComposer {
    if (!this.para) {
      const lineHeight = this.baseFontSize * this.lineHeightMultiplier;
      this.ensureSpace(lineHeight * 2 + this.baseFontSize * 0.7);
      this.para = this.createLine(lineHeight);
    }
    return this.para;
  }

  private closeParagraph(): void {
    if (!this.para) return;
    this.para.flush();
    this.para = null;
    this.addVerticalSpace(this.baseFontSize * 0.72);
  }

  private style(patch: Partial<PdfTextStyle> = {}): PdfTextStyle {
    return mergeStyle(
      {
        font: 'regular',
        size: this.baseFontSize,
        color: this.blockquoteStack.length > 0 ? this.colors.blockquoteText : this.colors.textSecondary,
        ...(this.emojiFont ? { fallbackFont: this.emojiFont } : {}),
      },
      patch,
    );
  }

  private headingSize(level: number): number {
    const scale = [2.45, 1.72, 1.36, 1.18, 1.06, 1] as const;
    const index = Math.max(0, Math.min(scale.length - 1, level - 1));
    return this.baseFontSize * scale[index];
  }

  private drawRule(): void {
    const gap = this.baseFontSize * 0.8;
    this.ensureSpace(gap * 2);
    const y = this.cursorY - gap;
    const x1 = this.contentLeft + this.indent;
    const x2 = this.contentLeft + this.contentWidth;
    this.decorateVerticalSlice(this.cursorY, this.cursorY - gap * 2);
    this.drawLine(x1, y, x2, y, this.colors.border, 0.8);
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

  private isWhite(color: PdfColor): boolean {
    return color[0] >= 0.999 && color[1] >= 0.999 && color[2] >= 0.999;
  }

  private infoColors(kind: PdfInfoKind): { background: PdfColor; border: PdfColor } {
    switch (kind) {
      case 'warning':
        return { background: this.colors.warningBackground, border: this.colors.warningBorder };
      case 'error':
        return { background: this.colors.errorBackground, border: this.colors.errorBorder };
      case 'success':
        return { background: this.colors.successBackground, border: this.colors.successBorder };
      default:
        return { background: this.colors.infoBackground, border: this.colors.infoBorder };
    }
  }

  private decorateVerticalSlice(top: number, bottom: number): void {
    const height = top - bottom;
    if (height <= 0) return;

    for (const frame of this.infoStack) {
      const colors = this.infoColors(frame.kind);
      this.fillRect(frame.x, bottom, frame.width, height, colors.background);
      this.fillRect(frame.x, bottom, 3, height, colors.border);
      this.drawLine(frame.x + frame.width, bottom, frame.x + frame.width, top, colors.border, 0.45);
    }
    for (const frame of this.blockquoteStack) {
      this.fillRect(frame.x, bottom, 2.5, height, this.colors.blockquoteBorder);
    }
  }

  private openBlockquote(): void {
    this.closeParagraph();
    this.addVerticalSpace(this.baseFontSize * 0.8);
    this.blockquoteStack.push({
      x: this.contentLeft + this.indent,
      width: Math.max(80, this.contentWidth - this.indent),
    });
    this.indent += INDENT * 0.7;
    this.addVerticalSpace(this.baseFontSize * 0.25);
  }

  private closeBlockquote(): void {
    this.closeParagraph();
    if (this.blockquoteStack.length === 0) return;
    this.addVerticalSpace(this.baseFontSize * 0.2);
    this.blockquoteStack.pop();
    this.indent = Math.max(0, this.indent - INDENT * 0.7);
    this.addVerticalSpace(this.baseFontSize * 0.75);
  }

  private openInfo(kind: PdfInfoKind): void {
    this.closeParagraph();
    this.addVerticalSpace(this.baseFontSize * 0.85);
    const frame: PdfInfoFrame = {
      kind,
      x: this.contentLeft + this.indent,
      width: Math.max(80, this.contentWidth - this.indent),
    };
    this.infoStack.push(frame);
    const colors = this.infoColors(kind);
    const topY = this.cursorY;
    this.indent += INDENT * 0.72;
    this.addVerticalSpace(this.baseFontSize * 0.72);
    this.drawLine(frame.x, topY, frame.x + frame.width, topY, colors.border, 0.55);
    this.renderInfoLabel(kind.toUpperCase(), colors.border);
  }

  private closeInfo(): void {
    this.closeParagraph();
    const frame = this.infoStack[this.infoStack.length - 1];
    if (!frame) return;
    this.addVerticalSpace(this.baseFontSize * 0.45);
    const colors = this.infoColors(frame.kind);
    this.drawLine(frame.x, this.cursorY, frame.x + frame.width, this.cursorY, colors.border, 0.55);
    this.infoStack.pop();
    this.indent = Math.max(0, this.indent - INDENT * 0.72);
    this.addVerticalSpace(this.baseFontSize * 0.8);
  }

  private drawHeadingRule(): void {
    const x1 = this.contentLeft + this.indent;
    this.drawLine(x1, this.cursorY + 1, this.contentLeft + this.contentWidth, this.cursorY + 1, this.colors.border, 0.65);
  }

  private codeColor(kind: HighlightTokenKind): PdfColor {
    if (kind === 'text') return this.options.codeColors?.id ?? this.colors.text;
    if (kind === 'id') return this.options.codeColors?.id ?? this.colors.text;
    if (kind === 'com') return this.options.codeColors?.com ?? this.colors.textSecondary;
    return this.options.codeColors?.[kind] ?? CODE_COLORS[kind];
  }

  private renderListItem(
    markdown: Uint8Array,
    ev: { s: number; e: number; task?: boolean; checked?: boolean },
  ): void {
    const top = this.listStack[this.listStack.length - 1];
    let marker = '• ';
    if (top?.kind === 'ol') {
      marker = `${top.counter}. `;
      top.counter += 1;
    }
    if (ev.task) {
      marker += ev.checked ? '[x] ' : '[ ] ';
    }
    const markerStyle = this.style({ font: 'bold', color: this.colors.accent });
    const markerBytes = TE.encode(marker);
    const markerWidth = measureTextSpan(markerBytes, 0, markerBytes.length, markerStyle);
    const line = this.createLine(this.baseFontSize * this.lineHeightMultiplier, markerWidth);
    line.addGenerated(marker, markerStyle);
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
    this.addVerticalSpace(this.baseFontSize * 0.18);
  }

  private async renderListItemAsync(
    markdown: Uint8Array,
    ev: { s: number; e: number; task?: boolean; checked?: boolean },
    imageRenderer: PdfInlineImageRendererAsync,
  ): Promise<void> {
    const top = this.listStack[this.listStack.length - 1];
    let marker = '• ';
    if (top?.kind === 'ol') {
      marker = `${top.counter}. `;
      top.counter += 1;
    }
    if (ev.task) {
      marker += ev.checked ? '[x] ' : '[ ] ';
    }
    const markerStyle = this.style({ font: 'bold', color: this.colors.accent });
    const markerBytes = TE.encode(marker);
    const markerWidth = measureTextSpan(markerBytes, 0, markerBytes.length, markerStyle);
    const line = this.createLine(this.baseFontSize * this.lineHeightMultiplier, markerWidth);
    line.addGenerated(marker, markerStyle);
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
    this.addVerticalSpace(this.baseFontSize * 0.18);
  }

  private renderRawLine(markdown: Uint8Array, s: number, e: number): void {
    const line = this.createLine(this.baseFontSize * this.lineHeightMultiplier);
    line.addTextSpan(markdown, s, e, this.style({ color: this.colors.textSecondary }));
    line.flush();
  }

  private openCodeBlock(lang: string | undefined): void {
    this.closeParagraph();
    this.addVerticalSpace(this.baseFontSize * 0.85);
    this.inCode = true;
    this.codeLang = lang;
    this.codeBuffer = [];
  }

  private codeRunsForBlockLine(
    bytes: Uint8Array,
    line: Readonly<{ s: number; e: number }>,
    tokens: readonly HighlightTokenSpan[] | null,
    startTokenIndex: number,
    codeStyle: PdfTextStyle,
  ): { runs: PdfTextRun[]; tokenIndex: number } {
    const runs: PdfTextRun[] = [];
    if (!tokens) {
      pushTextRun(runs, bytes, line.s, line.e, codeStyle);
      return { runs, tokenIndex: startTokenIndex };
    }

    let tokenIndex = startTokenIndex;
    while (tokenIndex < tokens.length && tokens[tokenIndex].e <= line.s) tokenIndex++;
    let cursor = line.s;
    let pendingWhitespaceStart = -1;
    let index = tokenIndex;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token.s >= line.e) break;
      const tokenStart = Math.max(line.s, token.s);
      const tokenEnd = Math.min(line.e, token.e);

      if (tokenStart > cursor) {
        if (isWhitespaceSpan(bytes, cursor, tokenStart)) {
          if (pendingWhitespaceStart < 0) pendingWhitespaceStart = cursor;
        } else {
          const runStart = pendingWhitespaceStart >= 0 ? pendingWhitespaceStart : cursor;
          pushTextRun(runs, bytes, runStart, tokenStart, codeStyle);
          pendingWhitespaceStart = -1;
        }
      }

      if (isWhitespaceSpan(bytes, tokenStart, tokenEnd)) {
        if (pendingWhitespaceStart < 0) pendingWhitespaceStart = tokenStart;
      } else {
        const tokenStyle = mergeStyle(codeStyle, { color: this.codeColor(token.kind) });
        const runStart = pendingWhitespaceStart >= 0 ? pendingWhitespaceStart : tokenStart;
        pushTextRun(runs, bytes, runStart, tokenEnd, tokenStyle);
        pendingWhitespaceStart = -1;
      }
      cursor = Math.max(cursor, tokenEnd);
      if (token.e <= line.e) index++;
      else break;
    }

    if (cursor < line.e) {
      const runStart = pendingWhitespaceStart >= 0 ? pendingWhitespaceStart : cursor;
      pushTextRun(runs, bytes, runStart, line.e, codeStyle);
    } else if (pendingWhitespaceStart >= 0) {
      pushTextRun(runs, bytes, pendingWhitespaceStart, line.e, codeStyle);
    }
    return { runs, tokenIndex: index };
  }

  private closeCodeBlock(markdown: Uint8Array): void {
    const block = bufferCodeBlock(markdown, this.codeBuffer ?? []);
    const tokens = tokenizeCodeBlock(block.bytes, this.codeLang);
    const codeStyle = this.style({
      font: 'mono',
      size: Math.max(8, this.baseFontSize * 0.88),
      color: this.options.codeColors?.id ?? this.colors.text,
    });
    const blockX = this.contentLeft + this.indent;
    const blockWidth = Math.max(80, this.contentWidth - this.indent);
    const paddingX = Math.max(9, this.baseFontSize * 0.95);
    const paddingY = Math.max(7, this.baseFontSize * 0.72);
    const lineHeight = codeStyle.size * 1.55;
    const innerWidth = Math.max(24, blockWidth - paddingX * 2);
    const rows: PdfTextRun[][] = [];
    let tokenIndex = 0;

    const logicalLines = block.lines.length > 0 ? block.lines : [{ s: 0, e: 0 }];
    for (const line of logicalLines) {
      if (line.s >= line.e || isWhitespaceSpan(block.bytes, line.s, line.e)) {
        rows.push([]);
        if (tokens) {
          while (tokenIndex < tokens.length && tokens[tokenIndex].e <= line.e) tokenIndex++;
        }
        continue;
      }
      const result = this.codeRunsForBlockLine(block.bytes, line, tokens, tokenIndex, codeStyle);
      tokenIndex = result.tokenIndex;
      const wrapped = wrapCodeRuns(result.runs, innerWidth);
      if (wrapped.length === 0) rows.push([]);
      else rows.push(...wrapped);
    }

    const usableHeight = this.pageHeight - this.margin * 2;
    const totalHeight = rows.length * lineHeight + paddingY * 2;
    if (totalHeight <= usableHeight) this.ensureSpace(totalHeight);

    let rowIndex = 0;
    while (rowIndex < rows.length) {
      const available = this.cursorY - this.margin;
      let rowsOnPage = Math.floor((available - paddingY * 2) / lineHeight);
      if (rowsOnPage < 1) {
        this.currentPage = this.createPage();
        continue;
      }
      rowsOnPage = Math.min(rowsOnPage, rows.length - rowIndex);
      const segmentHeight = rowsOnPage * lineHeight + paddingY * 2;
      const topY = this.cursorY;
      const bottomY = topY - segmentHeight;
      this.decorateVerticalSlice(topY, bottomY);
      this.fillRect(blockX, bottomY, blockWidth, segmentHeight, this.colors.codeBackground);
      this.drawLine(blockX, topY, blockX + blockWidth, topY, this.colors.codeBorder, 0.65);
      this.drawLine(blockX, bottomY, blockX + blockWidth, bottomY, this.colors.codeBorder, 0.65);
      this.drawLine(blockX, bottomY, blockX, topY, this.colors.codeBorder, 0.65);
      this.drawLine(blockX + blockWidth, bottomY, blockX + blockWidth, topY, this.colors.codeBorder, 0.65);

      for (let offset = 0; offset < rowsOnPage; offset++) {
        const row = rows[rowIndex + offset];
        if (row.length === 0) continue;
        const baseline = topY - paddingY - offset * lineHeight - codeStyle.size;
        this.drawTextRunsAt(row, blockX + paddingX, baseline);
      }
      this.cursorY = bottomY;
      rowIndex += rowsOnPage;
      if (rowIndex < rows.length) this.currentPage = this.createPage();
    }

    this.inCode = false;
    this.codeLang = undefined;
    this.codeBuffer = null;
    this.addVerticalSpace(this.baseFontSize * 0.85);
  }

  private beginTable(): void {
    this.finishTable();
    this.addVerticalSpace(this.baseFontSize * 0.4);
    this.tableBuffer = { alignments: [], rows: [] };
  }

  private addTableHeader(cells: ReadonlyArray<{ s: number; e: number; align: PdfTableAlign }>): void {
    if (!this.tableBuffer) this.beginTable();
    const alignments = cells.map((cell) => cell.align);
    this.tableBuffer!.alignments = alignments;
    this.tableBuffer!.rows.push({
      header: true,
      cells: cells.map((cell) => ({
        s: cell.s,
        e: cell.e,
        align: cell.align,
      })),
    });
  }

  private addTableRow(cells: ReadonlyArray<{ s: number; e: number }>): void {
    if (!this.tableBuffer) this.beginTable();
    const alignments = this.tableBuffer!.alignments;
    this.tableBuffer!.rows.push({
      header: false,
      cells: cells.map((cell, index) => ({
        s: cell.s,
        e: cell.e,
        align: alignments[index] ?? 'left',
      })),
    });
  }

  private finishTable(markdown?: Uint8Array): void {
    if (!this.tableBuffer) return;
    const table = this.tableBuffer;
    this.tableBuffer = null;
    if (markdown && table.rows.length > 0) {
      this.renderTable(markdown, table);
    }
  }

  private renderTable(markdown: Uint8Array, table: PdfTableBuffer): void {
    const columnCount = Math.max(1, ...table.rows.map((row) => row.cells.length));
    const tableX = this.contentLeft + this.indent;
    const tableWidth = Math.max(80, this.contentWidth - this.indent);
    const paddingX = Math.max(4, this.baseFontSize * 0.45);
    const paddingY = Math.max(3, this.baseFontSize * 0.3);
    const lineHeight = this.baseFontSize * 1.2;
    const minColumnWidth = Math.max(24, Math.min(72, tableWidth / columnCount));
    const desiredWidths = new Array<number>(columnCount).fill(minColumnWidth);

    const cellRuns = table.rows.map((row) =>
      Array.from({ length: columnCount }, (_, index) => {
        const cell = row.cells[index] ?? {
          s: 0,
          e: 0,
          align: table.alignments[index] ?? 'left',
        };
        const style = this.style({
          font: row.header ? 'bold' : 'regular',
          size: this.baseFontSize * 0.88,
          color: row.header ? this.colors.text : this.colors.textSecondary,
        });
        const runs = this.tableCellRuns(markdown, cell.s, cell.e, style);
        desiredWidths[index] = Math.max(desiredWidths[index], measureRuns(runs) + paddingX * 2);
        return {
          align: cell.align ?? table.alignments[index] ?? 'left',
          runs,
        };
      }),
    );

    const columnWidths = fitTableColumnWidths(desiredWidths, tableWidth, minColumnWidth);
    const renderRows: PdfTableRenderRow[] = table.rows.map((row, rowIndex) => {
      const cells = cellRuns[rowIndex].map((cell, cellIndex): PdfTableRenderCell => {
        const contentWidth = Math.max(1, columnWidths[cellIndex] - paddingX * 2);
        const wrapped = wrapCodeRuns(cell.runs, contentWidth);
        return {
          align: cell.align,
          rows: wrapped.length > 0 ? wrapped : [[]],
        };
      });
      const rowLineCount = Math.max(1, ...cells.map((cell) => cell.rows.length));
      return {
        header: row.header,
        cells,
        height: rowLineCount * lineHeight + paddingY * 2,
      };
    });

    const headerRow = renderRows[0]?.header ? renderRows[0] : undefined;
    if (headerRow && renderRows[1]) {
      this.ensureSpace(headerRow.height + renderRows[1].height);
    }
    for (let rowIndex = 0; rowIndex < renderRows.length; rowIndex++) {
      const row = renderRows[rowIndex];
      const createdPage = this.ensureSpace(row.height);
      if (createdPage && headerRow && !row.header) {
        this.renderTableRow(
          headerRow,
          0,
          tableX,
          tableWidth,
          columnWidths,
          paddingX,
          paddingY,
          lineHeight,
        );
      }
      this.renderTableRow(
        row,
        rowIndex,
        tableX,
        tableWidth,
        columnWidths,
        paddingX,
        paddingY,
        lineHeight,
      );
    }
  }

  private tableCellRuns(markdown: Uint8Array, s: number, e: number, style: PdfTextStyle): PdfTextRun[] {
    const runs: PdfTextRun[] = [];
    if (s < e) {
      collectInlineRuns(
        markdown,
        s,
        e,
        runs,
        style,
        this.options,
        this.urlAllowlist,
        this.baseUrl,
      );
    }
    return runs;
  }

  private renderTableRow(
    row: PdfTableRenderRow,
    rowIndex: number,
    tableX: number,
    tableWidth: number,
    columnWidths: readonly number[],
    paddingX: number,
    paddingY: number,
    lineHeight: number,
  ): void {
    this.ensureSpace(row.height);
    const topY = this.cursorY;
    const bottomY = topY - row.height;
    const background = row.header
      ? this.colors.tableHeaderBackground
      : rowIndex % 2 === 0
        ? null
        : this.colors.tableStripeBackground;

    this.decorateVerticalSlice(topY, bottomY);
    if (background) {
      this.fillRect(tableX, bottomY, tableWidth, row.height, background);
    }

    let cellX = tableX;
    for (let cellIndex = 0; cellIndex < columnWidths.length; cellIndex++) {
      const cell = row.cells[cellIndex] ?? {
        align: 'left' as const,
        rows: [[]],
      };
      const cellWidth = columnWidths[cellIndex];
      const contentWidth = Math.max(1, cellWidth - paddingX * 2);
      for (let lineIndex = 0; lineIndex < cell.rows.length; lineIndex++) {
        const runs = cell.rows[lineIndex];
        if (runs.length === 0) continue;
        const lineWidth = measureRuns(runs);
        const maxSize = runs.reduce((size, run) => Math.max(size, run.style.size), this.baseFontSize * 0.88);
        const textX = cell.align === 'right'
          ? cellX + cellWidth - paddingX - Math.min(lineWidth, contentWidth)
          : cell.align === 'center'
            ? cellX + paddingX + Math.max(0, (contentWidth - lineWidth) / 2)
            : cellX + paddingX;
        const baseline = topY - paddingY - lineIndex * lineHeight - maxSize;
        this.drawTextRunsAt(runs, textX, baseline);
      }
      cellX += cellWidth;
    }

    this.drawTableGrid(tableX, topY, bottomY, tableWidth);
    this.cursorY -= row.height;
  }

  private drawTableGrid(
    tableX: number,
    topY: number,
    bottomY: number,
    tableWidth: number,
  ): void {
    this.drawLine(tableX, topY, tableX + tableWidth, topY, this.colors.border, 0.6);
    this.drawLine(tableX, bottomY, tableX + tableWidth, bottomY, this.colors.border, 0.6);
    this.drawLine(tableX, bottomY, tableX, topY, this.colors.border, 0.6);
    this.drawLine(tableX + tableWidth, bottomY, tableX + tableWidth, topY, this.colors.border, 0.6);
  }

  private renderInfoLabel(label: string, color: PdfColor): void {
    const size = this.baseFontSize * 0.78;
    const line = this.createLine(this.baseFontSize * 1.18);
    line.addGenerated(label, this.style({ font: 'bold', size, color }));
    line.flush();
  }

  private renderFootnote(markdown: Uint8Array, idS: number, idE: number, contentS: number, contentE: number): void {
    const style = this.style({ size: this.baseFontSize * 0.85, color: this.colors.textSecondary });
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
    const style = this.style({ size: this.baseFontSize * 0.85, color: this.colors.textSecondary });
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
          color: documentColor(options, 'inlineCodeText'),
          background: documentColor(options, 'inlineCodeBackground'),
          backgroundPaddingX: Math.max(1.5, currentStyle.size * 0.22),
        }), true);
        break;

      case 'img':
        flushText();
        if (imageRenderer?.(tok, line, currentStyle)) {
          break;
        }
        line.addGenerated('[image', mergeStyle(currentStyle, { font: 'italic', color: documentColor(options, 'textSecondary') }));
        if (tok.altE > tok.altS) {
          line.addGenerated(': ', mergeStyle(currentStyle, { font: 'italic', color: documentColor(options, 'textSecondary') }));
          line.addTextSpan(markdown, tok.altS, tok.altE, mergeStyle(currentStyle, {
            font: 'italic',
            color: documentColor(options, 'textSecondary'),
          }));
        }
        line.addGenerated(']', mergeStyle(currentStyle, { font: 'italic', color: documentColor(options, 'textSecondary') }));
        break;

      case 'link': {
        flushText();
        const href = TD.decode(markdown.subarray(tok.hrefS, tok.hrefE));
        const resolvedHref = resolveUrlRelativeToBase(href, baseUrl);
        const linkStyle = urlAllowlist(resolvedHref)
          ? mergeStyle(currentStyle, { color: documentColor(options, 'accent'), underline: true })
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
          color: documentColor(options, 'accent'),
          underline: true,
        }));
        break;

      case 'footnoteRef':
        flushText();
        line.addGenerated('[', mergeStyle(currentStyle, { size: currentStyle.size * 0.75, color: documentColor(options, 'accent') }));
        line.addTextSpan(markdown, tok.idS, tok.idE, mergeStyle(currentStyle, {
          size: currentStyle.size * 0.75,
          color: documentColor(options, 'accent'),
        }));
        line.addGenerated(']', mergeStyle(currentStyle, { size: currentStyle.size * 0.75, color: documentColor(options, 'accent') }));
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
          color: documentColor(options, 'inlineCodeText'),
          background: documentColor(options, 'inlineCodeBackground'),
          backgroundPaddingX: Math.max(1.5, currentStyle.size * 0.22),
        }), true);
        break;

      case 'img':
        flushText();
        if (await imageRenderer?.(tok, line, currentStyle)) {
          break;
        }
        line.addGenerated('[image', mergeStyle(currentStyle, { font: 'italic', color: documentColor(options, 'textSecondary') }));
        if (tok.altE > tok.altS) {
          line.addGenerated(': ', mergeStyle(currentStyle, { font: 'italic', color: documentColor(options, 'textSecondary') }));
          line.addTextSpan(markdown, tok.altS, tok.altE, mergeStyle(currentStyle, {
            font: 'italic',
            color: documentColor(options, 'textSecondary'),
          }));
        }
        line.addGenerated(']', mergeStyle(currentStyle, { font: 'italic', color: documentColor(options, 'textSecondary') }));
        break;

      case 'link': {
        flushText();
        const href = TD.decode(markdown.subarray(tok.hrefS, tok.hrefE));
        const resolvedHref = resolveUrlRelativeToBase(href, baseUrl);
        const linkStyle = urlAllowlist(resolvedHref)
          ? mergeStyle(currentStyle, { color: documentColor(options, 'accent'), underline: true })
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
          color: documentColor(options, 'accent'),
          underline: true,
        }));
        break;

      case 'footnoteRef':
        flushText();
        line.addGenerated('[', mergeStyle(currentStyle, { size: currentStyle.size * 0.75, color: documentColor(options, 'accent') }));
        line.addTextSpan(markdown, tok.idS, tok.idE, mergeStyle(currentStyle, {
          size: currentStyle.size * 0.75,
          color: documentColor(options, 'accent'),
        }));
        line.addGenerated(']', mergeStyle(currentStyle, { size: currentStyle.size * 0.75, color: documentColor(options, 'accent') }));
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

type PdfEmbeddedFontObjectIds = {
  type0: number;
  cidFont: number;
  descriptor: number;
  fontFile: number;
  toUnicode: number;
};

function scaleFontMetric(font: PdfEmbeddedTextFont, value: number): number {
  return Math.round((value * 1000) / font.unitsPerEm);
}

function buildEmbeddedFontWidths(font: PdfEmbeddedTextFont): string {
  const glyphIds = Array.from(font.usedGlyphs.keys()).sort((a, b) => a - b);
  const parts: string[] = [];
  for (const glyphId of glyphIds) {
    parts.push(`${glyphId} [${font.widths[glyphId] ?? 1000}]`);
  }
  return parts.join(' ');
}

function buildToUnicodeCMap(font: PdfEmbeddedTextFont): string {
  const entries = Array.from(font.usedGlyphs.entries()).sort((a, b) => a[0] - b[0]);
  const out: string[] = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def',
    `/CMapName /${font.baseFontName}-UTF16 def`,
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
  ];

  for (let index = 0; index < entries.length; index += 100) {
    const chunk = entries.slice(index, index + 100);
    out.push(`${chunk.length} beginbfchar`);
    for (const [glyphId, codePoint] of chunk) {
      out.push(`<${appendFourDigitHex('', glyphId)}> <${appendUtf16BeHex('', codePoint)}>`);
    }
    out.push('endbfchar');
  }

  out.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
  return `${out.join('\n')}\n`;
}

function buildPdfFile(
  pages: readonly PdfPage[],
  pageWidth: number,
  pageHeight: number,
  images: readonly PdfEmbeddedImage[],
  embeddedFonts: readonly PdfEmbeddedTextFont[] = [],
): Uint8Array {
  const out = new PdfByteWriter();
  const offsets: number[] = [0];
  const pageCount = pages.length;
  const firstPageObject = 3;
  const firstContentObject = firstPageObject + pageCount;
  const firstFontObject = firstContentObject + pageCount;
  const embeddedFontObjectIds = new Map<PdfEmbeddedTextFont, PdfEmbeddedFontObjectIds>();
  let nextObjectId = firstFontObject + FONT_OBJECTS.length;
  for (const font of embeddedFonts) {
    embeddedFontObjectIds.set(font, {
      type0: nextObjectId++,
      cidFont: nextObjectId++,
      descriptor: nextObjectId++,
      fontFile: nextObjectId++,
      toUnicode: nextObjectId++,
    });
  }
  const imageObjectIds = new Map<PdfEmbeddedImage, number>();
  const maskObjectIds = new Map<PdfImageMask, number>();
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
      embeddedFonts.forEach((font) => {
        out.writeAscii(`/${font.resourceName} ${embeddedFontObjectIds.get(font)?.type0 ?? 0} 0 R `);
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

  embeddedFonts.forEach((font) => {
    const objectIds = embeddedFontObjectIds.get(font);
    if (!objectIds) return;

    writeObject(objectIds.type0, () => {
      out.writeAscii(
        `<< /Type /Font /Subtype /Type0 /BaseFont /${font.baseFontName} /Encoding /Identity-H `,
      );
      out.writeAscii(`/DescendantFonts [${objectIds.cidFont} 0 R] /ToUnicode ${objectIds.toUnicode} 0 R >>`);
    });

    writeObject(objectIds.cidFont, () => {
      out.writeAscii(
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.baseFontName} `,
      );
      out.writeAscii('/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ');
      out.writeAscii(`/FontDescriptor ${objectIds.descriptor} 0 R /CIDToGIDMap /Identity `);
      out.writeAscii(`/W [${buildEmbeddedFontWidths(font)}] >>`);
    });

    writeObject(objectIds.descriptor, () => {
      const [xMin, yMin, xMax, yMax] = font.bbox;
      out.writeAscii(
        `<< /Type /FontDescriptor /FontName /${font.baseFontName} /Flags 4 `,
      );
      out.writeAscii(
        `/FontBBox [${scaleFontMetric(font, xMin)} ${scaleFontMetric(font, yMin)} ${scaleFontMetric(font, xMax)} ${scaleFontMetric(font, yMax)}] `,
      );
      out.writeAscii(
        `/ItalicAngle 0 /Ascent ${scaleFontMetric(font, font.ascent)} /Descent ${scaleFontMetric(font, font.descent)} `,
      );
      out.writeAscii(`/CapHeight ${scaleFontMetric(font, font.ascent)} /StemV 80 /FontFile2 ${objectIds.fontFile} 0 R >>`);
    });

    writeObject(objectIds.fontFile, () => {
      out.writeAscii(`<< /Length ${font.bytes.length} /Length1 ${font.bytes.length} >>\nstream\n`);
      out.writeBytes(font.bytes);
      out.writeAscii('\nendstream');
    });

    writeObject(objectIds.toUnicode, () => {
      const cmap = TE.encode(buildToUnicodeCMap(font));
      out.writeAscii(`<< /Length ${cmap.length} >>\nstream\n`);
      out.writeBytes(cmap);
      out.writeAscii('endstream');
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
