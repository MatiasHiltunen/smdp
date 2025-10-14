/**
 * Canvas renderer - renders Markdown to HTML5 Canvas
 */

import { blocks } from './block-parser';
import { inlineTokens } from './inline-parser';
import { COLOR, FONT_SIZE, INDENT, LINE_HEIGHT_MULTIPLIER, MARGIN, TD } from './constants';
import type { CanvasListItem, DrawResult, TextSpan, TextStyle } from './types';

/**
 * Code block info for proper rendering
 */
interface CodeBlockInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Blockquote info for background rendering
 */
interface BlockquoteInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  indent: number;
}

/**
 * Renders inline tokens to canvas
 */
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
    font +=
      currentStyle.size +
      'px ' +
      (currentStyle.code ? 'monospace' : 'sans-serif');
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
          ctx.beginPath();
          ctx.moveTo(lineX, currentY + 1);
          ctx.lineTo(lineX + w, currentY + 1);
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
                // Force add at least one char
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
        pushStyle({ code: true, color: COLOR.text, size: FONT_SIZE.code });

        if (!isMeasure) {
          updateCtx();
          const textWidth = ctx.measureText(codeText).width;
          const paddingX = 4;
          const paddingY = currentStyle.size! * 0.2;
          const bgX = currentX - paddingX;
          const bgY = currentY - currentStyle.size! * 0.8 - paddingY / 2;
          const bgWidth = textWidth + paddingX * 2;
          const bgHeight = currentStyle.size! * 1.1 + paddingY;
          ctx.fillStyle = 'rgba(110, 118, 129, 0.15)';
          ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
        }

        addText(codeText);
        popStyle();
        break;
      }
        
      case 'img': {
        const altText = TD.decode(u8.subarray(tok.altS, tok.altE));
        const src = TD.decode(u8.subarray(tok.srcS, tok.srcE));
        // For now, render as placeholder text with link-style formatting
        pushStyle({ code: true, color: COLOR.link });
        addText(`[🖼️ ${altText || 'image'}: ${src}]`);
        popStyle();
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

/**
 * Internal canvas rendering function
 */
function renderCanvas(
  u8: Uint8Array,
  ctx: CanvasRenderingContext2D,
  isMeasure: boolean,
): number {
  // Set optimal text rendering properties for crisp text
  if (!isMeasure) {
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = COLOR.text;
    
    // Enable high-quality text rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.textBaseline = 'top';
  }
  
  let y = MARGIN;
  let indent = 0;
  const maxWidth = ctx.canvas.width - 2 * MARGIN;
  let paraOpen = false;
  let currentX = MARGIN;
  const listStack: CanvasListItem[] = [];
  let inCode = false;
  let codeY = 0;
  let codeHeight = 0;
  let codeWidth = 0;
  const codeBlocks: CodeBlockInfo[] = [];
  const blockquotes: BlockquoteInfo[] = [];
  let inBlockquote = false;
  let blockquoteY = 0;
  let blockquoteHeight = 0;

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
          blockquoteY = y - FONT_SIZE.base * 0.5; // Start a bit higher for padding
          blockquoteHeight = 0;
          inBlockquote = true;
        }
        indent += INDENT;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 0.75; // More top padding
        break;
        
      case 'bqClose':
        closePara();
        closeListsAll();
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 0.75; // More bottom padding
        if (!isMeasure && inBlockquote) {
          blockquotes.push({
            x: MARGIN + indent - INDENT - 5, // Extend slightly to the left
            y: blockquoteY,
            width: maxWidth - (indent - INDENT) + 10, // Extend slightly
            height: y - blockquoteY,
            indent: indent - INDENT,
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
          // Main horizontal line
          ctx.strokeStyle = COLOR.hr;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(MARGIN + indent, y);
          ctx.lineTo(maxWidth + MARGIN - indent, y);
          ctx.stroke();
          
          // Accent dot in center
          const centerX = (MARGIN + indent + maxWidth + MARGIN - indent) / 2;
          ctx.fillStyle = COLOR.accent;
          ctx.fillRect(centerX - 30, y - 1, 60, 2);
        }
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER;
        break;
        
      case 'heading': {
        closePara();
        closeListsAll();
        const level = ev.level - 1;
        const hSize = FONT_SIZE.heading[level];
        y += hSize * LINE_HEIGHT_MULTIPLIER * 0.5; // More space before heading
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
        );
        y = hRes.y;
        
        // Add border for h1 and h2
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
        
        y += hSize * LINE_HEIGHT_MULTIPLIER * 0.5; // More space after heading
        break;
      }
        
      case 'listOpen':
        closePara();
        listStack.push({ kind: ev.kind, counter: 1 });
        indent += INDENT;
        break;
        
      case 'listItem': {
        closePara();
        const baseSize = FONT_SIZE.base;
        const bqOffset = inBlockquote ? 20 : 0;
        const textStart = MARGIN + indent + bqOffset;
        const availableWidth = maxWidth - indent - bqOffset;
        const gapAfterMarker = 8;

        let marker = '•';
        const top = listStack[listStack.length - 1];
        const isOrdered = !!(top && top.kind === 'ol');
        if (isOrdered) {
          marker = (top.counter++).toString() + '.';
        }

        if (!isMeasure) {
          ctx.fillStyle = COLOR.listMarker;
          if (isOrdered) {
            ctx.font = 'bold ' + baseSize + 'px sans-serif';
            const markerW = ctx.measureText(marker).width;
            ctx.fillText(marker, textStart - markerW - gapAfterMarker, y + baseSize);
          } else {
            const radius = 3;
            const bulletX = textStart - radius - gapAfterMarker;
            const bulletY = y + baseSize * 0.5;
            ctx.beginPath();
            ctx.arc(bulletX, bulletY, radius, 0, Math.PI * 2);
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
        );
        y = liRes.y + baseSize * 0.8;
        if (inBlockquote) blockquoteHeight = y - blockquoteY;
        break;
      }
        
      case 'listClose':
        closePara();
        while (listStack.length) {
          const top = listStack.pop()!;
          indent -= INDENT;
          if (top.kind === ev.kind) break;
        }
        break;
        
      case 'paraLine': {
        const baseSize = FONT_SIZE.base;
        ctx.font = baseSize + 'px sans-serif';
        const bqOffset = inBlockquote ? 20 : 0;

        if (!paraOpen) {
          closeListsAll();
          paraOpen = true;
          currentX = MARGIN + indent + bqOffset;
          y += baseSize * LINE_HEIGHT_MULTIPLIER * (inBlockquote ? 0.25 : 0.3);
        } else {
          const spaceW = ctx.measureText(' ').width;
          const availableWidth = maxWidth - indent - bqOffset;
          const usedWidth = currentX - (MARGIN + indent + bqOffset);
          const remaining = availableWidth - usedWidth;

          if (spaceW > remaining) {
            y += baseSize * LINE_HEIGHT_MULTIPLIER;
            currentX = MARGIN + indent + bqOffset;
          } else {
            if (!isMeasure) {
              ctx.fillStyle = inBlockquote ? COLOR.textSecondary : COLOR.text;
              ctx.fillText(' ', currentX, y);
            }
            currentX += spaceW;
          }
        }

        const pRes = drawInline(
          u8,
          ev.s,
          ev.e,
          ctx,
          currentX,
          y,
          maxWidth - indent - bqOffset - (currentX - (MARGIN + indent + bqOffset)),
          isMeasure,
          { size: baseSize, color: inBlockquote ? COLOR.textSecondary : COLOR.text, italic: inBlockquote },
        );
        currentX = pRes.x;
        y = pRes.y;
        if (inBlockquote) blockquoteHeight = y - blockquoteY;
        break;
      }
        
      case 'codeOpen':
        closePara();
        closeListsAll();
        inCode = true;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.2; // More space before code
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
            // Use proper text color for code blocks (not too dark)
            ctx.fillStyle = COLOR.text;
            ctx.fillText(text, MARGIN + indent + 10, y);
          }
          
          y += codeLineH;
          codeHeight += codeLineH;
        }
        break;
        
      case 'codeClose':
        if (inCode) {
          inCode = false;
          if (!isMeasure) {
            // Store code block for background rendering with better padding
            codeBlocks.push({
              x: MARGIN + indent - 12,
              y: codeY - 12,
              width: codeWidth + 32,
              height: codeHeight + 24,
            });
          }
          y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 1.2; // More space after code
        }
        break;
    }
  }
  
  closePara();
  closeListsAll();
  
  if (inCode && !isMeasure) {
    // Store final code block if still open
    codeBlocks.push({
      x: MARGIN + indent - 5,
      y: codeY - 5,
      width: codeWidth + 20,
      height: codeHeight + 10,
    });
    y += 10;
  }
  
  if (inBlockquote && !isMeasure) {
    // Store final blockquote if still open
    blockquotes.push({
      x: MARGIN + indent - INDENT - 5,
      y: blockquoteY,
      width: maxWidth - (indent - INDENT) + 10,
      height: y - blockquoteY,
      indent,
    });
  }
  
  return y;
}

