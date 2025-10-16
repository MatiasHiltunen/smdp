/**
 * Canvas renderer - renders Markdown to HTML5 Canvas
 */

import { blocks } from './block-parser';
import { inlineTokens } from './inline-parser';
import { COLOR, FONT_SIZE, INDENT, LINE_HEIGHT_MULTIPLIER, MARGIN, TD } from './constants';
import type { CanvasListItem, DrawResult, TextSpan, TextStyle } from './types';

const ORDERED_MARKER_FONT = 'bold ' + FONT_SIZE.base + 'px sans-serif';
const MARKER_GAP = 8;
const BULLET_RADIUS = 3;
const VIRTUAL_SCROLL_THRESHOLD = 1400; // px
const MAX_IMAGE_WIDTH = 700; // max width for images in px

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
): DrawResult {
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
    let font = '';
    if (currentStyle.bold) font += 'bold ';
    if (currentStyle.italic) font += 'italic ';
    font += currentStyle.size + 'px ' + (currentStyle.code ? 'monospace' : 'sans-serif');
    ctx.font = font;
    ctx.fillStyle = currentStyle.color || COLOR.text;
  };

  const flushLine = (): void => {
    let lineX = x;
    for (const span of line) {
      currentStyle = span.style;
      updateCtx();
      const w = ctx.measureText(span.text).width;
      if (!isMeasure) {
        ctx.fillText(span.text, lineX, currentY);
        if (currentStyle.link) {
          // Draw underline below the text baseline
          const underlineY = currentY + (currentStyle.size || FONT_SIZE.base) + 1;
          ctx.beginPath();
          ctx.moveTo(lineX, underlineY);
          ctx.lineTo(lineX + w, underlineY);
          ctx.strokeStyle = COLOR.inlineCodeText;
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
    let low = start;
    let high = text.length;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      const sub = text.substring(start, mid);
      if (ctx.measureText(sub).width <= maxW) {
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
      const partW = ctx.measureText(part).width;
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
              currentX += ctx.measureText(sub).width;
              pStart = pEnd;
            } else {
              if (line.length) {
                flushLine();
              } else {
                const char = part[pStart];
                line.push({ text: char, style: { ...currentStyle } });
                currentX += ctx.measureText(char).width;
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
        const paddingX = Math.max(6, surroundingSize * 0.35);
        const paddingY = Math.max(4, surroundingSize * 0.3);
        const radius = 5;

        pushStyle({ code: true, color: COLOR.inlineCodeText, size: surroundingSize });
        updateCtx();
        const textWidth = ctx.measureText(codeText).width;
        const bgX = currentX - paddingX;
        const bgY = currentY - paddingY / 2;
        const bgWidth = textWidth + paddingX * 2;
        const bgHeight = surroundingSize + paddingY;

        if (!isMeasure) {
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
        }

        addText(codeText);
        popStyle();
        break;
      }

      case 'img': {
        const altText = TD.decode(u8.subarray(tok.altS, tok.altE));
        const src = TD.decode(u8.subarray(tok.srcS, tok.srcE));
        
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
              ctx.font = FONT_SIZE.base + 'px sans-serif';
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
            ctx.font = FONT_SIZE.base + 'px sans-serif';
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
    }
  }

  if (line.length) flushLine();
  return { x: currentX, y: currentY };
}

function renderCanvas(
  u8: Uint8Array,
  ctx: CanvasRenderingContext2D,
  isMeasure: boolean,
  opts: { skipClear?: boolean; onImageLoad?: () => void } = {},
): number {
  if (!isMeasure) {
    if (!opts.skipClear) {
      ctx.fillStyle = COLOR.bg;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    ctx.fillStyle = COLOR.text;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }

  ctx.textBaseline = 'top';

  let y = MARGIN;
  let indent = 0;
  const maxWidth = ctx.canvas.width / (window.devicePixelRatio || 1) - 2 * MARGIN;
  let paraOpen = false;
  let currentX = MARGIN;
  const listStack: CanvasListItem[] = [];
  const orderedMarkerWidths: number[] = [];
  let inCode = false;
  let codeY = 0;
  let codeHeight = 0;
  let codeWidth = 0;
  const codeBlocks: { x: number; y: number; width: number; height: number }[] = [];
  const blockquotes: { x: number; y: number; width: number; height: number }[] = [];
  let inBlockquote = false;
  let blockquoteY = 0;

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
          blockquoteY = y - FONT_SIZE.base * 0.5;
          inBlockquote = true;
        }
        indent += INDENT;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 0.75;
        break;

      case 'bqClose':
        closePara();
        closeListsAll();
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 0.75;
        if (!isMeasure && inBlockquote) {
          blockquotes.push({
            x: MARGIN + indent - INDENT - 5,
            y: blockquoteY,
            width: maxWidth - (indent - INDENT) + 10,
            height: y - blockquoteY,
          });
          inBlockquote = false;
        }
        indent -= INDENT;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 0.5;
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
          ctx.font = ORDERED_MARKER_FONT;
          orderedMarkerWidths[listStack.length - 1] = ctx.measureText('1.').width;
        }
        break;

      case 'listItem': {
        closePara();
        const baseSize = FONT_SIZE.base;
        const level = listStack.length - 1;
        const bqOffset = inBlockquote ? 20 : 0;
        const textStart = MARGIN + indent + bqOffset;

        const top = listStack[listStack.length - 1];
        const isOrdered = !!(top && top.kind === 'ol');
        let markerText = '';
        if (isOrdered) {
          markerText = `${top.counter}.`;
          ctx.font = ORDERED_MARKER_FONT;
          const measured = ctx.measureText(markerText).width;
          const currentMax = orderedMarkerWidths[level] || 0;
          if (measured > currentMax) orderedMarkerWidths[level] = measured;
          top.counter += 1;
        }

        const markerWidth = isOrdered
          ? orderedMarkerWidths[level] || ctx.measureText(markerText).width
          : BULLET_RADIUS * 2;
        const availableWidth = maxWidth - (textStart - MARGIN);

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
        ctx.font = baseSize + 'px sans-serif';
        const bqOffset = inBlockquote ? 20 : 0;
        const textStart = MARGIN + indent + bqOffset;

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
          maxWidth - indent - bqOffset,
          isMeasure,
          { size: baseSize, color: inBlockquote ? COLOR.textSecondary : COLOR.text, italic: inBlockquote },
          opts.onImageLoad,
        );
        currentX = pRes.x;
        y = pRes.y;
        break;
      }

      case 'codeOpen':
        closePara();
        closeListsAll();
        inCode = true;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.2;
        codeY = y;
        codeWidth = 0;
        codeHeight = 0;
        break;

      case 'codeText':
        if (inCode) {
          const text = TD.decode(u8.subarray(ev.s, ev.e));
          ctx.font = FONT_SIZE.code + 'px monospace';
          const w = ctx.measureText(text).width;
          if (w > codeWidth) codeWidth = w;
          const codeLineH = FONT_SIZE.code * LINE_HEIGHT_MULTIPLIER;

          if (!isMeasure) {
            ctx.fillStyle = COLOR.text;
            ctx.fillText(text, MARGIN + indent + 10, y);
            ctx.fillStyle = COLOR.text;
          }

          y += codeLineH;
          codeHeight += codeLineH;
        }
        break;

      case 'codeClose':
        if (inCode) {
          inCode = false;
          if (!isMeasure) {
            codeBlocks.push({
              x: MARGIN + indent - 12,
              y: codeY - 12,
              width: codeWidth + 32,
              height: codeHeight + 24,
            });
          }
          y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.2;
        }
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
    for (const block of codeBlocks) {
      ctx.fillStyle = COLOR.codeBg;
      ctx.beginPath();
      const radius = 8;
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
    for (const bq of blockquotes) {
      ctx.fillStyle = COLOR.bgSecondary;
      ctx.fillRect(bq.x, bq.y, bq.width, bq.height);
      ctx.fillStyle = COLOR.blockquoteBorder;
      ctx.fillRect(bq.x + 5, bq.y, 4, bq.height);
    }
    ctx.restore();
  }

  return y;
}

export function renderToCanvasFromBlocks(u8: Uint8Array, canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const styleWidth = rect.width || 800;
  const scrollEl = canvas.parentElement?.closest('.canvas-scroll') as HTMLElement | null;
  const spacer = scrollEl?.querySelector<HTMLDivElement>('#canvas-spacer') ?? null;

  // Set up re-render callback for when images load
  const rerender = () => {
    // Re-render the canvas when an image finishes loading
    renderToCanvasFromBlocks(u8, canvas);
  };

  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = styleWidth * dpr;
  measureCanvas.height = 1;
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) return;
  measureCtx.scale(dpr, dpr);
  const totalHeight = renderCanvas(u8, measureCtx, true, { onImageLoad: rerender }) + MARGIN * 2;

  const viewportHeight = scrollEl ? scrollEl.clientHeight : totalHeight;
  const needsVirtualScroll = totalHeight > VIRTUAL_SCROLL_THRESHOLD;

  if (!needsVirtualScroll || !scrollEl) {
    canvas.width = styleWidth * dpr;
    canvas.height = totalHeight * dpr;
    canvas.style.width = `${styleWidth}px`;
    canvas.style.height = `${totalHeight}px`;
    canvas.style.position = 'static';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    renderCanvas(u8, ctx, false, { onImageLoad: rerender });
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
  const offscreenCtx = offscreen.getContext('2d');
  if (!offscreenCtx) return;
  offscreenCtx.scale(dpr, dpr);
  renderCanvas(u8, offscreenCtx, false, { onImageLoad: rerender });

  canvas.width = styleWidth * dpr;
  canvas.height = viewportHeight * dpr;
  canvas.style.width = `${styleWidth}px`;
  canvas.style.height = `${viewportHeight}px`;
  canvas.style.position = 'sticky';
  canvas.style.top = '0';
  canvas.style.left = '0';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

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
}

