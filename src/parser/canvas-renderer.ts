/**
 * Canvas renderer - renders Markdown to HTML5 Canvas
 */

import { blocks } from './block-parser';
import { inlineTokens } from './inline-parser';
import { COLOR, FONT_SIZE, INDENT, LINE_HEIGHT_MULTIPLIER, MARGIN, TD, INFO_COLORS } from './constants';
import type { CanvasListItem, DrawResult, TextSpan, TextStyle } from './types';
import { getLanguageSpec } from '../highlight';
import { TokenType, GenericTokenizer } from '../highlight/language-core';
import type { ParserOptions } from './index';
import { defaultUrlAllowlist, resolveUrlRelativeToBase } from './utils';

// Font stacks with comprehensive Unicode support
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
const FONT_STACK_MONO = 'ui-monospace, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';

const ORDERED_MARKER_FONT = 'bold ' + FONT_SIZE.base + 'px ' + FONT_STACK;
const MARKER_GAP = 8;
const BULLET_RADIUS = 3;
const VIRTUAL_SCROLL_THRESHOLD = 1400; // px
const MAX_IMAGE_WIDTH = 700; // max width for images in px
const RAW_HTML_ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export interface CanvasThemeColors {
  text: string;
  textSecondary: string;
  bg: string;
  bgSecondary: string;
  codeBg: string;
  border: string;
  accent: string;
  link: string;
  inlineCodeBg: string;
  inlineCodeText: string;
  blockquoteBorder: string;
  hr: string;
  listMarker: string;
  codeKw: string;
  codeId: string;
  codeNum: string;
  codeStr: string;
  codeTpl: string;
  codeCom: string;
  codeOp: string;
  codePunc: string;
  codeRx: string;
}

const DEFAULT_THEME_COLORS: CanvasThemeColors = {
  text: COLOR.text,
  textSecondary: COLOR.textSecondary,
  bg: COLOR.bg,
  bgSecondary: COLOR.bgSecondary,
  codeBg: COLOR.codeBg,
  border: COLOR.border,
  accent: COLOR.accent,
  link: COLOR.link,
  inlineCodeBg: COLOR.inlineCodeBg,
  inlineCodeText: COLOR.inlineCodeText,
  blockquoteBorder: COLOR.blockquoteBorder,
  hr: COLOR.hr,
  listMarker: COLOR.listMarker,
  codeKw: '#38bdf8',
  codeId: '#e6edf3',
  codeNum: '#79c0ff',
  codeStr: '#a5d6ff',
  codeTpl: '#a5d6ff',
  codeCom: '#8b949e',
  codeOp: '#ff7b72',
  codePunc: '#e6edf3',
  codeRx: '#7ee787',
};

type RawHtmlTag = {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Map<string, string>;
};

type RawHtmlTableCell = {
  html: string;
  plainText: string;
  align: 'left' | 'center' | 'right';
  rowSpan: number;
  colSpan: number;
  isHeader: boolean;
};

type RawHtmlTablePlacement = {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  align: 'left' | 'center' | 'right';
  isHeader: boolean;
  htmlBytes: Uint8Array;
  plainText: string;
};

type RawHtmlTableModel = {
  colCount: number;
  rowCount: number;
  rowIsHeader: boolean[];
  placements: RawHtmlTablePlacement[];
};

const RAW_HTML_TABLE_START_RE = /<\s*table\b/i;
const RAW_HTML_TABLE_END_RE = /<\s*\/\s*table\s*>/i;
const RAW_HTML_TABLE_ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const RAW_HTML_TABLE_CELL_RE = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

function decodeHtmlEntities(text: string): string {
  const toCodePoint = (value: number, fallback: string): string => {
    if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return fallback;
    return String.fromCodePoint(value);
  };

  return text.replaceAll(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, body: string) => {
    const lower = body.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    if (lower.startsWith('#x')) {
      const cp = Number.parseInt(lower.slice(2), 16);
      return toCodePoint(cp, m);
    }
    if (lower.startsWith('#')) {
      const cp = Number.parseInt(lower.slice(1), 10);
      return toCodePoint(cp, m);
    }
    return m;
  });
}

function parseRawHtmlTag(rawTag: string): RawHtmlTag | null {
  const tag = rawTag.trim();
  if (!tag.startsWith('<') || !tag.endsWith('>') || tag.startsWith('<!--')) {
    return null;
  }

  let inner = tag.slice(1, -1).trim();
  if (!inner) return null;

  let closing = false;
  if (inner.startsWith('/')) {
    closing = true;
    inner = inner.slice(1).trim();
  }

  let selfClosing = false;
  if (inner.endsWith('/')) {
    selfClosing = true;
    inner = inner.slice(0, -1).trim();
  }

  const tagNameMatch = /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(inner);
  if (!tagNameMatch) return null;
  const name = tagNameMatch[1].toLowerCase();
  const attrText = inner.slice(tagNameMatch[0].length);
  const attrs = new Map<string, string>();

  RAW_HTML_ATTR_RE.lastIndex = 0;
  for (const match of attrText.matchAll(RAW_HTML_ATTR_RE)) {
    const attrName = match[1].toLowerCase();
    if (!attrName) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs.set(attrName, value);
  }

  return { name, closing, selfClosing, attrs };
}

function parseRawHtmlAttrs(attrText: string): Map<string, string> {
  const attrs = new Map<string, string>();
  RAW_HTML_ATTR_RE.lastIndex = 0;
  for (const match of attrText.matchAll(RAW_HTML_ATTR_RE)) {
    const attrName = match[1]?.toLowerCase();
    if (!attrName) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs.set(attrName, value);
  }
  return attrs;
}

function parseSpanAttr(value: string | undefined): number {
  if (!value) return 1;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 64);
}

function parseAlignAttr(value: string | undefined, isHeader: boolean): 'left' | 'center' | 'right' {
  const lower = (value ?? '').trim().toLowerCase();
  if (lower === 'left' || lower === 'center' || lower === 'right') {
    return lower;
  }
  return isHeader ? 'center' : 'left';
}

function sanitizeRawHtmlTableCellHtml(rawHtml: string): string {
  return rawHtml
    .replaceAll(/<script\b[\s\S]*?<\/script>/gi, '')
    .replaceAll(/<style\b[\s\S]*?<\/style>/gi, '')
    .trim();
}

function htmlToPlainText(html: string): string {
  const withoutTags = html.replaceAll(/<[^>]*>/g, ' ');
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded.replaceAll(/\s+/g, ' ').trim();
}

function parseRawHtmlTableModel(rawLines: string[]): RawHtmlTableModel | null {
  if (rawLines.length === 0) return null;

  const tableHtml = rawLines.join('\n');
  const parsedRows: RawHtmlTableCell[][] = [];
  const encoder = new TextEncoder();

  RAW_HTML_TABLE_ROW_RE.lastIndex = 0;
  for (const rowMatch of tableHtml.matchAll(RAW_HTML_TABLE_ROW_RE)) {
    const rowHtml = rowMatch[1];
    const parsedCells: RawHtmlTableCell[] = [];

    RAW_HTML_TABLE_CELL_RE.lastIndex = 0;
    for (const cellMatch of rowHtml.matchAll(RAW_HTML_TABLE_CELL_RE)) {
      const tag = cellMatch[1].toLowerCase();
      const attrs = parseRawHtmlAttrs(cellMatch[2] ?? '');
      const sanitizedHtml = sanitizeRawHtmlTableCellHtml(cellMatch[3] ?? '');
      const isHeader = tag === 'th';

      parsedCells.push({
        html: sanitizedHtml,
        plainText: htmlToPlainText(sanitizedHtml),
        align: parseAlignAttr(attrs.get('align'), isHeader),
        rowSpan: parseSpanAttr(attrs.get('rowspan')),
        colSpan: parseSpanAttr(attrs.get('colspan')),
        isHeader,
      });
    }

    if (parsedCells.length > 0) {
      parsedRows.push(parsedCells);
    }
  }

  if (parsedRows.length === 0) return null;

  const occupied: boolean[][] = [];
  const rowIsHeader: boolean[] = [];
  const placements: RawHtmlTablePlacement[] = [];
  let colCount = 0;

  for (let row = 0; row < parsedRows.length; row++) {
    if (!occupied[row]) occupied[row] = [];
    let col = 0;

    for (const cell of parsedRows[row]) {
      while (occupied[row][col]) col++;

      const rowSpan = Math.max(1, cell.rowSpan);
      const colSpan = Math.max(1, cell.colSpan);
      const htmlBytes = encoder.encode(cell.html);

      placements.push({
        row,
        col,
        rowSpan,
        colSpan,
        align: cell.align,
        isHeader: cell.isHeader,
        htmlBytes,
        plainText: cell.plainText,
      });

      for (let r = row; r < row + rowSpan; r++) {
        if (!occupied[r]) occupied[r] = [];
        for (let c = col; c < col + colSpan; c++) {
          occupied[r][c] = true;
        }
      }

      if (cell.isHeader) {
        for (let r = row; r < row + rowSpan; r++) {
          rowIsHeader[r] = true;
        }
      }

      col += colSpan;
    }

    colCount = Math.max(colCount, occupied[row].length, col);
  }

  const rowCount = Math.max(parsedRows.length, occupied.length);
  if (rowCount <= 0 || colCount <= 0) return null;

  for (let i = 0; i < rowCount; i++) {
    rowIsHeader[i] = rowIsHeader[i] === true;
  }

  return { colCount, rowCount, rowIsHeader, placements };
}

function renderRawHtmlTableCellContent(
  cell: RawHtmlTablePlacement,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  maxWidth: number,
  clipHeight: number,
  baseSize: number,
  color: string,
  isMeasure: boolean,
  onImageLoad: (() => void) | undefined,
  urlAllowlist: (url: string) => boolean,
  baseUrl: string | undefined,
): void {
  if (maxWidth <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y - baseSize, maxWidth, Math.max(baseSize * 2, clipHeight));
  ctx.clip();

  const measureFont = getFontString(cell.isHeader, false, baseSize, false);
  const totalWidth = measureWidth(ctx, cell.plainText, measureFont);
  let offsetX = x;
  if (cell.align === 'center') {
    offsetX = x + (maxWidth - totalWidth) / 2;
  } else if (cell.align === 'right') {
    offsetX = x + maxWidth - totalWidth;
  }

  drawInline(
    cell.htmlBytes,
    0,
    cell.htmlBytes.length,
    ctx,
    offsetX,
    y,
    Number.MAX_SAFE_INTEGER,
    isMeasure,
    { size: baseSize, color, bold: cell.isHeader },
    onImageLoad,
    urlAllowlist,
    baseUrl,
    true,
    true,
  );

  ctx.restore();
}

