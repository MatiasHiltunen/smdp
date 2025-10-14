/**
 * Ultra-fast Markdown → HTML (Uint8Array → String) or Canvas
 * ------------------------------------------------
 * - Modern TypeScript module
 * - Zero RegExp
 * - Single pass over lines, byte-span parsing (no substrings)
 * - Arena-style HTML buffer (Uint8Array that grows geometrically)
 * - Generator-based scanners for clarity without allocations
 * - Features: headings, blockquotes, ul/ol lists, hr, fenced code, paragraphs
 *             inline code, emphasis (_/* simplified, now with bold), links, images, autolinks
 *             (http/https/www → https), minimal URL escaping
 *
 * Usage:
 *   import { MDParser, u8 } from './parser';
 *   const parser = new MDParser();
 *   const html = parser.parse(u8('# Hi\nSee www.example.com and ![alt](x.png)'));
 *   // or
 *   const canvas = document.createElement('canvas');
 *   canvas.width = 800;
 *   parser.renderToCanvas(u8('# Hi\nSee www.example.com and ![alt](x.png)'), canvas);
 */

import { TE } from './constants';
import { renderHTMLFromBlocks } from './html-renderer';
import { renderToCanvasFromBlocks } from './canvas-renderer';

/**
 * Main Markdown parser class
 */
export class MDParser {
  /**
   * Parses Markdown (as Uint8Array) and returns HTML string
   */
  parse(u8arr: Uint8Array): string {
    return renderHTMLFromBlocks(u8arr);
  }

  /**
   * Renders Markdown (as Uint8Array) to an HTML5 Canvas
   */
  renderToCanvas(u8arr: Uint8Array, canvas: HTMLCanvasElement): void {
    renderToCanvasFromBlocks(u8arr, canvas);
  }
}

/**
 * Utility function to convert string to Uint8Array
 */
export function u8(str: string): Uint8Array {
  return TE.encode(str);
}

// Re-export commonly used types and utilities
export type {
  InlineToken,
  BlockEvent,
  LineSpan,
  TextStyle,
  DrawResult,
} from './types';

export { HtmlArena } from './arena';
export { lineSpans } from './line-parser';
export { inlineTokens } from './inline-parser';
export { blocks } from './block-parser';
export { renderHTMLFromBlocks } from './html-renderer';
export { renderToCanvasFromBlocks } from './canvas-renderer';

