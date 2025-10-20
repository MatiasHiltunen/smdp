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

// Token colors for syntax highlighting (dark theme optimized)
const TOKEN_COLORS = {
  [TokenType.Keyword]: '#ff7b72',           // Bright red/pink for keywords
  [TokenType.Identifier]: '#e6edf3',        // Light gray for identifiers
  [TokenType.LiteralNum]: '#79c0ff',        // Bright blue for numbers
  [TokenType.LiteralStr]: '#a5d6ff',        // Light blue for strings
  [TokenType.LiteralTpl]: '#a5d6ff',        // Light blue for template literals
  [TokenType.Comment]: '#8b949e',           // Medium gray for comments
  [TokenType.Regex]: '#7ee787',             // Bright green for regex
  [TokenType.Operator]: '#ff7b72',          // Bright red/pink for operators
  [TokenType.Punct]: '#e6edf3',             // Light gray for punctuation
  [TokenType.Whitespace]: '#e6edf3',        // Default text color
  [TokenType.Newline]: '#e6edf3',           // Default text color
} as const;

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

        ctx.fillStyle = COLOR.inlineCodeBg;
        ctx.fillRect(currentX - paddingX, y - codeSize - paddingY / 2, textWidth + paddingX * 2, codeSize + paddingY);

        // Text
        ctx.fillStyle = COLOR.inlineCodeText;
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
      case 'link': {
        const text = TD.decode(u8.subarray(tok.textS, tok.textE));
        const font = getFontString(isBold, isItalic, baseSize, false);
        ctx.font = font;
        const prevStyle = ctx.fillStyle as string | CanvasGradient | CanvasPattern;
        ctx.fillStyle = COLOR.link;
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
        ctx.fillStyle = COLOR.link;
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
  img: HTMLImageElement;
  width: number;
  height: number;
  status: 'loading' | 'loaded' | 'error';
  callbacks: Set<() => void>;
}

const imageCache = new Map<string, CachedImage>();