function renderRawHtmlTableModel(
  table: RawHtmlTableModel,
  ctx: CanvasRenderingContext2D,
  y: number,
  indent: number,
  maxWidth: number,
  isMeasure: boolean,
  themeColors: ReturnType<typeof getThemeColors>,
  onImageLoad: (() => void) | undefined,
  urlAllowlist: (url: string) => boolean,
  baseUrl: string | undefined,
): number {
  const cellPadding = 10;
  const headerRowHeight = FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 2;
  const dataRowHeight = FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.8;
  const rowHeights = new Array<number>(table.rowCount);
  for (let i = 0; i < table.rowCount; i++) {
    rowHeights[i] = table.rowIsHeader[i] ? headerRowHeight : dataRowHeight;
  }

  let colWidths = new Array<number>(table.colCount).fill(80);
  for (const cell of table.placements) {
    const font = getFontString(cell.isHeader, false, FONT_SIZE.base, false);
    const textForMeasure = cell.plainText || ' ';
    const measured = measureWidth(ctx, textForMeasure, font);
    const desired = measured + cellPadding * 2;

    if (cell.colSpan === 1) {
      colWidths[cell.col] = Math.max(colWidths[cell.col], desired);
      continue;
    }

    const perCol = desired / cell.colSpan;
    for (let c = 0; c < cell.colSpan && cell.col + c < colWidths.length; c++) {
      colWidths[cell.col + c] = Math.max(colWidths[cell.col + c], perCol);
    }
  }

  let tableWidth = colWidths.reduce((sum, w) => sum + w, 0);
  if (tableWidth > maxWidth && tableWidth > 0) {
    const scale = maxWidth / tableWidth;
    colWidths = colWidths.map((w) => Math.max(56, w * scale));
    tableWidth = colWidths.reduce((sum, w) => sum + w, 0);
  }

  const colOffsets = new Array<number>(table.colCount + 1);
  colOffsets[0] = 0;
  for (let i = 0; i < table.colCount; i++) {
    colOffsets[i + 1] = colOffsets[i] + colWidths[i];
  }

  const rowOffsets = new Array<number>(table.rowCount + 1);
  rowOffsets[0] = 0;
  for (let i = 0; i < table.rowCount; i++) {
    rowOffsets[i + 1] = rowOffsets[i] + rowHeights[i];
  }

  const tableHeight = rowOffsets[table.rowCount];
  const tableX = MARGIN + indent;
  const tableY = y;
  const tableRadius = 4;

  if (!isMeasure) {
    ctx.save();
    ctx.fillStyle = themeColors.bgSecondary;
    ctx.beginPath();
    ctx.moveTo(tableX + tableRadius, tableY);
    ctx.lineTo(tableX + tableWidth - tableRadius, tableY);
    ctx.quadraticCurveTo(tableX + tableWidth, tableY, tableX + tableWidth, tableY + tableRadius);
    ctx.lineTo(tableX + tableWidth, tableY + tableHeight - tableRadius);
    ctx.quadraticCurveTo(tableX + tableWidth, tableY + tableHeight, tableX + tableWidth - tableRadius, tableY + tableHeight);
    ctx.lineTo(tableX + tableRadius, tableY + tableHeight);
    ctx.quadraticCurveTo(tableX, tableY + tableHeight, tableX, tableY + tableHeight - tableRadius);
    ctx.lineTo(tableX, tableY + tableRadius);
    ctx.quadraticCurveTo(tableX, tableY, tableX + tableRadius, tableY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    let bodyRowIndex = 0;
    for (let row = 0; row < table.rowCount; row++) {
      if (table.rowIsHeader[row]) continue;
      if (bodyRowIndex % 2 === 1) {
        const rowY = tableY + rowOffsets[row];
        ctx.fillStyle = 'rgba(0, 0, 0, 0.02)';
        ctx.fillRect(tableX, rowY, tableWidth, rowHeights[row]);
      }
      bodyRowIndex++;
    }
  }

  for (const cell of table.placements) {
    const colStart = cell.col;
    const colEnd = Math.min(table.colCount, colStart + cell.colSpan);
    const rowStart = cell.row;
    const rowEnd = Math.min(table.rowCount, rowStart + cell.rowSpan);

    const cellX = tableX + colOffsets[colStart];
    const cellY = tableY + rowOffsets[rowStart];
    const cellWidth = colOffsets[colEnd] - colOffsets[colStart];
    const cellHeight = rowOffsets[rowEnd] - rowOffsets[rowStart];

    if (!isMeasure) {
      ctx.strokeStyle = themeColors.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX, cellY, cellWidth, cellHeight);

      const textY = cellY + Math.max(0, (cellHeight - FONT_SIZE.base) / 2);
      renderRawHtmlTableCellContent(
        cell,
        ctx,
        cellX + cellPadding,
        textY,
        Math.max(0, cellWidth - cellPadding * 2),
        cellHeight,
        FONT_SIZE.base,
        cell.isHeader ? themeColors.text : themeColors.textSecondary,
        isMeasure,
        onImageLoad,
        urlAllowlist,
        baseUrl,
      );
    }
  }

  return tableY + tableHeight;
}

// Font string cache for common font combinations
const fontCache = new Map<string, string>();
function getFontString(bold: boolean, italic: boolean, size: number, mono: boolean): string {
  const key = `${bold ? 'bold ' : ''}${italic ? 'italic ' : ''}${size}px ${mono ? FONT_STACK_MONO : FONT_STACK}`;
  let cached = fontCache.get(key);
  if (!cached) {
    cached = key;
    fontCache.set(key, cached);
  }
  return cached;
}

// Cached text measurement per context font/text with better cache management
const textWidthCache = new WeakMap<CanvasRenderingContext2D, Map<string, number>>();
function measureWidth(ctx: CanvasRenderingContext2D, text: string, font?: string): number {
  const currentFont = font || ctx.font || '';
  let cache = textWidthCache.get(ctx);
  if (!cache) {
    cache = new Map();
    textWidthCache.set(ctx, cache);
  }
  const key = currentFont + '\n' + text;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const w = ctx.measureText(text).width;
  // More aggressive cache management - clear when getting large
  if (cache.size > 2000) {
    // Keep only the most recently used entries
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => b[1] - a[1]); // Sort by usage count (we'll add usage tracking)
    cache.clear();
    // Keep top 1000 most used
    for (let i = 0; i < Math.min(1000, entries.length); i++) {
      cache.set(entries[i][0], entries[i][1]);
    }
  }
  cache.set(key, w);
  return w;
}

// Grapheme segmentation support (falls back to code point iteration)
const GRAPHEME_SEGMENTER: any = (typeof (Intl as any).Segmenter === 'function')
  ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
  : null;

let canvasThemeColorsOverride: CanvasThemeColors | null = null;

export function setCanvasThemeColorsOverride(colors: CanvasThemeColors | null): void {
  canvasThemeColorsOverride = colors;
}

/**
 * Get colors from CSS custom properties (theme-aware)
 */
function getThemeColors(): CanvasThemeColors {
  if (canvasThemeColorsOverride) {
    return canvasThemeColorsOverride;
  }

  if (typeof document === 'undefined') {
    return DEFAULT_THEME_COLORS;
  }

  const root = document.documentElement;
  const computedStyle = getComputedStyle(root);

  return {
    text: computedStyle.getPropertyValue('--text-primary').trim() || COLOR.text,
    textSecondary: computedStyle.getPropertyValue('--text-secondary').trim() || COLOR.textSecondary,
    bg: computedStyle.getPropertyValue('--bg-base').trim() || COLOR.bg,
    bgSecondary: computedStyle.getPropertyValue('--bg-glass').trim() || COLOR.bgSecondary,
    codeBg: computedStyle.getPropertyValue('--bg-panel').trim() || COLOR.codeBg,
    border: computedStyle.getPropertyValue('--border-glass').trim() || COLOR.border,
    accent: computedStyle.getPropertyValue('--accent').trim() || COLOR.accent,
    link: computedStyle.getPropertyValue('--accent').trim() || COLOR.link,
    inlineCodeBg: computedStyle.getPropertyValue('--bg-glass-strong').trim() || COLOR.inlineCodeBg,
    inlineCodeText: computedStyle.getPropertyValue('--accent').trim() || COLOR.inlineCodeText,
    blockquoteBorder: computedStyle.getPropertyValue('--accent').trim() || COLOR.blockquoteBorder,
    hr: computedStyle.getPropertyValue('--border-strong').trim() || COLOR.hr,
    listMarker: computedStyle.getPropertyValue('--accent').trim() || COLOR.listMarker,
    // Syntax highlighting colors
    codeKw: computedStyle.getPropertyValue('--code-kw').trim() || DEFAULT_THEME_COLORS.codeKw,
    codeId: computedStyle.getPropertyValue('--code-id').trim() || DEFAULT_THEME_COLORS.codeId,
    codeNum: computedStyle.getPropertyValue('--code-num').trim() || DEFAULT_THEME_COLORS.codeNum,
    codeStr: computedStyle.getPropertyValue('--code-str').trim() || DEFAULT_THEME_COLORS.codeStr,
    codeTpl: computedStyle.getPropertyValue('--code-tpl').trim() || DEFAULT_THEME_COLORS.codeTpl,
    codeCom: computedStyle.getPropertyValue('--code-com').trim() || DEFAULT_THEME_COLORS.codeCom,
    codeOp: computedStyle.getPropertyValue('--code-op').trim() || DEFAULT_THEME_COLORS.codeOp,
    codePunc: computedStyle.getPropertyValue('--code-punc').trim() || DEFAULT_THEME_COLORS.codePunc,
    codeRx: computedStyle.getPropertyValue('--code-rx').trim() || DEFAULT_THEME_COLORS.codeRx,
  };
}

/**
 * Get token colors for syntax highlighting (theme-aware)
 */
function getTokenColors() {
  const colors = getThemeColors();
  return {
    [TokenType.Keyword]: colors.codeKw,
    [TokenType.Identifier]: colors.codeId,
    [TokenType.LiteralNum]: colors.codeNum,
    [TokenType.LiteralStr]: colors.codeStr,
    [TokenType.LiteralTpl]: colors.codeTpl,
    [TokenType.Comment]: colors.codeCom,
    [TokenType.Regex]: colors.codeRx,
    [TokenType.Operator]: colors.codeOp,
    [TokenType.Punct]: colors.codePunc,
    [TokenType.Whitespace]: colors.text,
    [TokenType.Newline]: colors.text,
  };
}

/**
 * Measure the width of inline content
 */
function measureInlineContent(
  u8: Uint8Array,
  s: number,
  e: number,
  ctx: CanvasRenderingContext2D,
  baseSize: number,
): number {
  let width = 0;
  let currentBold = false;
  let currentItalic = false;
  let currentSize = baseSize;
  let currentMono = false;

  for (const tok of inlineTokens(u8, s, e)) {
    switch (tok.kind) {
      case 'text': {
        const text = TD.decode(u8.subarray(tok.s, tok.e));
        const font = getFontString(currentBold, currentItalic, currentSize, currentMono);
        width += measureWidth(ctx, text, font);
        break;
      }
      case 'code': {
        const text = TD.decode(u8.subarray(tok.s, tok.e));
        const codeSize = Math.round(baseSize * 0.9);
        const font = getFontString(currentBold, currentItalic, codeSize, true);
        width += measureWidth(ctx, text, font) + 12; // padding
        break;
      }
      case 'strongOpen':
        currentBold = true;
        break;
      case 'strongClose':
        currentBold = false;
        break;
      case 'emOpen':
        currentItalic = true;
        break;
      case 'emClose':
        currentItalic = false;
        break;
      case 'footnoteRef': {
        const text = TD.decode(u8.subarray(tok.idS, tok.idE));
        const superSize = currentSize * 0.7;
        const font = getFontString(currentBold, currentItalic, superSize, currentMono);
        width += measureWidth(ctx, `[${text}]`, font);
        break;
      }
      case 'link': {
        const text = TD.decode(u8.subarray(tok.textS, tok.textE));
        const font = getFontString(currentBold, currentItalic, currentSize, currentMono);
        width += measureWidth(ctx, text, font);
        break;
      }
      case 'autolink': {
        const text = TD.decode(u8.subarray(tok.s, tok.e));
        const font = getFontString(currentBold, currentItalic, currentSize, currentMono);
        width += measureWidth(ctx, text, font);
        break;
      }
    }
  }

  return width;
}

/**
 * Render inline content within a cell with clipping
 */
