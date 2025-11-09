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
import { renderHTMLFromBlocks, renderHTMLFromSerializedBlocks } from './html-renderer';
import { renderToCanvasFromBlocks, renderToCanvasFromSerializedBlocks } from './canvas-renderer';
import { defaultUrlAllowlist } from './utils';

export interface ParserOptions {
  /**
   * Allow raw HTML blocks in the markdown (default: false for security)
   */
  allowRawHtml?: boolean;
  /**
   * Custom URL allowlist function (default: allows http, https, mailto, relative URLs)
   */
  urlAllowlist?: (url: string) => boolean;
  /**
   * Base URL used to resolve relative links and image sources.
   */
  baseUrl?: string;
}

type ResolvedParserOptions = {
  allowRawHtml: boolean;
  urlAllowlist: (url: string) => boolean;
  baseUrl?: string;
};


/**
 * Main Markdown parser class
 */
export class MDParser {
  private options: ResolvedParserOptions;

  constructor(options: ParserOptions = {}) {
    this.options = {
      allowRawHtml: options.allowRawHtml ?? false,
      urlAllowlist: options.urlAllowlist ?? defaultUrlAllowlist,
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    };
  }

  /**
   * Parses Markdown (as Uint8Array) and returns HTML string
   */
  async parse(u8arr: Uint8Array<ArrayBuffer>, overrides: ParserOptions = {}): Promise<string> {
    const baseUrl = overrides.baseUrl ?? this.options.baseUrl;
    const effective: ResolvedParserOptions = {
      allowRawHtml: overrides.allowRawHtml ?? this.options.allowRawHtml,
      urlAllowlist: overrides.urlAllowlist ?? this.options.urlAllowlist,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    };
    return renderHTMLFromBlocks(u8arr, effective);
  }

  async parseFromBlocks(
    u8arr: Uint8Array<ArrayBuffer>,
    blockBytes: Uint8Array<ArrayBuffer>,
    overrides: ParserOptions = {},
  ): Promise<string> {
    const baseUrl = overrides.baseUrl ?? this.options.baseUrl;
    const effective: ResolvedParserOptions = {
      allowRawHtml: overrides.allowRawHtml ?? this.options.allowRawHtml,
      urlAllowlist: overrides.urlAllowlist ?? this.options.urlAllowlist,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    };
    return renderHTMLFromSerializedBlocks(u8arr, blockBytes, effective);
  }

  /**
   * Renders Markdown (as Uint8Array) to an HTML5 Canvas
   */
  renderToCanvas(u8arr: Uint8Array<ArrayBuffer>, canvas: HTMLCanvasElement, overrides: ParserOptions = {}): void {
    const baseUrl = overrides.baseUrl ?? this.options.baseUrl;
    const effective: ResolvedParserOptions = {
      allowRawHtml: overrides.allowRawHtml ?? this.options.allowRawHtml,
      urlAllowlist: overrides.urlAllowlist ?? this.options.urlAllowlist,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    };
    renderToCanvasFromBlocks(u8arr, canvas, effective);
  }

  renderToCanvasFromBlocksPayload(
    u8arr: Uint8Array<ArrayBuffer>,
    blockBytes: Uint8Array<ArrayBuffer>,
    canvas: HTMLCanvasElement,
    overrides: ParserOptions = {},
  ): void {
    const baseUrl = overrides.baseUrl ?? this.options.baseUrl;
    const effective: ResolvedParserOptions = {
      allowRawHtml: overrides.allowRawHtml ?? this.options.allowRawHtml,
      urlAllowlist: overrides.urlAllowlist ?? this.options.urlAllowlist,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    };
    renderToCanvasFromSerializedBlocks(u8arr, blockBytes, canvas, effective);
  }

  /**
   * Get current parser options
   */
  getOptions(): Readonly<ResolvedParserOptions> {
    return { ...this.options };
  }
}

/**
 * Utility function to convert string to Uint8Array
 */
export function u8(str: string): Uint8Array<ArrayBuffer> {
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
export { renderHTMLFromBlocks, renderHTMLFromSerializedBlocks } from './html-renderer';
export { renderToCanvasFromBlocks, renderToCanvasFromSerializedBlocks } from './canvas-renderer';