function loadImage(src: string, onLoad: () => void): CachedImage | undefined {
  const cached = imageCache.get(src);
  if (cached) {
    // Add callback for this render if image is still loading
    if (cached.status === 'loading' && onLoad) {
      cached.callbacks.add(onLoad);
    }
    return cached;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous'; // Try to enable CORS for external images
  
  const cacheEntry: CachedImage = {
    img,
    width: 0,
    height: 0,
    status: 'loading',
    callbacks: new Set<() => void>(),
  };
  
  if (onLoad) {
    cacheEntry.callbacks.add(onLoad);
  }
  
  imageCache.set(src, cacheEntry);
  
  img.onload = () => {
    cacheEntry.width = img.naturalWidth;
    cacheEntry.height = img.naturalHeight;
    cacheEntry.status = 'loaded';
    
    // Trigger re-render for all callbacks registered for this image
    cacheEntry.callbacks.forEach(fn => fn());
    cacheEntry.callbacks.clear();
  };
  
  img.onerror = () => {
    cacheEntry.status = 'error';
    
    // Trigger re-render for all callbacks registered for this image
    cacheEntry.callbacks.forEach(fn => fn());
    cacheEntry.callbacks.clear();
  };
  
  img.src = src;
  
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
        const color = TOKEN_COLORS[type] || COLOR.text;

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
        ctx.fillStyle = COLOR.text;
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
): DrawResult {
  const allowlist = urlAllowlist ?? defaultUrlAllowlist;
  let currentX = x;
  let currentY = y;
  const line: TextSpan[] = [];
  const styleStack: TextStyle[] = [];
  let currentStyle: TextStyle = {
    bold: false,
    italic: false,
    code: false,
    link: false,
    color: COLOR.text,
    size: baseStyle.size || FONT_SIZE.base,
  };

  const updateCtx = (): void => {
    const font = getFontString(currentStyle.bold || false, currentStyle.italic || false, currentStyle.size || FONT_SIZE.base, currentStyle.code || false);
    ctx.font = font;
    ctx.fillStyle = currentStyle.color || COLOR.text;
  };

  const flushLine = (): void => {
    let lineX = x;
    
    if (!isMeasure) {
      // First pass: draw backgrounds for consecutive code spans
      let tempX = x;
      let i = 0;
      const baseLineSize = line.length > 0 ? (line[0].style.size || FONT_SIZE.base) : FONT_SIZE.base;
      
      while (i < line.length) {
        const span = line[i];
        currentStyle = span.style;
        updateCtx();
        const w = ctx.measureText(span.text).width;
        
        if (currentStyle.code) {
          // Find consecutive code spans
          let codeEndX = tempX + w;
          let j = i + 1;
          while (j < line.length && line[j].style.code) {
            currentStyle = line[j].style;
            updateCtx();
            codeEndX += ctx.measureText(line[j].text).width;
            j++;
          }
          
          // Draw one background for all consecutive code spans
          const fontSize = span.style.size || FONT_SIZE.base;
          const baselineOffset = baseLineSize - fontSize;
          const paddingX = Math.max(6, fontSize * 0.35);
          const paddingY = Math.max(4, fontSize * 0.3);
          const radius = 3;
          const bgX = tempX - paddingX;
          const bgY = currentY + baselineOffset - paddingY / 2;
          const bgWidth = (codeEndX - tempX) + paddingX * 2;
          const bgHeight = fontSize + paddingY;
          
          const previousFill = ctx.fillStyle;
          ctx.fillStyle = COLOR.inlineCodeBg;
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
          ctx.fillStyle = previousFill;
          
          // Skip to end of code sequence
          i = j;
          tempX = codeEndX;
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
        
        if (currentStyle.link) {
          // Draw underline below the text baseline
          const underlineY = currentY + baselineOffset + fontSize + 1;
          ctx.beginPath();
          ctx.moveTo(lineX, underlineY);
          ctx.lineTo(lineX + w, underlineY);
          ctx.strokeStyle = COLOR.inlineCodeText;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (currentStyle.strike) {
          const strikeY = currentY + baselineOffset + fontSize * 0.55;
          ctx.beginPath();
          ctx.moveTo(lineX, strikeY);
          ctx.lineTo(lineX + w, strikeY);
          ctx.strokeStyle = COLOR.textSecondary;
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

  for (const tok of inlineTokens(u8, s, e)) {
    updateCtx();
    switch (tok.kind) {
      case 'text':
        addText(TD.decode(u8.subarray(tok.s, tok.e)));
        break;

      case 'code': {
        const codeText = TD.decode(u8.subarray(tok.s, tok.e));
        const surroundingSize = currentStyle.size || FONT_SIZE.base;
        const codeSize = Math.round(surroundingSize * 0.9); // Slightly smaller than surrounding text
        
        // Push style with code flag - background will be drawn during flush
        pushStyle({ code: true, color: COLOR.inlineCodeText, size: codeSize });
        addText(codeText);
        popStyle();
        break;
      }

      case 'img': {
        const altText = TD.decode(u8.subarray(tok.altS, tok.altE));
        const rawSrc = TD.decode(u8.subarray(tok.srcS, tok.srcE));
        if (!allowlist(rawSrc)) {
          pushStyle({ code: true, color: COLOR.textSecondary });
          addText(`[Blocked image: ${altText || rawSrc}]`);
          popStyle();
          if (line.length) flushLine();
          break;
        }
        const src = resolveUrlRelativeToBase(rawSrc, baseUrl);
        
        // Flush current line before image
        if (line.length) flushLine();
        
        // Always try to load/get cached image to start loading
        // Even during measure pass, we want to initiate the fetch
        const cachedImg = loadImage(src, onImageLoad || (() => {}));
        
        if (cachedImg && cachedImg.status === 'loaded') {
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
              ctx.drawImage(cachedImg.img, x, currentY, displayWidth, displayHeight);
            } catch (err) {
              // If drawing fails (CORS, etc), show fallback
              ctx.fillStyle = COLOR.border;
              ctx.fillRect(x, currentY, displayWidth, displayHeight);
              ctx.fillStyle = COLOR.textSecondary;
          ctx.font = FONT_SIZE.base + 'px ' + FONT_STACK;
              ctx.fillText(`[Image: ${altText || src}]`, x + 10, currentY + 20);
            }
            
            ctx.imageSmoothingEnabled = prevSmoothing;
            ctx.imageSmoothingQuality = prevQuality;
          }
          
          currentY += displayHeight + FONT_SIZE.base * 0.5; // Add spacing after image
        } else if (cachedImg && cachedImg.status === 'error') {
          // Show error message
          pushStyle({ code: true, color: COLOR.textSecondary });
          addText(`[Image failed to load: ${altText || src}]`);
          popStyle();
          if (line.length) flushLine();
        } else {
          // Loading... use consistent placeholder dimensions for both measure and draw
          // Use a reasonable default based on typical image aspect ratios (4:3)
          const placeholderWidth = Math.min(maxWidth, MAX_IMAGE_WIDTH);
          const placeholderHeight = (placeholderWidth * 3) / 4; // 4:3 aspect ratio
          
          if (!isMeasure) {
            ctx.fillStyle = COLOR.bgSecondary;
            ctx.fillRect(x, currentY, placeholderWidth, placeholderHeight);
            ctx.fillStyle = COLOR.textSecondary;
        ctx.font = FONT_SIZE.base + 'px ' + FONT_STACK;
            ctx.fillText(`Loading: ${altText || src}`, x + 10, currentY + placeholderHeight / 2);
          }
          currentY += placeholderHeight + FONT_SIZE.base * 0.5;
        }
        
        currentX = x; // Reset x after image
        break;
      }

      case 'link': {
        pushStyle({ link: true, color: COLOR.link });
        const linkText = TD.decode(u8.subarray(tok.textS, tok.textE));
        addText(linkText);
        popStyle();
        break;
      }

      case 'autolink':
        pushStyle({ link: true, color: COLOR.link });
        addText(TD.decode(u8.subarray(tok.s, tok.e)));
        popStyle();
        break;

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
  }

  if (line.length) flushLine();
  return { x: currentX, y: currentY };
}

function renderCanvas(
  u8: Uint8Array,
  ctx: CanvasRenderingContext2D,
  isMeasure: boolean,
  opts: { skipClear?: boolean; onImageLoad?: () => void; parserOptions?: ParserOptions } = {},
): number {
  const parserOptions = opts.parserOptions ?? {};
  const urlAllowlist = parserOptions.urlAllowlist ?? defaultUrlAllowlist;
  const baseUrl = parserOptions.baseUrl;
  const dpr = window.devicePixelRatio || 1;
  const logicalWidth = ctx.canvas.width / dpr;
  const logicalHeight = ctx.canvas.height / dpr;
  
  if (!isMeasure) {
    if (!opts.skipClear) {
      // Clear to transparent so destination-over backgrounds work correctly
      // Use logical dimensions since context is scaled
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    }
    ctx.fillStyle = COLOR.text;
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

  for (const ev of blocks(u8)) {
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
          ctx.strokeStyle = COLOR.hr;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(MARGIN + indent, y);
          ctx.lineTo(maxWidth + MARGIN - indent, y);
          ctx.stroke();
          const centerX = (MARGIN + indent + maxWidth + MARGIN - indent) / 2;
          ctx.fillStyle = COLOR.accent;
          ctx.fillRect(centerX - 30, y - 1, 60, 2);
          ctx.fillStyle = COLOR.text;
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
        );
        y = hRes.y;
        if (!isMeasure && (level === 0 || level === 1)) {
          const borderY = y + hSize * 0.2;
          ctx.strokeStyle = COLOR.border;
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
          ctx.fillStyle = COLOR.listMarker;
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
          ctx.fillStyle = COLOR.text;
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
          { size: baseSize, color: inBlockquote ? COLOR.textSecondary : COLOR.text, italic: inBlockquote },
          opts.onImageLoad,
          urlAllowlist,
          baseUrl,
        );
        currentX = pRes.x;
        y = pRes.y;
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
            ctx.fillStyle = COLOR.bgSecondary;
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
              ctx.strokeStyle = COLOR.border;
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
                COLOR.text,
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
                ctx.strokeStyle = COLOR.border;
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
                  COLOR.textSecondary,
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
      ctx.fillStyle = COLOR.codeBg;
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
      ctx.fillStyle = COLOR.bgSecondary;
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
      ctx.fillStyle = COLOR.blockquoteBorder;
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
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    
    ctx.restore();
  }

  return y;
}

export function renderToCanvasFromBlocks(u8: Uint8Array, canvas: HTMLCanvasElement, options: ParserOptions = {}): void {
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
    renderToCanvasFromBlocks(u8, canvas, options);
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
  }

  const scrollHandler = () => requestAnimationFrame(renderViewport);
  state.onScroll = scrollHandler;
  canvasStates.set(canvas, state);

  scrollEl.addEventListener('scroll', scrollHandler, { passive: true });

  renderViewport();
  canvas.dataset.virtualized = 'true';
  canvas.dataset.renderReady = 'ready';
}
