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
import type { PdfRenderOptions } from './pdf-renderer';
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
  /**
   * Emit source-line anchors for editor-to-preview synchronization.
   */
  sourceLineAttributes?: boolean;
}

type ResolvedParserOptions = {
  allowRawHtml: boolean;
  urlAllowlist: (url: string) => boolean;
  baseUrl?: string;
  sourceLineAttributes: boolean;
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
      sourceLineAttributes: options.sourceLineAttributes ?? false,
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    };
  }

  /**
   * Parses Markdown (as Uint8Array) and returns HTML string
   */
  async parse(u8arr: Uint8Array, overrides: ParserOptions = {}): Promise<string> {
    const baseUrl = overrides.baseUrl ?? this.options.baseUrl;
    const effective: ResolvedParserOptions = {
      allowRawHtml: overrides.allowRawHtml ?? this.options.allowRawHtml,
      urlAllowlist: overrides.urlAllowlist ?? this.options.urlAllowlist,
      sourceLineAttributes:
        overrides.sourceLineAttributes ?? this.options.sourceLineAttributes,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    };
    return renderHTMLFromBlocks(u8arr, effective);
  }

  /**
   * Renders Markdown (as Uint8Array) to an HTML5 Canvas
   */
  renderToCanvas(u8arr: Uint8Array, canvas: HTMLCanvasElement, overrides: ParserOptions = {}): void {
    const baseUrl = overrides.baseUrl ?? this.options.baseUrl;
    const effective: ResolvedParserOptions = {
      allowRawHtml: overrides.allowRawHtml ?? this.options.allowRawHtml,
      urlAllowlist: overrides.urlAllowlist ?? this.options.urlAllowlist,
      sourceLineAttributes:
        overrides.sourceLineAttributes ?? this.options.sourceLineAttributes,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    };
    renderToCanvasFromBlocks(u8arr, canvas, effective);
  }

  /**
   * Renders Markdown (as Uint8Array) to a dependency-free PDF byte stream.
   */
  async renderToPDF(u8arr: Uint8Array, overrides: PdfRenderOptions = {}): Promise<Uint8Array> {
    const baseUrl = overrides.baseUrl ?? this.options.baseUrl;
    const effective: PdfRenderOptions = {
      ...overrides,
      allowRawHtml: overrides.allowRawHtml ?? this.options.allowRawHtml,
      urlAllowlist: overrides.urlAllowlist ?? this.options.urlAllowlist,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    };
    const { renderPDFFromBlocksAsync } = await import('./pdf-renderer');
    return await renderPDFFromBlocksAsync(u8arr, effective);
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

export type {
  PdfCodeColorKey,
  PdfCodeColorOptions,
  PdfDocumentStyleOptions,
  PdfImageResolver,
  PdfImageResolverContext,
  PdfPageSize,
  PdfRGB,
  PdfRenderOptions,
  PdfResolvedImage,
} from './pdf-renderer';
export { HtmlArena } from './arena';
export { lineSpans } from './line-parser';
export { inlineTokens } from './inline-parser';
export { blocks } from './block-parser';
export { renderHTMLFromBlocks } from './html-renderer';
export { renderToCanvasFromBlocks } from './canvas-renderer';