function renderCellContent(
  u8: Uint8Array,
  s: number,
  e: number,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  maxWidth: number,
  baseSize: number,
  align: 'left' | 'center' | 'right',
  color: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y - baseSize, maxWidth, baseSize * 2);
  ctx.clip();
  
  // Measure total width for alignment
  const totalWidth = measureInlineContent(u8, s, e, ctx, baseSize);
  
  let offsetX = x;
  if (align === 'center') {
    offsetX = x + (maxWidth - totalWidth) / 2;
  } else if (align === 'right') {
    offsetX = x + maxWidth - totalWidth;
  }
  
  let currentX = offsetX;
  let isBold = false;
  let isItalic = false;

  for (const tok of inlineTokens(u8, s, e)) {
    switch (tok.kind) {
      case 'text': {
        const text = TD.decode(u8.subarray(tok.s, tok.e));
        const font = getFontString(isBold, isItalic, baseSize, false);
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.fillText(text, currentX, y);
        currentX += measureWidth(ctx, text, font);
        break;
      }
      case 'code': {
        const text = TD.decode(u8.subarray(tok.s, tok.e));
        const codeSize = Math.round(baseSize * 0.9);
        const paddingX = 6;
        const paddingY = 4;

        // Background
        const font = getFontString(isBold, isItalic, codeSize, true);
        ctx.font = font;
        const textWidth = measureWidth(ctx, text, font);

        const themeColors = getThemeColors();
        ctx.fillStyle = themeColors.inlineCodeBg;
        ctx.fillRect(currentX - paddingX, y - codeSize - paddingY / 2, textWidth + paddingX * 2, codeSize + paddingY);

        // Text
        ctx.fillStyle = themeColors.inlineCodeText;
        ctx.fillText(text, currentX, y);
        currentX += textWidth + paddingX * 2;

        ctx.fillStyle = color;
        break;
      }
      case 'strongOpen':
        isBold = true;
        break;
      case 'strongClose':
        isBold = false;
        break;
      case 'emOpen':
        isItalic = true;
        break;
      case 'emClose':
        isItalic = false;
        break;
      case 'footnoteRef': {
        const text = TD.decode(u8.subarray(tok.idS, tok.idE));
        const superSize = baseSize * 0.7;
        const font = getFontString(isBold, isItalic, superSize, false);
        ctx.font = font;
        const prevStyle = ctx.fillStyle as string | CanvasGradient | CanvasPattern;
        const themeColors = getThemeColors();
        ctx.fillStyle = themeColors.accent;
        ctx.fillText(`[${text}]`, currentX, y - baseSize * 0.3);
        currentX += measureWidth(ctx, `[${text}]`, font);
        ctx.fillStyle = prevStyle;
        break;
      }
      case 'link': {
        const text = TD.decode(u8.subarray(tok.textS, tok.textE));
        const font = getFontString(isBold, isItalic, baseSize, false);
        ctx.font = font;
        const prevStyle = ctx.fillStyle as string | CanvasGradient | CanvasPattern;
        const themeColors = getThemeColors();
        ctx.fillStyle = themeColors.link;
        ctx.fillText(text, currentX, y);
        currentX += measureWidth(ctx, text, font);
        ctx.fillStyle = prevStyle;
        break;
      }
      case 'autolink': {
        const text = TD.decode(u8.subarray(tok.s, tok.e));
        const font = getFontString(isBold, isItalic, baseSize, false);
        ctx.font = font;
        const prevStyle = ctx.fillStyle as string | CanvasGradient | CanvasPattern;
        const themeColors = getThemeColors();
        ctx.fillStyle = themeColors.link;
        ctx.fillText(text, currentX, y);
        currentX += measureWidth(ctx, text, font);
        ctx.fillStyle = prevStyle;
        break;
      }
    }
  }
  
  ctx.restore();
}

// Image cache with loading state
interface CachedImage {
  image: CanvasImageSource | null;
  width: number;
  height: number;
  status: 'loading' | 'loaded' | 'error';
  callbacks: Set<() => void>;
}

const imageCache = new Map<string, CachedImage>();
type CanvasImageLoadHook = (
  src: string,
  onResolve: (image: CanvasImageSource, width: number, height: number) => void,
  onReject: () => void,
) => void;

let canvasImageLoadHook: CanvasImageLoadHook | null = null;

export function setCanvasImageLoadHook(hook: CanvasImageLoadHook | null): void {
  canvasImageLoadHook = hook;
}

export function clearCanvasImageCache(): void {
  for (const cached of imageCache.values()) {
    if (typeof ImageBitmap !== 'undefined' && cached.image instanceof ImageBitmap) {
      cached.image.close();
    }
  }
  imageCache.clear();
}

function loadImage(src: string, onLoad: () => void): CachedImage | undefined {
  const cached = imageCache.get(src);
  if (cached) {
    // Add callback for this render if image is still loading
    if (cached.status === 'loading' && onLoad) {
      cached.callbacks.add(onLoad);
    }
    return cached;
  }

  const cacheEntry: CachedImage = {
    image: null,
    width: 0,
    height: 0,
    status: 'loading',
    callbacks: new Set<() => void>(),
  };
  
  if (onLoad) {
    cacheEntry.callbacks.add(onLoad);
  }
  
  imageCache.set(src, cacheEntry);

  const onResolve = (image: CanvasImageSource, width: number, height: number): void => {
    cacheEntry.image = image;
    cacheEntry.width = width;
    cacheEntry.height = height;
    cacheEntry.status = 'loaded';
    cacheEntry.callbacks.forEach((fn) => fn());
    cacheEntry.callbacks.clear();
  };

  const onReject = (): void => {
    cacheEntry.status = 'error';
    cacheEntry.callbacks.forEach((fn) => fn());
    cacheEntry.callbacks.clear();
  };

  if (canvasImageLoadHook) {
    canvasImageLoadHook(src, onResolve, onReject);
    return cacheEntry;
  }

  if (typeof Image !== 'undefined') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => onResolve(img, img.naturalWidth, img.naturalHeight);
    img.onerror = onReject;
    img.src = src;
    return cacheEntry;
  }

  onReject();
  
  return cacheEntry;
}

interface CanvasRenderState {
  dpr: number;
  styleWidth: number;
  totalHeight: number;
  offscreen: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D;
  scrollEl: HTMLElement;
  spacer?: HTMLElement | null;
  onScroll?: () => void;
}

const canvasStates = new WeakMap<HTMLCanvasElement, CanvasRenderState>();
const activeMainThreadCanvases = new Set<HTMLCanvasElement>();
let mainThreadShutdownHookInstalled = false;

function ensureMainThreadShutdownHook(): void {
  if (mainThreadShutdownHookInstalled) return;
  if (typeof window === 'undefined') return;
  mainThreadShutdownHookInstalled = true;
  window.addEventListener(
    'pagehide',
    () => {
      for (const canvas of activeMainThreadCanvases) {
        const state = canvasStates.get(canvas);
        if (state?.scrollEl && state.onScroll) {
          state.scrollEl.removeEventListener('scroll', state.onScroll);
        }
        canvasStates.delete(canvas);
      }
      activeMainThreadCanvases.clear();
      clearCanvasImageCache();
    },
    { once: true },
  );
}

/**
 * Render syntax-highlighted code to canvas
 */
function renderHighlightedCode(
  codeBytes: Uint8Array,
  lang: string | undefined,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isMeasure: boolean,
): { width: number; height: number; y: number } {
  const TE = new TextEncoder();
  
  // Try to get language spec for tokenization
  const spec = lang ? getLanguageSpec(lang) : undefined;
  
  let maxWidth = 0;
  let currentY = y;
  const lineHeight = FONT_SIZE.code * LINE_HEIGHT_MULTIPLIER;
  
  // Cache font string
  const font = getFontString(false, false, FONT_SIZE.code, true);
  
  // Get theme-aware colors
  const tokenColors = getTokenColors();
  const themeColors = getThemeColors();

  if (spec) {
    // Tokenize and render with colors
    const tokenizer = new GenericTokenizer(spec);
    const lines = TD.decode(codeBytes).split('\n');

    for (const line of lines) {
      const lineBytes = TE.encode(line);
      let currentX = x;

      ctx.font = font;

      tokenizer.tokenize(lineBytes, (type, s, e) => {
        const tokenText = TD.decode(lineBytes.subarray(s, e));
        const color = tokenColors[type] || themeColors.text;

        if (!isMeasure) {
          ctx.fillStyle = color;
          ctx.fillText(tokenText, currentX, currentY);
        }

        currentX += measureWidth(ctx, tokenText, font);
      });

      if (currentX - x > maxWidth) {
        maxWidth = currentX - x;
      }

      currentY += lineHeight;
    }
  } else {
    // Fall back to plain rendering without highlighting
    const lines = TD.decode(codeBytes).split('\n');
    ctx.font = font;

    for (const line of lines) {
      const w = measureWidth(ctx, line, font);
      if (w > maxWidth) maxWidth = w;

      if (!isMeasure) {
        ctx.fillStyle = themeColors.text;
        ctx.fillText(line, x, currentY);
      }

      currentY += lineHeight;
    }
  }
  
  return { width: maxWidth, height: currentY - y, y: currentY };
}