/**
 * Renders Markdown to canvas with proper height calculation and DPI scaling
 */
export function renderToCanvasFromBlocks(
  u8: Uint8Array,
  canvas: HTMLCanvasElement,
): void {
  // Get device pixel ratio for crisp rendering on high-DPI displays
  const dpr = window.devicePixelRatio || 1;
  
  // Get the CSS display width (not the canvas bitmap width!)
  // This prevents exponential growth on re-renders
  const rect = canvas.getBoundingClientRect();
  const styleWidth = rect.width || 800; // Default to 800 if not in DOM
  
  // Measure height with proper scaling
  const measureHeight = (): number => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = styleWidth * dpr;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return 0;
    tempCtx.scale(dpr, dpr);
    return renderCanvas(u8, tempCtx, true);
  };
  
  const finalY = measureHeight();
  const finalHeight = finalY + MARGIN;
  
  // Set actual canvas size (accounting for DPI)
  canvas.width = styleWidth * dpr;
  canvas.height = finalHeight * dpr;
  
  // Set display size (CSS pixels) - preserve the original width
  canvas.style.width = styleWidth + 'px';
  canvas.style.height = finalHeight + 'px';
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  // Scale context to account for DPI
  ctx.scale(dpr, dpr);
  
  // Enable high-quality text rendering
  ctx.textRendering = 'optimizeLegibility' as any;
  ctx.font = FONT_SIZE.base + 'px sans-serif';
  
  // First pass: collect all background elements and measure
  const decorativeElements = collectDecorativeElements(u8, ctx, styleWidth);
  
  // Draw backgrounds FIRST (layering order: backgrounds → borders → text)
  
  // 1. Blockquote backgrounds
  for (const bq of decorativeElements.blockquotes) {
    // Background with rounded corners
    ctx.fillStyle = COLOR.bgSecondary;
    const radius = 8;
    ctx.beginPath();
    ctx.moveTo(bq.x + radius, bq.y);
    ctx.lineTo(bq.x + bq.width, bq.y);
    ctx.lineTo(bq.x + bq.width, bq.y + bq.height);
    ctx.lineTo(bq.x + radius, bq.y + bq.height);
    ctx.quadraticCurveTo(bq.x, bq.y + bq.height, bq.x, bq.y + bq.height - radius);
    ctx.lineTo(bq.x, bq.y + radius);
    ctx.quadraticCurveTo(bq.x, bq.y, bq.x + radius, bq.y);
    ctx.closePath();
    ctx.fill();
    
    // Left border (4px wide, solid color at top fading down)
    const gradient = ctx.createLinearGradient(bq.x, bq.y, bq.x, bq.y + bq.height);
    gradient.addColorStop(0, COLOR.blockquoteBorder);
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.3)');
    ctx.fillStyle = gradient;
    ctx.fillRect(bq.x + 5, bq.y, 4, bq.height); // Offset from left edge for padding
  }
  
  // 2. Code block backgrounds
  for (const block of decorativeElements.codeBlocks) {
    // Background
    ctx.fillStyle = COLOR.codeBg;
    const radius = 8;
    ctx.beginPath();
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
    
    // Border
    ctx.strokeStyle = COLOR.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Add subtle inner shadow effect
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  
  // Second pass: render text on top
  renderCanvas(u8, ctx, false);
}

