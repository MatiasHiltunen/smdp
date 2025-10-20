/**
 * A pretty fast, experimental Markdown parser + sample renderers to HTML and Canvas
 * ------------------------------------------------
 * - No RegExp or external dependencies
 * - Overall goal is to have a single pass over md lines, byte-span parsing (no substrings)
 * - Lower level arena-inspired HTML buffer (Uint8Array that grows geometrically) to minimize heap allocations
 * - Features: headings, blockquotes, ul/ol lists, hr, fenced code, paragraphs, inline code, emphasis (_/* simplified, now with bold), links, images, autolinks (http/https/www → https), minimal URL escaping
 * - Renderers: HTML (Uint8Array → String) and Canvas (Uint8Array → Canvas)
 */

import { TE } from './constants';
import { renderHTMLFromBlocks } from './html-renderer';
import { renderToCanvasFromBlocks } from './canvas-renderer';

export interface ParserOptions {
  /**
   * Allow raw HTML blocks in the markdown (default: false for security)
   */
  allowRawHtml?: boolean;
  /**
   * Custom URL allowlist function (default: allows http, https, mailto, relative URLs)
   */
  urlAllowlist?: (url: string) => boolean;
}

/**
 * Main Markdown parser class
 */
export class MDParser {
  private options: Required<ParserOptions>;

  constructor(options: ParserOptions = {}) {
    this.options = {
      allowRawHtml: options.allowRawHtml ?? false,
      urlAllowlist: options.urlAllowlist ?? ((url: string) => {
        // Default allowlist: http, https, mailto, relative URLs
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
          return true;
        }
        // Relative URLs (no protocol before first '/', '?', or '#')
        if (!url.includes('://')) {
          return true;
        }
        return false;
      }),
    };
  }

  /**
   * Parses Markdown (as Uint8Array) and returns HTML string
   */
  async parse(u8arr: Uint8Array): Promise<string> {
    return renderHTMLFromBlocks(u8arr, this.options);
  }

  /**
   * Renders Markdown (as Uint8Array) to an HTML5 Canvas
   */
  renderToCanvas(u8arr: Uint8Array, canvas: HTMLCanvasElement): void {
    renderToCanvasFromBlocks(u8arr, canvas);
  }

  /**
   * Get current parser options
   */
  getOptions(): Readonly<Required<ParserOptions>> {
    return { ...this.options };
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