function drawInline(
  u8: Uint8Array,
  s: number,
  e: number,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  maxWidth: number,
  isMeasure: boolean,
  baseStyle: Partial<TextStyle> = {},
  onImageLoad?: () => void,
  urlAllowlist?: (url: string) => boolean,
  baseUrl?: string,
  allowRawHtml: boolean = false,
  decodeEntities: boolean = false,
): DrawResult {
  const allowlist = urlAllowlist ?? defaultUrlAllowlist;
  let currentX = x;
  let currentY = y;
  const line: TextSpan[] = [];
  const styleStack: TextStyle[] = [];
  const themeColors = getThemeColors();
  let currentStyle: TextStyle = {
    bold: false,
    italic: false,
    code: false,
    link: false,
    color: themeColors.text,
    size: baseStyle.size || FONT_SIZE.base,
  };

  const updateCtx = (): void => {
    const font = getFontString(currentStyle.bold || false, currentStyle.italic || false, currentStyle.size || FONT_SIZE.base, currentStyle.code || false);
    ctx.font = font;
    ctx.fillStyle = currentStyle.color || themeColors.text;
  };

  const flushLine = (): void => {
    let lineX = x;
    
    if (!isMeasure) {
      // First pass: draw backgrounds for code/mark spans.
      let tempX = x;
      let i = 0;
      const baseLineSize = line.length > 0 ? (line[0].style.size || FONT_SIZE.base) : FONT_SIZE.base;
      
      while (i < line.length) {
        const span = line[i];
        currentStyle = span.style;
        updateCtx();
        const w = ctx.measureText(span.text).width;
        
        if (currentStyle.code || currentStyle.highlight) {
          const isCodeSpan = currentStyle.code === true;
          // Find consecutive spans of the same background kind.
          let bgEndX = tempX + w;
          let j = i + 1;
          while (j < line.length) {
            const s = line[j].style;
            if (isCodeSpan) {
              if (!s.code) break;
            } else if (!s.highlight || s.code) {
              break;
            }
            currentStyle = s;
            updateCtx();
            bgEndX += ctx.measureText(line[j].text).width;
            j++;
          }

          const fontSize = span.style.size || FONT_SIZE.base;
          const baselineOffset = baseLineSize - fontSize;
          const paddingX = isCodeSpan ? Math.max(6, fontSize * 0.35) : Math.max(2, fontSize * 0.12);
          const paddingY = isCodeSpan ? Math.max(4, fontSize * 0.3) : Math.max(2, fontSize * 0.12);
          const radius = isCodeSpan ? 3 : 2;
          const bgX = tempX - paddingX;
          const bgY = currentY + baselineOffset - paddingY / 2;
          const bgWidth = (bgEndX - tempX) + paddingX * 2;
          const bgHeight = fontSize + paddingY;

          const previousFill = ctx.fillStyle;
          ctx.fillStyle = isCodeSpan ? themeColors.inlineCodeBg : 'rgba(250, 204, 21, 0.24)';
          if (isCodeSpan) {
            ctx.beginPath();
            ctx.moveTo(bgX + radius, bgY);
            ctx.lineTo(bgX + bgWidth - radius, bgY);
            ctx.quadraticCurveTo(bgX + bgWidth, bgY, bgX + bgWidth, bgY + radius);
            ctx.lineTo(bgX + bgWidth, bgY + bgHeight - radius);
            ctx.quadraticCurveTo(bgX + bgWidth, bgY + bgHeight, bgX + bgWidth - radius, bgY + bgHeight);
            ctx.lineTo(bgX + radius, bgY + bgHeight);
            ctx.quadraticCurveTo(bgX, bgY + bgHeight, bgX, bgY + bgHeight - radius);
            ctx.lineTo(bgX, bgY + radius);
            ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
          }
          ctx.fillStyle = previousFill;

          // Skip to end of background sequence
          i = j;
          tempX = bgEndX;
        } else {
          tempX += w;
          i++;
        }
      }
    }
    
    // Second pass: draw text and link underlines
    lineX = x;
    const baseLineSize = line.length > 0 ? (line[0].style.size || FONT_SIZE.base) : FONT_SIZE.base;
    
    for (const span of line) {
      currentStyle = span.style;
      updateCtx();
      const w = measureWidth(ctx, span.text);
      if (!isMeasure) {
        // Adjust y position to maintain baseline alignment for different font sizes
        const fontSize = currentStyle.size || FONT_SIZE.base;
        const baselineOffset = baseLineSize - fontSize; // Shift smaller fonts down
        
        ctx.fillText(span.text, lineX, currentY + baselineOffset);
        
        if (currentStyle.link || currentStyle.underline) {
          // Draw underline below the text baseline
          const underlineY = currentY + baselineOffset + fontSize + 1;
          ctx.beginPath();
          ctx.moveTo(lineX, underlineY);
          ctx.lineTo(lineX + w, underlineY);
          ctx.strokeStyle = currentStyle.link ? themeColors.inlineCodeText : (currentStyle.color || themeColors.text);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (currentStyle.strike) {
          const strikeY = currentY + baselineOffset + fontSize * 0.55;
          ctx.beginPath();
          ctx.moveTo(lineX, strikeY);
          ctx.lineTo(lineX + w, strikeY);
          ctx.strokeStyle = themeColors.textSecondary;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      lineX += w;
    }
    
    line.length = 0;
    currentY += (currentStyle.size || FONT_SIZE.base) * LINE_HEIGHT_MULTIPLIER;
    currentX = x;
  };

  const pushStyle = (newStyle: Partial<TextStyle>): void => {
    styleStack.push({ ...currentStyle });
    Object.assign(currentStyle, newStyle);
  };

  const popStyle = (): void => {
    if (styleStack.length) {
      currentStyle = styleStack.pop()!;
    }
  };

  const rawTagStack: string[] = [];

  const pushRawStyle = (kind: string, style: Partial<TextStyle>): void => {
    pushStyle(style);
    rawTagStack.push(kind);
  };

  const popRawStyle = (kind: string): void => {
    const top = rawTagStack[rawTagStack.length - 1];
    if (top === kind) {
      rawTagStack.pop();
      popStyle();
    }
  };

  const renderInlineImage = (rawSrc: string, altText: string): void => {
    const src = resolveUrlRelativeToBase(rawSrc, baseUrl);
    if (!allowlist(src)) {
      pushStyle({ code: true, color: themeColors.textSecondary });
      addText(`[Blocked image: ${altText || src}]`);
      popStyle();
      if (line.length) flushLine();
      return;
    }

    // Flush current line before image
    if (line.length) flushLine();

    // Always try to load/get cached image to start loading
    // Even during measure pass, we want to initiate the fetch
    const cachedImg = loadImage(src, onImageLoad || (() => {}));

    if (cachedImg && cachedImg.status === 'loaded' && cachedImg.image) {
      // Calculate display dimensions maintaining aspect ratio
      const naturalWidth = cachedImg.width;
      const naturalHeight = cachedImg.height;
      const displayWidth = Math.min(naturalWidth, maxWidth, MAX_IMAGE_WIDTH);
      const displayHeight = (displayWidth / naturalWidth) * naturalHeight;

      if (!isMeasure) {
        // Draw image with high quality
        const prevSmoothing = ctx.imageSmoothingEnabled;
        const prevQuality = ctx.imageSmoothingQuality;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        try {
          ctx.drawImage(cachedImg.image, x, currentY, displayWidth, displayHeight);
        } catch {
          // If drawing fails (CORS, etc), show fallback
          ctx.fillStyle = themeColors.border;
          ctx.fillRect(x, currentY, displayWidth, displayHeight);
          ctx.fillStyle = themeColors.textSecondary;
          ctx.font = FONT_SIZE.base + 'px ' + FONT_STACK;
          ctx.fillText(`[Image: ${altText || src}]`, x + 10, currentY + 20);
        }

        ctx.imageSmoothingEnabled = prevSmoothing;
        ctx.imageSmoothingQuality = prevQuality;
      }

      currentY += displayHeight + FONT_SIZE.base * 0.5; // Add spacing after image
    } else if (cachedImg && cachedImg.status === 'error') {
      // Show error message
      pushStyle({ code: true, color: themeColors.textSecondary });
      addText(`[Image failed to load: ${altText || src}]`);
      popStyle();
      if (line.length) flushLine();
    } else {
      // Loading... use consistent placeholder dimensions for both measure and draw
      // Use a reasonable default based on typical image aspect ratios (4:3)
      const placeholderWidth = Math.min(maxWidth, MAX_IMAGE_WIDTH);
      const placeholderHeight = (placeholderWidth * 3) / 4; // 4:3 aspect ratio

      if (!isMeasure) {
        ctx.fillStyle = themeColors.bgSecondary;
        ctx.fillRect(x, currentY, placeholderWidth, placeholderHeight);
        ctx.fillStyle = themeColors.textSecondary;
        ctx.font = FONT_SIZE.base + 'px ' + FONT_STACK;
        ctx.fillText(`Loading: ${altText || src}`, x + 10, currentY + placeholderHeight / 2);
      }
      currentY += placeholderHeight + FONT_SIZE.base * 0.5;
    }

    currentX = x; // Reset x after image
  };

  const findBreak = (text: string, start: number, maxW: number): number => {
    if (GRAPHEME_SEGMENTER) {
      let lastOk = start;
      let cursor = start;
      let currentWidth = 0;

      try {
        // Use Intl.Segmenter for proper grapheme breaking
        const segmenter = GRAPHEME_SEGMENTER;
        const textSegment = text.substring(start);
        const segments = segmenter.segment(textSegment);

        for (const segment of segments) {
          const segText = segment.segment;
          if (!segText) continue;

          const candidate = cursor + segText.length;
          const sub = text.substring(start, candidate);
          const width = measureWidth(ctx, sub, ctx.font);

          if (width <= maxW) {
            lastOk = candidate;
            cursor = candidate;
            currentWidth = width;
          } else {
            // Try to break within the current grapheme cluster if needed
            if (currentWidth > 0 && currentWidth <= maxW) {
              return lastOk;
            }
            break;
          }
        }
        return lastOk;
      } catch (e) {
        // Fallback if Intl.Segmenter fails
      }
    }

    // Fallback: binary search on code units
    let low = start;
    let high = text.length;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      const sub = text.substring(start, mid);
      if (measureWidth(ctx, sub, ctx.font) <= maxW) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  };

  const addText = (text: string): void => {
    if (!text) return;
    const parts = text.split(/(\s+)/).filter((p) => p.length > 0);
    for (const part of parts) {
      updateCtx();
      const isSpacePart = /\s/.test(part[0]);
      const font = getFontString(currentStyle.bold || false, currentStyle.italic || false, currentStyle.size || FONT_SIZE.base, currentStyle.code || false);
      const partW = measureWidth(ctx, part, font);
      let remaining = maxWidth - (currentX - x);

      if (partW <= remaining) {
        line.push({ text: part, style: { ...currentStyle } });
        currentX += partW;
      } else {
        if (isSpacePart) {
          if (line.length) flushLine();
        } else {
          let pStart = 0;
          while (pStart < part.length) {
            remaining = maxWidth - (currentX - x);
            const pEnd = findBreak(part, pStart, remaining);
            if (pEnd > pStart) {
              const sub = part.substring(pStart, pEnd);
              line.push({ text: sub, style: { ...currentStyle } });
              currentX += measureWidth(ctx, sub, font);
              pStart = pEnd;
            } else {
              if (line.length) {
                flushLine();
              } else {
                const char = part[pStart];
                line.push({ text: char, style: { ...currentStyle } });
                currentX += measureWidth(ctx, char, font);
                pStart++;
              }
            }
          }
        }
      }
    }
  };

  const inlineParseOptions = allowRawHtml ? { allowRawHtml: true } : undefined;
  const RECURSION_LIMIT = 8;

  const processRange = (rangeStart: number, rangeEnd: number, depth: number): void => {
    for (const tok of inlineTokens(u8, rangeStart, rangeEnd, inlineParseOptions)) {
      processToken(tok, depth);
    }
  };

  const processToken = (tok: ReturnType<typeof inlineTokens> extends Generator<infer T> ? T : never, depth: number): void => {
    updateCtx();
    switch (tok.kind) {
      case 'text': {
        const text = TD.decode(u8.subarray(tok.s, tok.e));
        addText(decodeEntities ? decodeHtmlEntities(text) : text);
        break;
      }

      case 'code': {
        const codeText = TD.decode(u8.subarray(tok.s, tok.e));
        const surroundingSize = currentStyle.size || FONT_SIZE.base;
        const codeSize = Math.round(surroundingSize * 0.9); // Slightly smaller than surrounding text

        // Push style with code flag - background will be drawn during flush
        pushStyle({ code: true, color: themeColors.inlineCodeText, size: codeSize });
        addText(codeText);
        popStyle();
        break;
      }

      case 'img': {
        const altText = TD.decode(u8.subarray(tok.altS, tok.altE));
        const rawSrc = TD.decode(u8.subarray(tok.srcS, tok.srcE));
        renderInlineImage(rawSrc, altText);
        break;
      }

      case 'footnoteRef': {
        const fnText = TD.decode(u8.subarray(tok.idS, tok.idE));
        pushStyle({ color: themeColors.accent, size: FONT_SIZE.base * 0.7 });
        addText(`[${fnText}]`);
        popStyle();
        break;
      }

      case 'link': {
        const hrefText = TD.decode(u8.subarray(tok.hrefS, tok.hrefE));
        const resolvedHref = resolveUrlRelativeToBase(hrefText, baseUrl);
        const allowed = allowlist(resolvedHref);
        if (allowed) {
          pushStyle({ link: true, color: themeColors.link, underline: true });
        }
        if (depth < RECURSION_LIMIT) {
          processRange(tok.textS, tok.textE, depth + 1);
        } else {
          addText(TD.decode(u8.subarray(tok.textS, tok.textE)));
        }
        if (allowed) {
          popStyle();
        }
        break;
      }

      case 'autolink':
        pushStyle({ link: true, color: themeColors.link, underline: true });
        addText(TD.decode(u8.subarray(tok.s, tok.e)));
        popStyle();
        break;

      case 'rawHtml': {
        if (!allowRawHtml) break;
        const rawTag = parseRawHtmlTag(TD.decode(u8.subarray(tok.s, tok.e)));
        if (!rawTag) break;
        const tagName = rawTag.name;

        const styleTag = (
          tagName === 'strong' || tagName === 'b' ? 'strong' :
          tagName === 'em' || tagName === 'i' ? 'em' :
          tagName === 'code' || tagName === 'kbd' ? 'code' :
          tagName === 'del' || tagName === 's' ? 'strike' :
          tagName === 'a' ? 'a' :
          tagName === 'small' ? 'small' :
          tagName === 'sup' ? 'sup' :
          tagName === 'sub' ? 'sub' :
          tagName === 'u' ? 'u' :
          tagName === 'mark' ? 'mark' :
          tagName === 'abbr' ? 'abbr' :
          tagName === 'span' ? 'span' :
          null
        );

        if (rawTag.closing) {
          if (styleTag) {
            popRawStyle(styleTag);
          }
          break;
        }

        if (tagName === 'br') {
          if (line.length) {
            flushLine();
          } else {
            currentY += (currentStyle.size || FONT_SIZE.base) * LINE_HEIGHT_MULTIPLIER;
            currentX = x;
          }
          break;
        }

        if (tagName === 'img') {
          const rawSrc = rawTag.attrs.get('src') ?? '';
          if (rawSrc) {
            const altText = rawTag.attrs.get('alt') ?? '';
            renderInlineImage(rawSrc, altText);
          }
          break;
        }

        if (styleTag) {
          if (styleTag === 'strong') {
            pushRawStyle(styleTag, { bold: true });
          } else if (styleTag === 'em') {
            pushRawStyle(styleTag, { italic: true });
          } else if (styleTag === 'code') {
            const surroundingSize = currentStyle.size || FONT_SIZE.base;
            const codeSize = Math.round(surroundingSize * 0.9);
            pushRawStyle(styleTag, { code: true, color: themeColors.inlineCodeText, size: codeSize });
          } else if (styleTag === 'strike') {
            pushRawStyle(styleTag, { strike: true });
          } else if (styleTag === 'a') {
            const rawHref = rawTag.attrs.get('href') ?? '';
            if (rawHref) {
              const resolvedHref = resolveUrlRelativeToBase(rawHref, baseUrl);
              if (allowlist(resolvedHref)) {
                pushRawStyle(styleTag, { link: true, color: themeColors.link, underline: true });
              }
            }
          } else if (styleTag === 'small') {
            const size = Math.max(10, Math.round((currentStyle.size || FONT_SIZE.base) * 0.9));
            pushRawStyle(styleTag, { size });
          } else if (styleTag === 'sup' || styleTag === 'sub') {
            const size = Math.max(9, Math.round((currentStyle.size || FONT_SIZE.base) * 0.75));
            pushRawStyle(styleTag, { size });
          } else if (styleTag === 'u') {
            pushRawStyle(styleTag, { underline: true });
          } else if (styleTag === 'mark') {
            pushRawStyle(styleTag, { highlight: true });
          } else if (styleTag === 'abbr' || styleTag === 'span') {
            // Preserve nesting semantics even when no visual style changes.
            pushRawStyle(styleTag, {});
          }

          if (rawTag.selfClosing) {
            popRawStyle(styleTag);
          }
        }
        break;
      }

      case 'emOpen':
        pushStyle({ italic: true });
        break;

      case 'emClose':
        popStyle();
        break;

      case 'strongOpen':
        pushStyle({ bold: true });
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
  };

  processRange(s, e, 0);

  if (line.length) flushLine();
  return { x: currentX, y: currentY };
}

type RenderCanvasOptions = {
  skipClear?: boolean;
  onImageLoad?: () => void;
  parserOptions?: ParserOptions;
  dpr?: number;
  themeColors?: CanvasThemeColors;
};

export function renderCanvasToContext(
  u8: Uint8Array,
  ctx: CanvasRenderingContext2D,
  isMeasure: boolean,
  opts: RenderCanvasOptions = {},
): number {
  return renderCanvas(u8, ctx, isMeasure, opts);
}

function renderCanvas(
  u8: Uint8Array,
  ctx: CanvasRenderingContext2D,
  isMeasure: boolean,
  opts: RenderCanvasOptions = {},
): number {
  const parserOptions = opts.parserOptions ?? {};
  const urlAllowlist = parserOptions.urlAllowlist ?? defaultUrlAllowlist;
  const baseUrl = parserOptions.baseUrl;
  const dpr = opts.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const logicalWidth = ctx.canvas.width / dpr;
  const logicalHeight = ctx.canvas.height / dpr;

  const previousThemeOverride = canvasThemeColorsOverride;
  if (opts.themeColors) {
    canvasThemeColorsOverride = opts.themeColors;
  }

  // Get theme-aware colors
  const themeColors = getThemeColors();
  
  if (!isMeasure) {
    if (!opts.skipClear) {
      // Clear to transparent so destination-over backgrounds work correctly
      // Use logical dimensions since context is scaled
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    }
    ctx.fillStyle = themeColors.text;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }

  ctx.textBaseline = 'top';

  let y = MARGIN;
  let indent = 0;
  const maxWidth = logicalWidth - 2 * MARGIN;
  let paraOpen = false;
  let currentX = MARGIN;
  const listStack: CanvasListItem[] = [];
  const orderedMarkerWidths: number[] = [];
  let inCode = false;
  let codeY = 0;
  let codeHeight = 0;
  let codeWidth = 0;
  let codeBuffer: Array<{ s: number; e: number }> | null = null;
  let codeLang: string | undefined = undefined;
  const codeBlocks: { x: number; y: number; width: number; height: number }[] = [];
  const blockquotes: { x: number; y: number; width: number; height: number }[] = [];
  let inBlockquote = false;
  let blockquoteY = 0;
  let tableColWidths: number[] = [];
  let tableAlignments: Array<'left' | 'center' | 'right'> = [];
  const infoBlocks: { x: number; y: number; width: number; height: number; type: string }[] = [];
  let inInfo = false;
  let infoY = 0;
  let infoType = 'info';
  let pendingTableHeader: { cells: Array<{ s: number; e: number; align: 'left' | 'center' | 'right' }> } | null = null;
  let pendingTableRows: Array<{ cells: Array<{ s: number; e: number }> }> = [];
  let pendingRawHtmlTableLines: string[] | null = null;
  const utf8Encoder = new TextEncoder();

  const closePara = (): void => {
    if (paraOpen) {
      paraOpen = false;
      y += (FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER) / 2;
    }
  };

  const closeListsAll = (): void => {
    while (listStack.length) {
      listStack.pop();
      indent -= INDENT;
      y += (FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER) / 2;
    }
  };

  const flushPendingRawHtmlTable = (): void => {
    if (!pendingRawHtmlTableLines || pendingRawHtmlTableLines.length === 0) {
      pendingRawHtmlTableLines = null;
      return;
    }

    const parsed = parseRawHtmlTableModel(pendingRawHtmlTableLines);
    if (parsed) {
      y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER;
      y = renderRawHtmlTableModel(
        parsed,
        ctx,
        y,
        indent,
        maxWidth - indent,
        isMeasure,
        themeColors,
        opts.onImageLoad,
        urlAllowlist,
        baseUrl,
      );
      y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER;
      pendingRawHtmlTableLines = null;
      return;
    }

    const baseSize = FONT_SIZE.base;
    for (const rawLine of pendingRawHtmlTableLines) {
      const rawBytes = utf8Encoder.encode(rawLine);
      const rawRes = drawInline(
        rawBytes,
        0,
        rawBytes.length,
        ctx,
        MARGIN + indent,
        y,
        maxWidth - indent,
        isMeasure,
        { size: baseSize, color: themeColors.text },
        opts.onImageLoad,
        urlAllowlist,
        baseUrl,
        parserOptions.allowRawHtml === true,
        true,
      );
      if (rawRes.y > y) {
        y = rawRes.y;
      }
    }

    pendingRawHtmlTableLines = null;
  };

  const blockParseOptions = parserOptions.allowRawHtml ? { allowRawHtml: true } : undefined;
  for (const ev of blocks(u8, blockParseOptions)) {
    if (pendingRawHtmlTableLines && ev.type !== 'rawHtmlLine') {
      flushPendingRawHtmlTable();
    }

    switch (ev.type) {
      case 'bqOpen':
        closePara();
        closeListsAll();
        if (!isMeasure && !inBlockquote) {
          blockquoteY = y;
          inBlockquote = true;
        }
        indent += INDENT;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.2;
        break;

      case 'bqClose':
        closePara();
        closeListsAll();
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.0;
        if (!isMeasure && inBlockquote) {
          const bqPadding = 10;
          blockquotes.push({
            x: MARGIN + indent - INDENT - bqPadding,
            y: blockquoteY,
            width: maxWidth - (indent - INDENT) + bqPadding * 2,
            height: y - blockquoteY,
          });
          inBlockquote = false;
        }
        indent -= INDENT;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.2;
        break;

      case 'hr':
        closePara();
        closeListsAll();
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER;
        if (!isMeasure) {
          ctx.strokeStyle = themeColors.hr;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(MARGIN + indent, y);
          ctx.lineTo(maxWidth + MARGIN - indent, y);
          ctx.stroke();
          const centerX = (MARGIN + indent + maxWidth + MARGIN - indent) / 2;
          ctx.fillStyle = themeColors.accent;
          ctx.fillRect(centerX - 30, y - 1, 60, 2);
          ctx.fillStyle = themeColors.text;
        }
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER;
        break;

      case 'heading': {
        closePara();
        closeListsAll();
        const level = ev.level - 1;
        const hSize = FONT_SIZE.heading[level];
        y += hSize * LINE_HEIGHT_MULTIPLIER * 0.5;
        const hRes = drawInline(
          u8,
          ev.s,
          ev.e,
          ctx,
          MARGIN + indent,
          y,
          maxWidth - indent,
          isMeasure,
          { bold: true, size: hSize },
          opts.onImageLoad,
          urlAllowlist,
          baseUrl,
          parserOptions.allowRawHtml === true,
          true,
        );
        y = hRes.y;
        if (!isMeasure && (level === 0 || level === 1)) {
          const borderY = y + hSize * 0.2;
          ctx.strokeStyle = themeColors.border;
          ctx.lineWidth = level === 0 ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(MARGIN + indent, borderY);
          ctx.lineTo(maxWidth + MARGIN - indent, borderY);
          ctx.stroke();
          y += hSize * 0.4;
        }
        y += hSize * LINE_HEIGHT_MULTIPLIER * 0.5;
        break;
      }

      case 'listOpen':
        closePara();
        listStack.push({ kind: ev.kind, counter: 1 });
        indent += INDENT;
        if (ev.kind === 'ol') {
          const font = getFontString(true, false, FONT_SIZE.base, false);
          ctx.font = font;
          orderedMarkerWidths[listStack.length - 1] = measureWidth(ctx, '1.', font);
        }
        break;

      case 'listItem': {
        closePara();
        const baseSize = FONT_SIZE.base;
        const level = listStack.length - 1;
        const bqOffset = inBlockquote ? 20 : 0;
        const infoOffset = inInfo ? 24 : 0;
        const textStart = MARGIN + indent + bqOffset + infoOffset;

        const top = listStack[listStack.length - 1];
        const isOrdered = !!(top && top.kind === 'ol');
        let markerText = '';
        if (isOrdered) {
          markerText = `${top.counter}.`;
          const font = getFontString(true, false, baseSize, false);
          ctx.font = font;
          const measured = measureWidth(ctx, markerText, font);
          const currentMax = orderedMarkerWidths[level] || 0;
          if (measured > currentMax) orderedMarkerWidths[level] = measured;
          top.counter += 1;
        }

        const markerWidth = isOrdered
          ? orderedMarkerWidths[level] || (markerText ? measureWidth(ctx, markerText, ctx.font) : BULLET_RADIUS * 2)
          : BULLET_RADIUS * 2;
        const availableWidth = maxWidth - (textStart - MARGIN) - infoOffset;

        if (!isMeasure) {
          ctx.fillStyle = themeColors.listMarker;
          if (isOrdered) {
            ctx.font = ORDERED_MARKER_FONT;
            const markerX = textStart - markerWidth - MARKER_GAP;
            const markerY = y + baseSize * 0.5;
            const prevBaseline: CanvasTextBaseline = ctx.textBaseline;
            ctx.textBaseline = 'middle';
            ctx.fillText(markerText, markerX, markerY);
            ctx.textBaseline = prevBaseline;
          } else {
            const bulletX = textStart - MARKER_GAP - BULLET_RADIUS;
            const bulletY = y + baseSize * 0.5;
            ctx.beginPath();
            ctx.arc(bulletX, bulletY, BULLET_RADIUS, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = themeColors.text;
        }

        const liRes = drawInline(
          u8,
          ev.s,
          ev.e,
          ctx,
          textStart,
          y,
          availableWidth,
          isMeasure,
          { size: baseSize },
          opts.onImageLoad,
          urlAllowlist,
          baseUrl,
          parserOptions.allowRawHtml === true,
          true,
        );
        y = liRes.y + baseSize * 0.8;
        break;
      }

      case 'listClose':
        closePara();
        while (listStack.length) {
          const top = listStack.pop()!;
          indent -= INDENT;
          orderedMarkerWidths.length = listStack.length;
          if (top.kind === ev.kind) break;
        }
        break;

      case 'paraLine': {
        const baseSize = FONT_SIZE.base;
        ctx.font = baseSize + 'px ' + FONT_STACK;
        const bqOffset = inBlockquote ? 20 : 0;
        const infoOffset = inInfo ? 24 : 0;
        const textStart = MARGIN + indent + bqOffset + infoOffset;

        if (!paraOpen) {
          closeListsAll();
          paraOpen = true;
          y += baseSize * LINE_HEIGHT_MULTIPLIER * (inBlockquote ? 0.25 : 0.3);
        } else {
          // Each paraLine is a new line in the source, start fresh
          y += baseSize * LINE_HEIGHT_MULTIPLIER;
        }
        
        currentX = textStart;

        const pRes = drawInline(
          u8,
          ev.s,
          ev.e,
          ctx,
          currentX,
          y,
          maxWidth - indent - bqOffset - infoOffset,
          isMeasure,
          { size: baseSize, color: inBlockquote ? themeColors.textSecondary : themeColors.text, italic: inBlockquote },
          opts.onImageLoad,
          urlAllowlist,
          baseUrl,
          parserOptions.allowRawHtml === true,
        );
        currentX = pRes.x;
        y = pRes.y;
        break;
      }

      case 'rawHtmlLine': {
        if (parserOptions.allowRawHtml === true) {
          const rawLine = TD.decode(u8.subarray(ev.s, ev.e));
          const opensTable = RAW_HTML_TABLE_START_RE.test(rawLine);
          const closesTable = RAW_HTML_TABLE_END_RE.test(rawLine);

          if (pendingRawHtmlTableLines) {
            pendingRawHtmlTableLines.push(rawLine);
            if (closesTable) {
              flushPendingRawHtmlTable();
            }
            break;
          }

          if (opensTable) {
            closePara();
            closeListsAll();
            pendingRawHtmlTableLines = [rawLine];
            if (closesTable) {
              flushPendingRawHtmlTable();
            }
            break;
          }
        }

        closePara();
        closeListsAll();
        const baseSize = FONT_SIZE.base;
        const textStart = MARGIN + indent;
        const beforeY = y;
        const rawRes = drawInline(
          u8,
          ev.s,
          ev.e,
          ctx,
          textStart,
          y,
          maxWidth - indent,
          isMeasure,
          { size: baseSize, color: themeColors.text },
          opts.onImageLoad,
          urlAllowlist,
          baseUrl,
          parserOptions.allowRawHtml === true,
          true,
        );
        if (rawRes.y > beforeY) {
          y = rawRes.y;
        }
        break;
      }

      case 'codeOpen':
        closePara();
        closeListsAll();
        inCode = true;
        codeBuffer = [];
        codeLang = ev.info?.lang;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.5;
        codeY = y;
        codeWidth = 0;
        codeHeight = 0;
        break;

      case 'codeText':
        if (inCode && codeBuffer) {
          codeBuffer.push({ s: ev.s, e: ev.e });
        }
        break;

      case 'codeClose':
        if (inCode && codeBuffer) {
          inCode = false;
          
          // Concatenate all code lines with newlines
          let totalLen = 0;
          for (const span of codeBuffer) {
            totalLen += span.e - span.s;
            totalLen += 1; // newline
          }
          
          const codeBytes = totalLen > 0 ? new Uint8Array(totalLen) : new Uint8Array(0);
          
          if (totalLen > 0) {
            let offset = 0;
            for (const span of codeBuffer) {
              const slice = u8.subarray(span.s, span.e);
              codeBytes.set(slice, offset);
              offset += slice.length;
              codeBytes[offset++] = 0x0a; // newline
            }
          }
          
          // Render highlighted code
          const codePaddingX = 12;
          const codePaddingY = 10;
          
          const result = renderHighlightedCode(
            codeBytes,
            codeLang,
            ctx,
            MARGIN + indent + codePaddingX,
            y,
            isMeasure,
          );
          
          codeWidth = result.width;
          codeHeight = result.height;
          y = result.y;
          
          if (!isMeasure) {
            codeBlocks.push({
              x: MARGIN + indent - codePaddingX / 2,
              y: codeY - codePaddingY,
              width: codeWidth + codePaddingX * 2,
              height: codeHeight + codePaddingY * 2,
            });
          }
          
          codeBuffer = null;
          codeLang = undefined;
          y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.5;
        }
        break;

      case 'tableOpen':
        closePara();
        closeListsAll();
        pendingTableHeader = null;
        pendingTableRows = [];
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER;
        break;

      case 'tableHeader':
        // Store header for later processing
        pendingTableHeader = ev;
        break;

      case 'tableRow':
        // Store row for later processing
        pendingTableRows.push(ev);
        break;

      case 'tableClose': {
        if (pendingTableHeader) {
          const cellPadding = 10;
          const headerRowHeight = FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 2;
          const dataRowHeight = FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.8;
          
          // Calculate column widths from all rows (header + data)
          const numCols = pendingTableHeader.cells.length;
          tableColWidths = new Array(numCols).fill(80); // minimum width
          tableAlignments = pendingTableHeader.cells.map(c => c.align);
          
          // Measure header cells
          for (let i = 0; i < pendingTableHeader.cells.length; i++) {
            const cell = pendingTableHeader.cells[i];
            ctx.font = 'bold ' + FONT_SIZE.base + 'px ' + FONT_STACK;
            const width = measureInlineContent(u8, cell.s, cell.e, ctx, FONT_SIZE.base);
            tableColWidths[i] = Math.max(tableColWidths[i], width + cellPadding * 2);
          }
          
          // Measure data row cells
          for (const row of pendingTableRows) {
            for (let i = 0; i < Math.min(row.cells.length, numCols); i++) {
              const cell = row.cells[i];
              ctx.font = FONT_SIZE.base + 'px ' + FONT_STACK;
              const width = measureInlineContent(u8, cell.s, cell.e, ctx, FONT_SIZE.base);
              tableColWidths[i] = Math.max(tableColWidths[i], width + cellPadding * 2);
            }
          }
          
          // Calculate table dimensions
          const tableWidth = tableColWidths.reduce((sum, w) => sum + w, 0);
          const tableHeight = headerRowHeight + pendingTableRows.length * dataRowHeight;
          const tableX = MARGIN + indent;
          const tableY = y;
          const tableRadius = 4;
          
          // Draw table background with rounded corners
          if (!isMeasure) {
            ctx.save();
            ctx.fillStyle = themeColors.bgSecondary;
            ctx.beginPath();
            ctx.moveTo(tableX + tableRadius, tableY);
            ctx.lineTo(tableX + tableWidth - tableRadius, tableY);
            ctx.quadraticCurveTo(tableX + tableWidth, tableY, tableX + tableWidth, tableY + tableRadius);
            ctx.lineTo(tableX + tableWidth, tableY + tableHeight - tableRadius);
            ctx.quadraticCurveTo(tableX + tableWidth, tableY + tableHeight, tableX + tableWidth - tableRadius, tableY + tableHeight);
            ctx.lineTo(tableX + tableRadius, tableY + tableHeight);
            ctx.quadraticCurveTo(tableX, tableY + tableHeight, tableX, tableY + tableHeight - tableRadius);
            ctx.lineTo(tableX, tableY + tableRadius);
            ctx.quadraticCurveTo(tableX, tableY, tableX + tableRadius, tableY);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
          
          // Render header row
          if (!isMeasure) {
            let x = MARGIN + indent;
            for (let i = 0; i < pendingTableHeader.cells.length; i++) {
              const cell = pendingTableHeader.cells[i];
              const cellWidth = tableColWidths[i];
              
              // Header border
              ctx.strokeStyle = themeColors.border;
              ctx.lineWidth = 1;
              ctx.strokeRect(x, y, cellWidth, headerRowHeight);
              
              // Header text with inline rendering
              const textY = y + (headerRowHeight - FONT_SIZE.base) / 2;
              renderCellContent(
                u8,
                cell.s,
                cell.e,
                ctx,
                x + cellPadding,
                textY,
                cellWidth - cellPadding * 2,
                FONT_SIZE.base,
                cell.align,
                themeColors.text,
              );
              
              x += cellWidth;
            }
          }
          y += headerRowHeight;
          
          // Render data rows
          for (let rowIdx = 0; rowIdx < pendingTableRows.length; rowIdx++) {
            const row = pendingTableRows[rowIdx];
            let x = MARGIN + indent;
            
            // Add subtle alternating row background
            if (!isMeasure && rowIdx % 2 === 1) {
              ctx.fillStyle = 'rgba(0, 0, 0, 0.02)';
              ctx.fillRect(tableX, y, tableWidth, dataRowHeight);
            }
            
            for (let i = 0; i < Math.min(row.cells.length, numCols); i++) {
              const cell = row.cells[i];
              const cellWidth = tableColWidths[i];
              const align = tableAlignments[i] || 'left';
              
              if (!isMeasure) {
                // Cell border
                ctx.strokeStyle = themeColors.border;
                ctx.lineWidth = 1;
                ctx.strokeRect(x, y, cellWidth, dataRowHeight);
                
                // Cell text with inline rendering
                const textY = y + (dataRowHeight - FONT_SIZE.base) / 2;
                renderCellContent(
                  u8,
                  cell.s,
                  cell.e,
                  ctx,
                  x + cellPadding,
                  textY,
                  cellWidth - cellPadding * 2,
                  FONT_SIZE.base,
                  align,
                  themeColors.textSecondary,
                );
              }
              
              x += cellWidth;
            }
            y += dataRowHeight;
          }
          
          // Reset table state
          pendingTableHeader = null;
          pendingTableRows = [];
          tableColWidths = [];
          tableAlignments = [];
          y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER;
        }
        break;
      }

      case 'infoOpen':
        closePara();
        closeListsAll();
        inInfo = true;
        infoY = y;
        infoType = ev.infoType;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.0;
        break;

      case 'infoClose':
        closePara();
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.0;
        
        if (!isMeasure && inInfo) {
          // Padding for info blocks
          const verticalPadding = 12;
          const horizontalPadding = 16;
          const infoHeight = y - infoY + verticalPadding;
          infoBlocks.push({
            x: MARGIN + indent - horizontalPadding / 2,
            y: infoY - verticalPadding / 2,
            width: maxWidth + horizontalPadding,
            height: infoHeight,
            type: infoType,
          });
        }
        
        inInfo = false;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.2;
        break;
    }
  }

  if (pendingRawHtmlTableLines) {
    flushPendingRawHtmlTable();
  }

  closePara();
  closeListsAll();

  if (inCode && !isMeasure) {
    codeBlocks.push({
      x: MARGIN + indent - 5,
      y: codeY - 5,
      width: codeWidth + 20,
      height: codeHeight + 10,
    });
    y += 10;
  }

  if (inBlockquote && !isMeasure) {
    blockquotes.push({
      x: MARGIN + indent - INDENT - 5,
      y: blockquoteY,
      width: maxWidth - (indent - INDENT) + 10,
      height: y - blockquoteY,
    });
  }

  // Draw collected backgrounds after content
  if (!isMeasure) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    
    // Draw code block backgrounds
    for (const block of codeBlocks) {
      ctx.fillStyle = themeColors.codeBg;
      ctx.beginPath();
      const radius = 4;
      ctx.moveTo(block.x + radius, block.y);
      ctx.lineTo(block.x + block.width - radius, block.y);
      ctx.quadraticCurveTo(block.x + block.width, block.y, block.x + block.width, block.y + radius);
      ctx.lineTo(block.x + block.width, block.y + block.height - radius);
      ctx.quadraticCurveTo(block.x + block.width, block.y + block.height, block.x + block.width - radius, block.y + block.height);
      ctx.lineTo(block.x + radius, block.y + block.height);
      ctx.quadraticCurveTo(block.x, block.y + block.height, block.x, block.y + block.height - radius);
      ctx.lineTo(block.x, block.y + radius);
      ctx.quadraticCurveTo(block.x, block.y, block.x + radius, block.y);
      ctx.closePath();
      ctx.fill();
    }
    
    // Draw blockquote backgrounds with rounded corners
    for (const bq of blockquotes) {
      const radius = 4;
      // Background
      ctx.fillStyle = themeColors.bgSecondary;
      ctx.beginPath();
      ctx.moveTo(bq.x + radius, bq.y);
      ctx.lineTo(bq.x + bq.width - radius, bq.y);
      ctx.quadraticCurveTo(bq.x + bq.width, bq.y, bq.x + bq.width, bq.y + radius);
      ctx.lineTo(bq.x + bq.width, bq.y + bq.height - radius);
      ctx.quadraticCurveTo(bq.x + bq.width, bq.y + bq.height, bq.x + bq.width - radius, bq.y + bq.height);
      ctx.lineTo(bq.x + radius, bq.y + bq.height);
      ctx.quadraticCurveTo(bq.x, bq.y + bq.height, bq.x, bq.y + bq.height - radius);
      ctx.lineTo(bq.x, bq.y + radius);
      ctx.quadraticCurveTo(bq.x, bq.y, bq.x + radius, bq.y);
      ctx.closePath();
      ctx.fill();
      
      // Left border (5px wide)
      ctx.fillStyle = themeColors.blockquoteBorder;
      ctx.fillRect(bq.x, bq.y + radius, 5, bq.height - radius * 2);
      // Top rounded part of border
      ctx.beginPath();
      ctx.moveTo(bq.x, bq.y + radius);
      ctx.lineTo(bq.x, bq.y + 5);
      ctx.quadraticCurveTo(bq.x, bq.y, bq.x + 5, bq.y);
      ctx.lineTo(bq.x + 5, bq.y + radius);
      ctx.closePath();
      ctx.fill();
      // Bottom rounded part of border
      ctx.beginPath();
      ctx.moveTo(bq.x, bq.y + bq.height - radius);
      ctx.lineTo(bq.x + 5, bq.y + bq.height - radius);
      ctx.lineTo(bq.x + 5, bq.y + bq.height - 5);
      ctx.quadraticCurveTo(bq.x + 5, bq.y + bq.height, bq.x, bq.y + bq.height);
      ctx.lineTo(bq.x, bq.y + bq.height - radius);
      ctx.closePath();
      ctx.fill();
    }
    
    // Draw info block backgrounds
    for (const info of infoBlocks) {
      const colors = INFO_COLORS[info.type as keyof typeof INFO_COLORS];
      const radius = 4;
      
      // Draw rounded background
      ctx.fillStyle = colors.bg;
      ctx.beginPath();
      ctx.moveTo(info.x + radius, info.y);
      ctx.lineTo(info.x + info.width - radius, info.y);
      ctx.quadraticCurveTo(info.x + info.width, info.y, info.x + info.width, info.y + radius);
      ctx.lineTo(info.x + info.width, info.y + info.height - radius);
      ctx.quadraticCurveTo(info.x + info.width, info.y + info.height, info.x + info.width - radius, info.y + info.height);
      ctx.lineTo(info.x + radius, info.y + info.height);
      ctx.quadraticCurveTo(info.x, info.y + info.height, info.x, info.y + info.height - radius);
      ctx.lineTo(info.x, info.y + radius);
      ctx.quadraticCurveTo(info.x, info.y, info.x + radius, info.y);
      ctx.closePath();
      ctx.fill();
      
      // Draw left border (5px wide for better visibility)
      ctx.fillStyle = colors.border;
      ctx.fillRect(info.x, info.y + radius, 5, info.height - radius * 2);
      // Top rounded part of border
      ctx.beginPath();
      ctx.moveTo(info.x, info.y + radius);
      ctx.lineTo(info.x, info.y + 5);
      ctx.quadraticCurveTo(info.x, info.y, info.x + 5, info.y);
      ctx.lineTo(info.x + 5, info.y + radius);
      ctx.closePath();
      ctx.fill();
      // Bottom rounded part of border
      ctx.beginPath();
      ctx.moveTo(info.x, info.y + info.height - radius);
      ctx.lineTo(info.x + 5, info.y + info.height - radius);
      ctx.lineTo(info.x + 5, info.y + info.height - 5);
      ctx.quadraticCurveTo(info.x + 5, info.y + info.height, info.x, info.y + info.height);
      ctx.lineTo(info.x, info.y + info.height - radius);
      ctx.closePath();
      ctx.fill();
    }
    
    // Finally, fill the main background behind everything
    // Use logical dimensions since context is scaled
    ctx.fillStyle = themeColors.bg;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    
    ctx.restore();
  }

  canvasThemeColorsOverride = previousThemeOverride;
  return y;
}

function renderToCanvasFromBlocksMainThread(u8: Uint8Array, canvas: HTMLCanvasElement, options: ParserOptions = {}): void {
  ensureMainThreadShutdownHook();
  const dpr = window.devicePixelRatio || 1;
  canvas.dataset.renderReady = 'pending';
  canvas.dataset.virtualized = 'false';
  const rect = canvas.getBoundingClientRect();
  const styleWidth = rect.width || 800;
  const scrollEl = canvas.parentElement?.closest('.canvas-scroll') as HTMLElement | null;
  const spacer = scrollEl?.querySelector<HTMLDivElement>('#canvas-spacer') ?? null;

  // Set up re-render callback for when images load
  const rerender = () => {
    // Re-render the canvas when an image finishes loading
    renderToCanvasFromBlocksMainThread(u8, canvas, options);
  };

  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = styleWidth * dpr;
  measureCanvas.height = 1;
  const measureCtx = measureCanvas.getContext('2d', { 
    willReadFrequently: false 
  });
  if (!measureCtx) {
    delete canvas.dataset.renderReady;
    delete canvas.dataset.virtualized;
    return;
  }
  
  // Enable emoji rendering support
  if ('fontKerning' in measureCtx) {
    (measureCtx as any).fontKerning = 'normal';
  }
  if ('textRendering' in measureCtx) {
    (measureCtx as any).textRendering = 'optimizeLegibility';
  }
  
  measureCtx.scale(dpr, dpr);
  const totalHeight = renderCanvas(u8, measureCtx, true, { onImageLoad: rerender, parserOptions: options }) + MARGIN * 2;

  const viewportHeight = scrollEl ? scrollEl.clientHeight : totalHeight;
  // Use a dynamic threshold relative to current viewport height (2x viewport)
  const needsVirtualScroll = scrollEl ? (totalHeight > viewportHeight * 2) : (totalHeight > VIRTUAL_SCROLL_THRESHOLD);

  if (!needsVirtualScroll || !scrollEl) {
    canvas.width = styleWidth * dpr;
    canvas.height = totalHeight * dpr;
    canvas.style.width = `${styleWidth}px`;
    canvas.style.height = `${totalHeight}px`;
    canvas.style.position = 'static';
    const ctx = canvas.getContext('2d', { 
      willReadFrequently: false,
      alpha: true
    });
    if (!ctx) return;
    
    // Enable emoji rendering support
    if ('fontKerning' in ctx) {
      (ctx as any).fontKerning = 'normal';
    }
    if ('textRendering' in ctx) {
      (ctx as any).textRendering = 'optimizeLegibility';
    }
    
    ctx.scale(dpr, dpr);
    renderCanvas(u8, ctx, false, { onImageLoad: rerender, parserOptions: options });
    canvas.dataset.virtualized = 'false';
    canvas.dataset.renderReady = 'ready';
    if (spacer) spacer.style.height = '0px';
    const prev = canvasStates.get(canvas);
    if (prev?.scrollEl && prev.onScroll) {
      prev.scrollEl.removeEventListener('scroll', prev.onScroll);
      canvasStates.delete(canvas);
      activeMainThreadCanvases.delete(canvas);
    }
    return;
  }

  if (spacer) spacer.style.height = `${totalHeight}px`;

  const offscreen = document.createElement('canvas');
  offscreen.width = styleWidth * dpr;
  offscreen.height = Math.ceil(totalHeight) * dpr;
  const offscreenCtx = offscreen.getContext('2d', {
    willReadFrequently: false,
    alpha: true
  });
  if (!offscreenCtx) return;
  
  // Enable emoji rendering support
  if ('fontKerning' in offscreenCtx) {
    (offscreenCtx as any).fontKerning = 'normal';
  }
  if ('textRendering' in offscreenCtx) {
    (offscreenCtx as any).textRendering = 'optimizeLegibility';
  }
  
  offscreenCtx.scale(dpr, dpr);
  renderCanvas(u8, offscreenCtx, false, { onImageLoad: rerender, parserOptions: options });

  canvas.width = styleWidth * dpr;
  canvas.height = viewportHeight * dpr;
  canvas.style.width = `${styleWidth}px`;
  canvas.style.height = `${viewportHeight}px`;
  canvas.style.position = 'sticky';
  canvas.style.top = '0';
  canvas.style.left = '0';
  const ctx = canvas.getContext('2d', {
    willReadFrequently: false,
    alpha: true
  });
  if (!ctx) return;
  
  // Enable emoji rendering support
  if ('fontKerning' in ctx) {
    (ctx as any).fontKerning = 'normal';
  }
  if ('textRendering' in ctx) {
    (ctx as any).textRendering = 'optimizeLegibility';
  }

  const state: CanvasRenderState = {
    dpr,
    styleWidth,
    totalHeight,
    offscreen,
    ctx,
    scrollEl,
    spacer,
  };

  const renderViewport = () => {
    const rawScrollTop = scrollEl.scrollTop;
    // Clamp scroll to prevent showing empty space at the bottom
    const maxScroll = Math.max(0, totalHeight - viewportHeight);
    const scrollTop = Math.min(rawScrollTop, maxScroll);

    // Reset transform and work in bitmap pixels
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Copy the visible portion from offscreen canvas (all in bitmap pixels)
    ctx.drawImage(
      offscreen,
      0,                    // source x (bitmap pixels)
      scrollTop * dpr,      // source y (bitmap pixels)
      styleWidth * dpr,     // source width (bitmap pixels)
      viewportHeight * dpr, // source height (bitmap pixels)
      0,                    // dest x (bitmap pixels)
      0,                    // dest y (bitmap pixels)
      styleWidth * dpr,     // dest width (bitmap pixels)
      viewportHeight * dpr, // dest height (bitmap pixels)
    );
  };

  const prevState = canvasStates.get(canvas);
  if (prevState?.onScroll) {
    prevState.scrollEl.removeEventListener('scroll', prevState.onScroll);
    activeMainThreadCanvases.delete(canvas);
  }

  const scrollHandler = () => requestAnimationFrame(renderViewport);
  state.onScroll = scrollHandler;
  canvasStates.set(canvas, state);
  activeMainThreadCanvases.add(canvas);

  scrollEl.addEventListener('scroll', scrollHandler, { passive: true });

  renderViewport();
  canvas.dataset.virtualized = 'true';
  canvas.dataset.renderReady = 'ready';
}

function htmlCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Failed to encode canvas image'));
      }, 'image/png');
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

type WorkerRenderParserOptions = Pick<ParserOptions, 'allowRawHtml' | 'baseUrl'>;

type WorkerInitMessage = {
  type: 'init';
  canvas: OffscreenCanvas;
};

type WorkerRenderMessage = {
  type: 'render';
  requestId: number;
  markdownBuffer: ArrayBufferLike;
  width: number;
  dpr: number;
  parserOptions: WorkerRenderParserOptions;
  themeColors: CanvasThemeColors;
};

type WorkerExportMessage = {
  type: 'export';
  requestId: number;
};

type WorkerInputMessage = WorkerInitMessage | WorkerRenderMessage | WorkerExportMessage;

type WorkerRenderedMessage = {
  type: 'rendered';
  requestId: number;
  width: number;
  height: number;
};

type WorkerErrorMessage = {
  type: 'error';
  requestId?: number;
  message: string;
};

type WorkerExportedMessage = {
  type: 'exported';
  requestId: number;
  blob: Blob;
};

type WorkerOutputMessage =
  | WorkerRenderedMessage
  | WorkerExportedMessage
  | WorkerErrorMessage;

type PendingCanvasExport = {
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

interface WorkerCanvasState {
  worker: Worker | null;
  requestId: number;
  exportRequestId: number;
  pendingExports: Map<number, PendingCanvasExport>;
  disabled: boolean;
}

const workerCanvasStates = new WeakMap<HTMLCanvasElement, WorkerCanvasState>();
const activeCanvasWorkers = new Set<Worker>();
let workerShutdownHookInstalled = false;

function rejectPendingWorkerExports(state: WorkerCanvasState, message: string): void {
  for (const pending of state.pendingExports.values()) {
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    pending.reject(new Error(message));
  }
  state.pendingExports.clear();
}

function terminateWorkerState(state: WorkerCanvasState): void {
  rejectPendingWorkerExports(state, 'Canvas worker terminated');
  if (state.worker) {
    try {
      state.worker.terminate();
    } catch {
      // ignore termination errors
    }
    activeCanvasWorkers.delete(state.worker);
  }
  state.worker = null;
  state.disabled = true;
}

function ensureWorkerShutdownHook(): void {
  if (workerShutdownHookInstalled) return;
  if (typeof window === 'undefined') return;
  workerShutdownHookInstalled = true;
  const shutdown = (): void => {
    for (const worker of activeCanvasWorkers) {
      try {
        worker.terminate();
      } catch {
        // ignore termination errors
      }
    }
    activeCanvasWorkers.clear();
  };
  window.addEventListener('pagehide', shutdown, { once: true });
}

function canUseWorkerCanvas(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'transferControlToOffscreen' in HTMLCanvasElement.prototype
  );
}

function cleanupMainThreadCanvasState(canvas: HTMLCanvasElement): void {
  const prev = canvasStates.get(canvas);
  if (prev?.scrollEl && prev.onScroll) {
    prev.scrollEl.removeEventListener('scroll', prev.onScroll);
    canvasStates.delete(canvas);
  }
  activeMainThreadCanvases.delete(canvas);
}

function getOrCreateWorkerCanvasState(canvas: HTMLCanvasElement): WorkerCanvasState | null {
  const existing = workerCanvasStates.get(canvas);
  if (existing) {
    return existing.disabled ? null : existing;
  }

  try {
    ensureWorkerShutdownHook();
    const worker = new Worker(new URL('./canvas-renderer.worker.ts', import.meta.url), { type: 'module' });
    activeCanvasWorkers.add(worker);
    const offscreen = canvas.transferControlToOffscreen();
    const state: WorkerCanvasState = {
      worker,
      requestId: 0,
      exportRequestId: 0,
      pendingExports: new Map<number, PendingCanvasExport>(),
      disabled: false,
    };

    worker.onmessage = (event: MessageEvent<WorkerOutputMessage>) => {
      const message = event.data;
      if (message.type === 'error') {
        if (typeof message.requestId === 'number') {
          const pending = state.pendingExports.get(message.requestId);
          if (pending) {
            if (pending.timeoutId) {
              clearTimeout(pending.timeoutId);
            }
            state.pendingExports.delete(message.requestId);
            pending.reject(new Error(message.message));
            return;
          }
        }
        console.error('[canvas-worker]', message.message);
        canvas.dataset.renderReady = 'error';
        return;
      }

      if (message.type === 'exported') {
        const pending = state.pendingExports.get(message.requestId);
        if (!pending) {
          return;
        }
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        state.pendingExports.delete(message.requestId);
        pending.resolve(message.blob);
        return;
      }

      if (message.type === 'rendered') {
        if (message.requestId !== state.requestId) {
          return;
        }
        canvas.style.width = `${message.width}px`;
        canvas.style.height = `${message.height}px`;
        canvas.style.position = 'static';
        canvas.dataset.virtualized = 'false';
        canvas.dataset.renderReady = 'ready';

        const scrollEl = canvas.parentElement?.closest('.canvas-scroll') as HTMLElement | null;
        const spacer = scrollEl?.querySelector<HTMLDivElement>('#canvas-spacer') ?? null;
        if (spacer) spacer.style.height = '0px';
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      console.error('[canvas-worker] fatal error', event.message || event.error);
      canvas.dataset.renderReady = 'error';
      terminateWorkerState(state);
    };

    worker.onmessageerror = () => {
      console.error('[canvas-worker] message deserialization failure');
      rejectPendingWorkerExports(state, 'Canvas worker message deserialization failure');
      canvas.dataset.renderReady = 'error';
    };

    worker.postMessage({ type: 'init', canvas: offscreen } satisfies WorkerInputMessage, [offscreen]);
    workerCanvasStates.set(canvas, state);
    return state;
  } catch (error) {
    console.warn('Failed to initialize canvas worker; falling back to main thread', error);
    const disabledState: WorkerCanvasState = {
      worker: null,
      requestId: 0,
      exportRequestId: 0,
      pendingExports: new Map<number, PendingCanvasExport>(),
      disabled: true,
    };
    workerCanvasStates.set(canvas, disabledState);
    return null;
  }
}

function renderToCanvasFromWorker(u8: Uint8Array, canvas: HTMLCanvasElement, options: ParserOptions): boolean {
  const workerState = getOrCreateWorkerCanvasState(canvas);
  if (!workerState) return false;
  if (!workerState.worker) return false;
  if (!canvas.isConnected) {
    terminateWorkerState(workerState);
    return false;
  }

  const rect = canvas.getBoundingClientRect();
  const styleWidth = rect.width || 800;
  const dpr = window.devicePixelRatio || 1;
  const parserOptions: WorkerRenderParserOptions = {
    ...(options.allowRawHtml !== undefined ? { allowRawHtml: options.allowRawHtml } : {}),
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
  };

  const themeColors = getThemeColors();
  // Never transfer the caller's original buffer ownership.
  const bufferView = u8.slice();
  const requestId = ++workerState.requestId;

  canvas.dataset.renderReady = 'pending';
  cleanupMainThreadCanvasState(canvas);

  workerState.worker.postMessage(
    {
      type: 'render',
      requestId,
      markdownBuffer: bufferView.buffer,
      width: styleWidth,
      dpr,
      parserOptions,
      themeColors,
    } satisfies WorkerRenderMessage,
    [bufferView.buffer],
  );

  return true;
}

function requestWorkerCanvasExport(state: WorkerCanvasState): Promise<Blob> {
  if (!state.worker || state.disabled) {
    return Promise.reject(new Error('Canvas worker is unavailable for export'));
  }

  // Keep export request ids in a high range to avoid colliding with render ids.
  const requestId = 1_000_000_000 + ++state.exportRequestId;
  return new Promise<Blob>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      state.pendingExports.delete(requestId);
      reject(new Error('Timed out while exporting canvas image'));
    }, 15_000);

    state.pendingExports.set(requestId, {
      resolve,
      reject,
      timeoutId,
    });

    try {
      state.worker?.postMessage({
        type: 'export',
        requestId,
      } satisfies WorkerExportMessage);
    } catch (error) {
      clearTimeout(timeoutId);
      state.pendingExports.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function exportCanvasAsImageBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const workerState = workerCanvasStates.get(canvas);
  if (workerState) {
    if (workerState.disabled || !workerState.worker) {
      throw new Error('Canvas worker renderer is unavailable for export');
    }
    return requestWorkerCanvasExport(workerState);
  }

  const virtualizedState = canvasStates.get(canvas);
  const sourceCanvas = virtualizedState?.offscreen ?? canvas;
  return htmlCanvasToBlob(sourceCanvas);
}

export function renderToCanvasFromBlocks(u8: Uint8Array, canvas: HTMLCanvasElement, options: ParserOptions = {}): void {
  const allowlist = options.urlAllowlist ?? defaultUrlAllowlist;
  const hasCustomAllowlist = allowlist !== defaultUrlAllowlist;
  const existingWorkerState = workerCanvasStates.get(canvas);

  if (existingWorkerState) {
    // Once a canvas is transferred to worker mode, it cannot safely return to
    // main-thread 2D rendering. Keep subsequent renders in worker mode only.
    if (existingWorkerState.disabled || !existingWorkerState.worker) {
      canvas.dataset.renderReady = 'error';
      console.error('[canvas-worker] renderer is unavailable for this canvas instance');
      return;
    }

    if (hasCustomAllowlist) {
      console.warn('[canvas-worker] custom urlAllowlist is not supported in worker mode; using default allowlist');
    }

    const renderedInWorker = renderToCanvasFromWorker(u8, canvas, options);
    if (renderedInWorker) {
      return;
    }

    canvas.dataset.renderReady = 'error';
    console.error('[canvas-worker] failed to dispatch render request');
    return;
  }

  if (!hasCustomAllowlist && canUseWorkerCanvas()) {
    const renderedInWorker = renderToCanvasFromWorker(u8, canvas, options);
    if (renderedInWorker) {
      return;
    }
  }

  renderToCanvasFromBlocksMainThread(u8, canvas, options);
}