/**
 * Collect all decorative elements (backgrounds, borders) before rendering text
 */
function collectDecorativeElements(
  u8: Uint8Array,
  ctx: CanvasRenderingContext2D,
  width: number,
): { codeBlocks: CodeBlockInfo[]; blockquotes: BlockquoteInfo[] } {
  const codeBlocks: CodeBlockInfo[] = [];
  const blockquotes: BlockquoteInfo[] = [];
  
  let y = MARGIN;
  let indent = 0;
  const maxWidth = width - 2 * MARGIN;
  let inCode = false;
  let codeY = 0;
  let codeHeight = 0;
  let codeWidth = 0;
  let inBlockquote = false;
  let blockquoteY = 0;

  for (const ev of blocks(u8)) {
    switch (ev.type) {
      case 'bqOpen':
        if (!inBlockquote) {
          blockquoteY = y - FONT_SIZE.base * 0.5;
          inBlockquote = true;
        }
        indent += INDENT;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 0.75;
        break;
        
      case 'bqClose':
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 0.75;
        if (inBlockquote) {
          blockquotes.push({
            x: MARGIN + indent - INDENT - 5,
            y: blockquoteY,
            width: maxWidth - (indent - INDENT) + 10,
            height: y - blockquoteY,
            indent: indent - INDENT,
          });
          inBlockquote = false;
        }
        indent -= INDENT;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 0.5;
        break;
        
      case 'codeOpen':
        inCode = true;
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER;
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
          y += codeLineH;
          codeHeight += codeLineH;
        }
        break;
        
      case 'codeClose':
        if (inCode) {
          inCode = false;
          codeBlocks.push({
            x: MARGIN + indent - 10,
            y: codeY - 10,
            width: codeWidth + 30,
            height: codeHeight + 20,
          });
          y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER;
        }
        break;
        
      case 'heading':
        y += FONT_SIZE.heading[ev.level - 1] * LINE_HEIGHT_MULTIPLIER * 1.1;
        break;
        
      case 'hr':
        y += FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER * 2;
        break;
        
      case 'listOpen':
        indent += INDENT;
        break;
        
      case 'listClose':
        indent -= INDENT;
        break;
        
      case 'listItem':
      case 'paraLine': {
        const lineHeight = FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER;
        y += lineHeight;
        break;
      }
    }
  }
  
  return { codeBlocks, blockquotes };
}

