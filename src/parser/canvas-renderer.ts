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
        
      case 'code':
        pushStyle({ code: true, color: COLOR.code, size: FONT_SIZE.code });
        addText(TD.decode(u8.subarray(tok.s, tok.e)));
        popStyle();
        break;
        
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
        const linkRes = drawInline(
          u8,
          tok.textS,
          tok.textE,
          ctx,
          currentX,
          currentY,
          maxWidth - (currentX - x),
          isMeasure,
          baseStyle,
        );
        currentX = linkRes.x;
        currentY = linkRes.y;
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
        indent += INDENT;
        y += (FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER) / 2;
        break;
        
      case 'bqClose':
        closePara();
        closeListsAll();
        indent -= INDENT;
        y += (FONT_SIZE.base * LINE_HEIGHT_MULTIPLIER) / 2;
        break;
        
      case 'hr':
        closePara();
        closeListsAll();
        if (!isMeasure) {
          ctx.strokeStyle = COLOR.hr;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(MARGIN, y);
          ctx.lineTo(ctx.canvas.width - MARGIN, y);
          ctx.stroke();
        }
        y += 10;
        break;
        
      case 'heading': {
        closePara();
        closeListsAll();
        const level = ev.level - 1;
        const hSize = FONT_SIZE.heading[level];
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
        y += (hSize * LINE_HEIGHT_MULTIPLIER) / 2;
        break;
      }
        
      case 'listOpen':
        closePara();
        listStack.push({ kind: ev.kind, counter: 1 });
        indent += INDENT;
        break;
        
      case 'listItem': {
        closePara();
        let marker = '• ';
        const top = listStack[listStack.length - 1];
        if (top && top.kind === 'ol') {
          marker = top.counter++ + '. ';
        }
        const baseSize = FONT_SIZE.base;
        ctx.font = baseSize + 'px sans-serif';
        const markerW = ctx.measureText(marker).width;
        if (!isMeasure) {
          ctx.fillText(marker, MARGIN + indent - markerW - 5, y + baseSize);
        }
        const liRes = drawInline(
          u8,
          ev.s,
          ev.e,
          ctx,
          MARGIN + indent,
          y,
          maxWidth - indent,
          isMeasure,
          { size: baseSize },
        );
        y = liRes.y;
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
        if (!paraOpen) {
          closeListsAll();
          paraOpen = true;
          currentX = MARGIN + indent;
          y += (baseSize * LINE_HEIGHT_MULTIPLIER) / 2;
        } else {
          const spaceW = ctx.measureText(' ').width;
          const remaining = maxWidth - indent - (currentX - (MARGIN + indent));
          if (spaceW > remaining) {
            y += baseSize * LINE_HEIGHT_MULTIPLIER;
            currentX = MARGIN + indent;
          } else {
            if (!isMeasure) ctx.fillText(' ', currentX, y);
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
          maxWidth - indent,
          isMeasure,
          { size: baseSize },
        );
        currentX = pRes.x;
        y = pRes.y;
        break;
      }
        
      case 'codeOpen':
        closePara();
        closeListsAll();
        inCode = true;
        y += 10;
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
            // Store code block info for later background rendering
            ctx.fillStyle = COLOR.code;
            ctx.fillText(text, MARGIN + indent + 5, y);
          }
          
          y += codeLineH;
          codeHeight += codeLineH;
        }
        break;
        
      case 'codeClose':
        if (inCode) {
          inCode = false;
          if (!isMeasure) {
            // Store code block for background rendering
            codeBlocks.push({
              x: MARGIN + indent - 5,
              y: codeY - 5,
              width: codeWidth + 20,
              height: codeHeight + 10,
            });
          }
          y += 10;
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
  
  // First pass: render everything
  const codeBlocksCollected: CodeBlockInfo[] = [];
  renderCanvasWithCodeBlocks(u8, ctx, false, codeBlocksCollected);
  
  // Draw code block backgrounds FIRST (so text appears on top)
  for (const block of codeBlocksCollected) {
    ctx.fillStyle = COLOR.codeBg;
    ctx.fillRect(block.x, block.y, block.width, block.height);
  }
  
  // Second pass: render text on top
  renderCanvas(u8, ctx, false);
}

/**
 * Helper to collect code blocks during rendering
 */
function renderCanvasWithCodeBlocks(
  u8: Uint8Array,
  ctx: CanvasRenderingContext2D,
  isMeasure: boolean,
  codeBlocksOut: CodeBlockInfo[],
): number {
  let y = MARGIN;
  const indent = 0;
  let inCode = false;
  let codeY = 0;
  let codeHeight = 0;
  let codeWidth = 0;

  for (const ev of blocks(u8)) {
    if (ev.type === 'codeOpen') {
      inCode = true;
      y += 10;
      codeY = y;
      codeWidth = 0;
      codeHeight = 0;
    } else if (ev.type === 'codeText' && inCode) {
      const text = TD.decode(u8.subarray(ev.s, ev.e));
      ctx.font = FONT_SIZE.code + 'px monospace';
      const w = ctx.measureText(text).width;
      if (w > codeWidth) codeWidth = w;
      const codeLineH = FONT_SIZE.code * LINE_HEIGHT_MULTIPLIER;
      y += codeLineH;
      codeHeight += codeLineH;
    } else if (ev.type === 'codeClose' && inCode) {
      inCode = false;
      if (!isMeasure) {
        codeBlocksOut.push({
          x: MARGIN + indent - 5,
          y: codeY - 5,
          width: codeWidth + 20,
          height: codeHeight + 10,
        });
      }
      y += 10;
    }
  }
  
  return y;
}

